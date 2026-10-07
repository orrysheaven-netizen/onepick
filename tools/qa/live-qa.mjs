// Daily live QA of the OnePick tester site. Loads the public web app the way a
// logged-out phone user does and records what they would feel: load speed,
// JS errors, failed or slow requests, stuck spinners and on-screen error copy.
// Output: <out>/report.json, <out>/report.md and screenshots. See docs/daily-qa.md.
//
// QA_MODE=pr runs a shorter route set for PR preview checks (docs/daily-qa.md
// "PR 미리보기 모드"): one home load, no throttled run, no home→detail transition.
// It additionally writes <out>/verdict.json ({pass, budgetViolations, findings})
// and sets the process exit code to 1 when a High finding or a budget violation
// (JS KB, FCP, readiness, Supabase calls per page) shows up, so a caller can gate
// on it without parsing markdown.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from 'playwright';

const BASE_URL = (process.env.QA_BASE_URL || 'https://onepick-5cl.pages.dev').replace(/\/$/, '');
const OUT_DIR = path.resolve(process.env.QA_OUT_DIR || 'qa-output');
const QA_MODE = process.env.QA_MODE === 'pr' ? 'pr' : 'full';
const EXTRA_PATHS = (process.env.QA_EXTRA_PATHS || '').split(',').map((p) => p.trim()).filter(Boolean);
const COLD_PATHS = QA_MODE === 'pr' ? ['/', '/explore'] : ['/', '/explore', '/auth/login', '/legal/terms', ...EXTRA_PATHS];
const HOME_RUNS = QA_MODE === 'pr' ? 1 : 3;
const SETTLE_TIMEOUT_MS = 20_000;
const SPINNER_GRACE_MS = 10_000;

// Thresholds are what a phone user notices, not lab ideals. Tune here only.
const LIMITS = {
  ttfbMs: 800,
  fcpMs: 1800,
  readyMs: 5000,
  throttledLcpMs: 4000,
  throttledReadyMs: 10_000,
  apiMs: 1000,
  apiCallsPerPage: 15,
  jsKb: 1500,
  tbtMs: 600,
  cls: 0.1,
  transitionMs: 2500,
};
const ERROR_COPY = /(오류가 발생|문제가 발생|불러오지 못|실패했|다시 시도|Something went wrong|Unexpected error)/;
const SUPABASE_HOST = /\.supabase\.co$/;

const device = devices['iPhone 13'];
const findings = [];
const pages = [];

function finding(severity, where, what, evidence) {
  const same = findings.find((f) => f.severity === severity && f.where === where && f.what === what && f.evidence === evidence);
  if (same) same.count += 1;
  else findings.push({ severity, where, what, evidence, count: 1 });
}

// Never keep query strings: Supabase URLs carry filters, apikeys or tokens.
function safeUrl(raw) {
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname}`;
  } catch {
    return String(raw).split('?')[0].slice(0, 200);
  }
}

// Split one request's time into where it went, from Playwright's request.timing()
// (ms relative to the request start; -1 = phase did not happen, e.g. a reused
// connection has no DNS/connect/TLS). Numbers only: no URL, header or token goes
// into this object, so it is safe to keep in the report and report.json.
//   waitMs      queued/stalled before the request could be sent (excl. connection setup)
//   dnsMs/tcpMs/tlsMs  connection setup, 0 when the connection was reused
//   serverMs    request sent -> first response byte (server + network round trip)
//   downloadMs  first byte -> last byte
function splitTiming(t) {
  const span = (a, b) => (a >= 0 && b >= 0 && b >= a ? Math.round(b - a) : 0);
  const dnsMs = span(t.domainLookupStart, t.domainLookupEnd);
  const connectTotal = span(t.connectStart, t.connectEnd);
  const tlsMs = t.secureConnectionStart >= 0 ? span(t.secureConnectionStart, t.connectEnd) : 0;
  const tcpMs = Math.max(0, connectTotal - tlsMs);
  const serverMs = span(t.requestStart, t.responseStart);
  const downloadMs = span(t.responseStart, t.responseEnd);
  const waitMs = t.requestStart >= 0 ? Math.max(0, Math.round(t.requestStart) - dnsMs - connectTotal) : 0;
  return { reused: connectTotal === 0, waitMs, dnsMs, tcpMs, tlsMs, serverMs, downloadMs };
}

const connectMs = (a) => a.dnsMs + a.tcpMs + a.tlsMs;
const timingText = (a) => `${a.reused ? '연결 재사용' : `연결 ${connectMs(a)}ms(DNS ${a.dnsMs}·TCP ${a.tcpMs}·TLS ${a.tlsMs})`} · 대기 ${a.waitMs}ms · 서버 ${a.serverMs}ms · 다운로드 ${a.downloadMs}ms`;

const OBSERVERS = () => {
  const qa = { fcp: null, lcp: null, tbt: 0, longTasks: 0, cls: 0 };
  window.__qa = qa;
  const observe = (type, fn) => {
    try { new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch { /* unsupported */ }
  };
  observe('paint', (e) => { if (e.name === 'first-contentful-paint') qa.fcp = e.startTime; });
  observe('largest-contentful-paint', (e) => { qa.lcp = e.startTime; });
  observe('longtask', (e) => { qa.longTasks += 1; qa.tbt += Math.max(0, e.duration - 50); });
  observe('layout-shift', (e) => { if (!e.hadRecentInput) qa.cls += e.value; });
};

async function newContext(browser) {
  const context = await browser.newContext({ ...device, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await context.addInitScript(OBSERVERS);
  return context;
}

// Attach listeners that collect everything a single page load does.
function instrument(page) {
  const log = { consoleErrors: [], pageErrors: [], failed: [], http: [], api: [], requests: 0 };
  page.on('console', (msg) => {
    if (msg.type() === 'error') log.consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on('pageerror', (err) => log.pageErrors.push(String(err?.message || err).slice(0, 300)));
  page.on('requestfailed', (req) => {
    const reason = req.failure()?.errorText || 'failed';
    if (reason.includes('ERR_ABORTED')) return; // navigation/cancel, not a user-visible failure
    log.failed.push(`${req.method()} ${safeUrl(req.url())} — ${reason}`);
  });
  page.on('requestfinished', async (req) => {
    log.requests += 1;
    const res = await req.response().catch(() => null);
    const status = res?.status() ?? 0;
    const url = safeUrl(req.url());
    if (status >= 400) log.http.push(`${status} ${req.method()} ${url}`);
    let host = '';
    try { host = new URL(req.url()).hostname; } catch { /* ignore */ }
    if (SUPABASE_HOST.test(host) && req.method() !== 'OPTIONS') {
      const t = req.timing();
      const ms = t.responseEnd > 0 ? Math.round(t.responseEnd) : null;
      const headers = await res?.allHeaders().catch(() => ({})) ?? {};
      const requestId = headers['x-request-id'] ?? null;
      const cfRay = headers['cf-ray'] ?? null;
      const startedAt = Number.isFinite(t.startTime) && t.startTime > 0
        ? new Date(t.startTime).toISOString()
        : null;
      log.api.push({ method: req.method(), url, status, ms, startedAt, requestId, cfRay, ...splitTiming(t) });
    }
  });
  return log;
}

async function settle(page, startedAt) {
  await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
  // "Ready" = content painted and no spinner left (RN-web ActivityIndicator is
  // role="progressbar"). A query retry can still be in flight after network idle.
  await page.waitForFunction(() => document.body.innerText.trim().length >= 5
    && ![...document.querySelectorAll('[role="progressbar"]')].some((el) => el.getClientRects().length > 0),
  null, { timeout: SPINNER_GRACE_MS, polling: 200 }).catch(() => {});
  const readyMs = Date.now() - startedAt;
  const spinners = await page.locator('[role="progressbar"]:visible').count().catch(() => 0);
  const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
  const errorCopy = bodyText.match(ERROR_COPY)?.[0] ?? null;
  return { readyMs, spinners, errorCopy, blank: bodyText.trim().length < 5 };
}

async function collectMetrics(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const js = performance.getEntriesByType('resource')
      .filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js'))
      .reduce((sum, r) => sum + (r.transferSize || r.encodedBodySize || 0), 0);
    const qa = window.__qa || {};
    return {
      ttfbMs: nav ? Math.round(nav.responseStart) : null,
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      fcpMs: qa.fcp != null ? Math.round(qa.fcp) : null,
      lcpMs: qa.lcp != null ? Math.round(qa.lcp) : null,
      tbtMs: Math.round(qa.tbt || 0),
      longTasks: qa.longTasks || 0,
      cls: Math.round((qa.cls || 0) * 1000) / 1000,
      jsKb: Math.round(js / 1024),
    };
  });
}

function judge(result, { throttled = false } = {}) {
  const where = `${result.label}`;
  const m = result.metrics;
  if (result.loadError) finding('High', where, '페이지를 열지 못함', result.loadError);
  if (result.blank) finding('High', where, '빈 화면 (본문 텍스트 없음)', `ready ${result.readyMs}ms 후 body 텍스트 5자 미만`);
  if (result.errorCopy) finding('High', where, '화면에 오류 문구 노출', `"${result.errorCopy}"`);
  if (result.spinners > 0) finding('High', where, '로딩 스피너가 끝나지 않음', `네트워크 안정 후 ${SPINNER_GRACE_MS / 1000}초가 지나도 progressbar ${result.spinners}개 표시`);
  result.log.pageErrors.forEach((e) => finding('High', where, '처리되지 않은 JS 예외', e));
  result.log.http.filter((h) => h.startsWith('5')).forEach((h) => finding('High', where, '서버 5xx 응답', h));
  result.log.http.filter((h) => h.startsWith('4')).forEach((h) => finding('Medium', where, 'HTTP 4xx 응답', h));
  result.log.failed.forEach((f) => finding('Medium', where, '요청 실패', f));
  const uniqueConsole = [...new Set(result.log.consoleErrors)];
  uniqueConsole.slice(0, 5).forEach((e) => finding('Medium', where, '콘솔 에러', e));

  const slowApi = result.log.api.filter((a) => a.ms != null && a.ms > LIMITS.apiMs);
  slowApi.forEach((a) => finding(throttled ? 'Low' : 'Medium', where, 'Supabase 응답 지연', `${a.method} ${a.url} ${a.ms}ms (기준 ${LIMITS.apiMs}ms) · ${timingText(a)}`));
  if (result.log.api.length > LIMITS.apiCallsPerPage) {
    finding('Medium', where, 'Supabase 호출 과다 (N+1 의심)', `한 화면에서 ${result.log.api.length}회 (기준 ${LIMITS.apiCallsPerPage})`);
  }
  if (!m) return;
  if (throttled) {
    if (m.lcpMs != null && m.lcpMs > LIMITS.throttledLcpMs) finding('Medium', where, '저속 모바일 환경 LCP 느림', `${m.lcpMs}ms (기준 ${LIMITS.throttledLcpMs}ms)`);
    if (result.readyMs > LIMITS.throttledReadyMs) finding('Medium', where, '저속 모바일 환경 화면 준비 느림', `${result.readyMs}ms (기준 ${LIMITS.throttledReadyMs}ms)`);
    return;
  }
  if (m.ttfbMs != null && m.ttfbMs > LIMITS.ttfbMs) finding('Low', where, 'TTFB 느림', `${m.ttfbMs}ms (기준 ${LIMITS.ttfbMs}ms)`);
  if (m.fcpMs != null && m.fcpMs > LIMITS.fcpMs) finding('Medium', where, '첫 화면 표시(FCP) 느림', `${m.fcpMs}ms (기준 ${LIMITS.fcpMs}ms)`);
  if (result.readyMs > LIMITS.readyMs) finding('Medium', where, '화면 준비(네트워크 안정)까지 느림', `${result.readyMs}ms (기준 ${LIMITS.readyMs}ms)`);
  if (m.jsKb > LIMITS.jsKb) finding('Medium', where, 'JS 전송량 과다', `${m.jsKb}KB (기준 ${LIMITS.jsKb}KB)`);
  if (m.tbtMs > LIMITS.tbtMs) finding('Medium', where, '메인 스레드 블로킹(TBT) 큼', `${m.tbtMs}ms, long task ${m.longTasks}개`);
  if (m.cls > LIMITS.cls) finding('Low', where, '레이아웃 흔들림(CLS)', `${m.cls}`);
}

async function loadPage(browser, route, { label = route, throttle = false, screenshot = true } = {}) {
  const context = await newContext(browser);
  const page = await context.newPage();
  const log = instrument(page);
  if (throttle) {
    // Roughly Lighthouse "slow 4G" + mid-range phone CPU.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  const startedAt = Date.now();
  let loadError = null;
  try {
    const res = await page.goto(BASE_URL + route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (res && res.status() >= 400) loadError = `HTTP ${res.status()}`;
  } catch (err) {
    loadError = String(err?.message || err).split('\n')[0];
  }
  const state = await settle(page, startedAt);
  const metrics = loadError ? null : await collectMetrics(page).catch(() => null);
  if (screenshot) {
    const file = `${label.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, file) }).catch(() => {});
  }
  const result = { label, route, throttled: throttle, loadError, ...state, metrics, log, finalPath: new URL(page.url()).pathname };
  return { result, context, page };
}

function summarizeApi(api) {
  const times = api.map((a) => a.ms).filter((n) => n != null).sort((a, b) => a - b);
  const pick = (q) => (times.length ? times[Math.min(times.length - 1, Math.floor(q * times.length))] : null);
  return { calls: api.length, p50: pick(0.5), p95: pick(0.95), max: times.at(-1) ?? null };
}

function endpointKey(safe) {
  const slash = safe.indexOf('/');
  const pathname = slash >= 0 ? safe.slice(slash + 1) : safe;
  if (pathname.startsWith('storage/v1/object/public/item-photos/')) return 'storage/v1/object/public/item-photos/*';
  if (pathname.startsWith('storage/v1/object/public/brand-logos/')) return 'storage/v1/object/public/brand-logos/*';
  return pathname;
}

function endpointCounts(api) {
  const counts = new Map();
  for (const request of api) {
    const key = endpointKey(request.url);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Keep this retired call visible as an explicit zero so Daily QA can prove it
  // did not silently return after #658 removed the home editorial request.
  const retiredEditorial = 'rest/v1/rpc/home_editorial_items';
  if (!counts.has(retiredEditorial)) counts.set(retiredEditorial, 0);
  return [...counts.entries()]
    .map(([endpoint, calls]) => ({ endpoint, calls }))
    .sort((a, b) => b.calls - a.calls || a.endpoint.localeCompare(b.endpoint));
}

// Open the first recommended card from home and time the in-app transition.
async function homeToDetail(browser) {
  const { context, page } = await loadPage(browser, '/', { label: 'home→detail', screenshot: false });
  try {
    const card = page.locator('[aria-label$="상세 보기"]').first();
    if (!(await card.count())) {
      finding('Low', 'home→detail', '홈에서 상세로 이동할 카드를 찾지 못함', '추천/피드 카드가 비어 있을 수 있음 — 스크린샷 확인');
      return null;
    }
    const before = page.url();
    const log = instrument(page);
    const startedAt = Date.now();
    await card.click();
    await page.waitForURL((u) => u.toString() !== before, { timeout: 10_000 });
    const state = await settle(page, startedAt);
    await page.screenshot({ path: path.join(OUT_DIR, 'home_to_detail.png') }).catch(() => {});
    const transition = { label: 'home→detail', route: new URL(page.url()).pathname, ...state, metrics: null, log, loadError: null, throttled: false };
    judge(transition);
    if (state.readyMs > LIMITS.transitionMs) finding('Medium', 'home→detail', '홈→상세 화면 전환 느림', `${state.readyMs}ms (기준 ${LIMITS.transitionMs}ms)`);
    return transition;
  } catch (err) {
    finding('Medium', 'home→detail', '홈→상세 이동 실패', String(err?.message || err).split('\n')[0]);
    return null;
  } finally {
    await context.close();
  }
}

function median(values) {
  const v = values.filter((n) => n != null).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}

// Budgets checked for the PR verdict: only real page loads count (transitions
// and the throttled run have their own, looser limits already judged above).
function budgetViolations(pages) {
  const violations = [];
  for (const p of pages) {
    if (p.throttled || !p.metrics) continue;
    const m = p.metrics;
    const push = (metric, value, limit) => violations.push({ page: p.label, metric, value, limit });
    if (m.jsKb > LIMITS.jsKb) push('jsKb', m.jsKb, LIMITS.jsKb);
    if (m.fcpMs != null && m.fcpMs > LIMITS.fcpMs) push('fcpMs', m.fcpMs, LIMITS.fcpMs);
    if (p.readyMs > LIMITS.readyMs) push('readyMs', p.readyMs, LIMITS.readyMs);
    const apiCalls = p.log?.api?.length ?? 0;
    if (apiCalls > LIMITS.apiCallsPerPage) push('supabaseCallsPerPage', apiCalls, LIMITS.apiCallsPerPage);
  }
  return violations;
}

function buildVerdict(report) {
  const violations = budgetViolations(report.pages);
  const hasHighFinding = report.findings.some((f) => f.severity === 'High');
  return { pass: !hasHighFinding && violations.length === 0, budgetViolations: violations, findings: report.findings };
}

function toMarkdown(report) {
  const order = { High: 0, Medium: 1, Low: 2 };
  const sorted = [...report.findings].sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = ['High', 'Medium', 'Low'].map((s) => `${s} ${report.findings.filter((f) => f.severity === s).length}`).join(' · ');
  const row = (p) => {
    const m = p.metrics || {};
    const api = summarizeApi(p.log.api);
    const status = p.loadError ? '❌' : (p.errorCopy || p.spinners || p.blank || p.log.pageErrors.length ? '⚠️' : '✅');
    return `| ${status} ${p.label} | ${m.ttfbMs ?? '-'} | ${m.fcpMs ?? '-'} | ${m.lcpMs ?? '-'} | ${p.readyMs ?? '-'} | ${m.jsKb ?? '-'} | ${m.tbtMs ?? '-'} | ${api.calls} / ${api.p95 ?? '-'} | ${p.log.pageErrors.length + p.log.consoleErrors.length} |`;
  };
  const lines = [
    `## 라이브 웹 QA — ${report.baseUrl}`,
    '',
    `실행: ${report.startedAt} · 기기: iPhone 13 에뮬레이션 (비로그인) · 결과: ${counts}`,
    report.deployment ? `배포 커밋: \`${report.deployment.commitSha ?? 'unknown'}\` (${report.deployment.branch ?? '-'})` : '배포 메타데이터: 확인 불가',
    '',
    `홈 콜드 로드 중앙값(${HOME_RUNS}회): FCP ${report.homeMedian.fcpMs ?? '-'}ms · LCP ${report.homeMedian.lcpMs ?? '-'}ms · 준비 ${report.homeMedian.readyMs ?? '-'}ms`,
    '',
    '| 화면 | TTFB | FCP | LCP | 준비(ms) | JS(KB) | TBT | Supabase 호출/p95(ms) | JS 에러 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.pages.map(row),
    '',
    '### 발견 사항',
    '',
    ...(sorted.length ? sorted.map((f) => `- **${f.severity}** · ${f.where} · ${f.what} — ${f.evidence}${f.count > 1 ? ` (×${f.count})` : ''}`) : ['- 없음']),
    '',
  ];
  if (report.homeEndpointCounts?.length) {
    lines.push('### 홈 Supabase 엔드포인트 호출 수', '',
      '| 엔드포인트 | 호출 수 |', '| --- | ---: |',
      ...report.homeEndpointCounts.map(({ endpoint, calls }) => `| \`${endpoint}\` | ${calls} |`), '');
  }
  const slowest = report.pages.flatMap((p) => p.log.api.map((a) => ({ ...a, page: p.label })))
    .filter((a) => a.ms != null).sort((a, b) => b.ms - a.ms).slice(0, 8);
  if (slowest.length) {
    lines.push('### 가장 느린 Supabase 요청', '',
      '| ms | 요청 | 화면 | 연결(새 연결만) | 대기 | 서버 응답 | 다운로드 |', '| --- | --- | --- | --- | --- | --- | --- |',
      ...slowest.map((a) => `| ${a.ms} | ${a.method} ${a.url} (${a.status}) | ${a.page} | ${a.reused ? '재사용' : `${connectMs(a)} (DNS ${a.dnsMs}·TCP ${a.tcpMs}·TLS ${a.tlsMs})`} | ${a.waitMs} | ${a.serverMs} | ${a.downloadMs} |`), '');
  }
  // Connection cost vs server cost: for each screen, how many requests opened a
  // new connection and where the median request spent its time. Lets a reader tell
  // "the runner is far from the database" (connection/server round trip dominates)
  // from "the query is slow" (server response dominates on reused connections).
  const timed = report.pages.map((p) => ({ label: p.label, api: p.log.api.filter((a) => a.ms != null) })).filter((p) => p.api.length);
  if (timed.length) {
    lines.push('### Supabase 지연 구성 (요청 중앙값, ms)', '',
      '| 화면 | 요청 수 | 새 연결 | 새 연결 비용 | 대기 | 서버 응답(재사용 연결) | 서버 응답(새 연결) | 다운로드 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...timed.map(({ label, api }) => {
        const fresh = api.filter((a) => !a.reused);
        const reused = api.filter((a) => a.reused);
        const cell = (v) => (v == null ? '-' : v);
        return `| ${label} | ${api.length} | ${fresh.length} | ${cell(median(fresh.map(connectMs)))} | ${cell(median(api.map((a) => a.waitMs)))} | ${cell(median(reused.map((a) => a.serverMs)))} | ${cell(median(fresh.map((a) => a.serverMs)))} | ${cell(median(api.map((a) => a.downloadMs)))} |`;
      }), '',
      '읽는 법: "서버 응답(재사용 연결)"이 크면 쿼리·서버 처리가 느린 것이고, "새 연결 비용"과 "서버 응답(새 연결)"만 크면 러너↔Supabase 거리·핸드셰이크 비용입니다. "대기"가 크면 브라우저 동시 요청 큐잉입니다.', '');
  }
  return lines.join('\n');
}

async function readDeployment() {
  try {
    const res = await fetch(`${BASE_URL}/deployment.json`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  try {
    const homeRuns = [];
    for (let i = 0; i < HOME_RUNS; i += 1) {
      const { result, context } = await loadPage(browser, '/', { label: i === 0 ? 'home' : `home#${i + 1}`, screenshot: i === 0 });
      await context.close();
      homeRuns.push(result);
    }
    // Judge only the first home run to avoid triple-reporting the same issue.
    judge(homeRuns[0]);
    pages.push(homeRuns[0]);

    for (const route of COLD_PATHS.slice(1)) {
      const { result, context } = await loadPage(browser, route);
      await context.close();
      judge(result);
      pages.push(result);
    }

    if (QA_MODE !== 'pr') {
      const transition = await homeToDetail(browser);
      if (transition) pages.push(transition);

      const { result: slow, context: slowContext } = await loadPage(browser, '/', { label: 'home (저속 4G·CPU 4x)', throttle: true });
      await slowContext.close();
      judge(slow, { throttled: true });
      pages.push(slow);
    }

    const report = {
      baseUrl: BASE_URL,
      startedAt,
      deployment: await readDeployment(),
      limits: LIMITS,
      homeMedian: {
        fcpMs: median(homeRuns.map((r) => r.metrics?.fcpMs)),
        lcpMs: median(homeRuns.map((r) => r.metrics?.lcpMs)),
        readyMs: median(homeRuns.map((r) => r.readyMs)),
      },
      homeEndpointCounts: endpointCounts(homeRuns[0]?.log?.api ?? []),
      pages,
      findings,
    };
    const markdown = toMarkdown(report);
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'report.md'), markdown);
    const verdict = buildVerdict(report);
    fs.writeFileSync(path.join(OUT_DIR, 'verdict.json'), JSON.stringify(verdict, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    // Markers let the daily Claude QA routine pull the report out of the job log.
    console.log(`===QA-REPORT-BEGIN===\n${markdown}\n===QA-REPORT-END===`);
    if (QA_MODE === 'pr' && !verdict.pass) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('live QA crashed:', err);
  process.exit(1);
});
