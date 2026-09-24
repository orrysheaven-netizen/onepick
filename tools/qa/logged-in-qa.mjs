// Logged-in user-flow QA of the OnePick tester site with the dedicated QA
// general-user account. Checks that the core UI a signed-in phone user needs is
// present, visible and clickable, and walks: login → home → search → pick
// registration → profile → follow → notifications → share/deep link.
//
// Credential rules (docs/daily-qa.md "로그인 상태 QA 계정 규칙"):
// - ONEPICK_QA_EMAIL / ONEPICK_QA_PASSWORD come only from the environment
//   (GitHub Environment `daily-qa` secrets). Missing → skip, exit 0.
// - They are never printed, written to the report or shown on screen. The app
//   only offers social login, so the session is created with Supabase's
//   password grant from Node and handed to the browser; no login form is typed.
// - No screenshot is taken of the own profile screens, and the QA username is
//   masked in every screenshot and redacted from the report.
// - Read-only: nothing is submitted, followed or shared. Buttons with side
//   effects are only checked for actionability (Playwright trial click).
//
// Output: <out>/logged-in-report.json, <out>/logged-in-report.md, screenshots.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from 'playwright';

const BASE_URL = (process.env.QA_BASE_URL || 'https://onepick-5cl.pages.dev').replace(/\/$/, '');
const OUT_DIR = path.resolve(process.env.QA_OUT_DIR || 'qa-output');
const SEARCH_QUERY = process.env.QA_SEARCH_QUERY || '라면';
const EMAIL = process.env.ONEPICK_QA_EMAIL || '';
const PASSWORD = process.env.ONEPICK_QA_PASSWORD || '';
const STEP_TIMEOUT_MS = 15_000;
const ERROR_COPY = /(오류가 발생|문제가 발생|불러오지 못|실패했|Something went wrong|Unexpected error)/;
const SUPABASE_HOST = /\.supabase\.co$/;

// 390×844 phone viewport (iPhone 12/13/14 class).
const device = { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } };

const steps = [];
const secrets = [EMAIL, PASSWORD].filter(Boolean);
let qaUsername = null;

// Last line of defence: nothing that reaches the report may contain the
// credentials, a bearer token or the QA username.
function redact(text) {
  let out = String(text ?? '');
  for (const value of secrets) out = out.split(value).join('***');
  if (qaUsername) out = out.split(qaUsername).join('<qa-user>');
  return out
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<jwt>')
    .replace(/sb_(publishable|secret)_[\w-]+/g, '<key>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');
}

function safeUrl(raw) {
  try {
    const url = new URL(raw);
    return redact(`${url.host}${url.pathname}`);
  } catch {
    return redact(String(raw).split('?')[0].slice(0, 200));
  }
}

function writeReport(summary) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const md = renderMarkdown(summary);
  fs.writeFileSync(path.join(OUT_DIR, 'logged-in-report.json'), redact(JSON.stringify({ ...summary, steps }, null, 2)));
  fs.writeFileSync(path.join(OUT_DIR, 'logged-in-report.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  console.log(`===QA-LOGIN-REPORT-BEGIN===\n${md}\n===QA-LOGIN-REPORT-END===`);
}

function renderMarkdown(summary) {
  const icon = { pass: '✅', fail: '❌', warn: '⚠️', skip: '⏭️' };
  const lines = [
    '## 로그인 사용자 화면 QA',
    '',
    `- 대상: ${summary.baseUrl} · 뷰포트 390×844 · ${summary.startedAt}`,
    `- 로그인: ${summary.login}`,
    `- 결과: 통과 ${summary.counts.pass} · 실패 ${summary.counts.fail} · 경고 ${summary.counts.warn} · 건너뜀 ${summary.counts.skip}`,
  ];
  if (summary.note) lines.push(`- 비고: ${summary.note}`);
  if (steps.length) {
    lines.push('', '| 흐름 | 확인 | 결과 | 근거 |', '| --- | --- | --- | --- |');
    for (const s of steps) {
      lines.push(`| ${s.flow} | ${s.check} | ${icon[s.status]} ${s.status} | ${String(s.detail).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
    }
  }
  const issues = summary.runtime;
  if (issues && (issues.pageErrors.length || issues.consoleErrors.length || issues.badResponses.length)) {
    lines.push('', '### 런타임 오류');
    for (const e of issues.pageErrors) lines.push(`- JS 예외 [${e.flow}]: ${e.message}`);
    for (const e of issues.consoleErrors) lines.push(`- 콘솔 에러 [${e.flow}]: ${e.message}`);
    for (const e of issues.badResponses) lines.push(`- HTTP ${e.status} [${e.flow}]: ${e.url}`);
  }
  return redact(lines.join('\n'));
}

function record(flow, check, status, detail = '') {
  steps.push({ flow, check, status, detail: redact(detail) });
}

// Runs one check; a thrown error is a failure of that check only.
async function check(flow, name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    const status = typeof result === 'object' && result?.status ? result.status : 'pass';
    const detail = typeof result === 'object' && result?.detail !== undefined ? result.detail : (typeof result === 'string' ? result : '');
    record(flow, name, status, `${detail}${detail ? ' · ' : ''}${Date.now() - started}ms`);
    return status !== 'fail';
  } catch (error) {
    const message = String(error?.message ?? error).split('\n')[0].slice(0, 200);
    record(flow, name, 'fail', message);
    return false;
  }
}

// Visible and would receive a click (enabled, stable, not covered), without clicking.
async function actionable(locator) {
  await locator.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
  await locator.first().click({ trial: true, timeout: STEP_TIMEOUT_MS });
}

// Bottom tab bar items are `Pressable accessibilityRole="tab"` wrapped in
// expo-router `Link asChild`, which injects `role="link"` on web; RN gives `role`
// precedence, so the DOM exposes them as links. Accept either role.
function bottomTab(page, label) {
  return page.getByRole('tab', { name: label, exact: true }).or(page.getByRole('link', { name: label, exact: true }));
}

async function noErrorCopy(page) {
  const body = await page.locator('body').innerText().catch(() => '');
  const match = body.match(ERROR_COPY);
  if (match) throw new Error(`화면 오류 문구: "${match[0]}"`);
}

async function shot(page, name) {
  const mask = qaUsername ? [page.getByText(qaUsername)] : [];
  await page.screenshot({ path: path.join(OUT_DIR, `login_${name}.png`), mask }).catch(() => {});
}

async function discoverSupabase(browser) {
  // Use whatever project the deployed bundle talks to, so the token matches the site.
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  let found = null;
  page.on('request', (request) => {
    if (found) return;
    const url = new URL(request.url());
    const apikey = request.headers()['apikey'];
    if (SUPABASE_HOST.test(url.host) && apikey) found = { origin: url.origin, apikey };
  });
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
  await context.close();
  return found;
}

async function passwordLogin(supabase) {
  const response = await fetch(`${supabase.origin}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: supabase.apikey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    // Only the status and Supabase's error code; never the body.
    const code = typeof body.error_code === 'string' ? body.error_code : typeof body.error === 'string' ? body.error : 'unknown';
    throw new Error(`HTTP ${response.status} (${code.replace(/[^\w-]/g, '').slice(0, 40)})`);
  }
  secrets.push(body.access_token, body.refresh_token);
  return body;
}

async function revoke(supabase, session) {
  await fetch(`${supabase.origin}/auth/v1/logout?scope=local`, {
    method: 'POST',
    headers: { apikey: supabase.apikey, authorization: `Bearer ${session.access_token}` },
  }).catch(() => {});
}

async function main() {
  const startedAt = new Date().toISOString();
  if (!EMAIL || !PASSWORD) {
    writeReport({ baseUrl: BASE_URL, startedAt, login: '건너뜀: QA 계정 Secret 없음', counts: { pass: 0, fail: 0, warn: 0, skip: 1 } });
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  const runtime = { pageErrors: [], consoleErrors: [], badResponses: [] };
  let loginLabel = '실패';
  let supabase = null;
  let session = null;

  try {
    supabase = await discoverSupabase(browser);
    if (!supabase) throw new Error('사이트가 Supabase를 호출하지 않아 로그인 대상을 찾지 못함');
    secrets.push(supabase.apikey);

    const loggedIn = await check('로그인', 'QA 계정 비밀번호 로그인', async () => {
      session = await passwordLogin(supabase);
      return '세션 발급';
    });
    if (!loggedIn) return;

    const context = await browser.newContext({ ...device, locale: 'ko-KR' });
    const page = await context.newPage();
    let flow = '로그인';
    page.on('pageerror', (e) => runtime.pageErrors.push({ flow, message: redact(String(e.message).slice(0, 200)) }));
    page.on('console', (m) => { if (m.type() === 'error') runtime.consoleErrors.push({ flow, message: redact(m.text().slice(0, 200)) }); });
    page.on('response', (r) => { if (r.status() >= 400) runtime.badResponses.push({ flow, status: r.status(), url: safeUrl(r.url()) }); });

    // Hand the session to the app the way supabase-js stores it on web.
    const storageKey = `sb-${new URL(supabase.origin).hostname.split('.')[0]}-auth-token`;
    await page.goto(`${BASE_URL}/legal/terms`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [storageKey, JSON.stringify(session)]);

    const appReady = await check('로그인', '앱이 로그인 상태로 인식', async () => {
      await page.goto(`${BASE_URL}/profile`, { waitUntil: 'networkidle' });
      const handle = page.locator('text=/^@[a-z0-9_.]+$/i').first();
      await handle.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS }).catch(() => {});
      if (await page.getByText('프로필을 완성해주세요').isVisible()) return { status: 'fail', detail: 'QA 계정에 사용자명이 없음' };
      if (await page.getByRole('button', { name: '로그인하기' }).isVisible()) throw new Error('프로필 화면이 비로그인 상태로 보임');
      qaUsername = (await handle.innerText()).trim().replace(/^@/, '');
      return '내 프로필 헤더 표시';
    });
    loginLabel = appReady ? '성공' : '세션 발급됨, 앱 인식 실패';
    if (!appReady) return;

    flow = '홈';
    await check(flow, '홈 화면 로드', async () => {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await page.getByRole('textbox', { name: '항목명 검색' }).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      await noErrorCopy(page);
    });
    for (const label of ['홈', '탐색', '내 프로필']) {
      await check(flow, `하단 탭 "${label}"`, () => actionable(bottomTab(page, label)));
    }
    await check(flow, '하단 "원픽 등록" 버튼', () => actionable(page.getByRole('button', { name: '원픽 등록', exact: true })));
    await check(flow, '팔로잉/전체 피드 전환(로그인 전용)', async () => {
      await actionable(page.getByRole('tab', { name: '팔로잉 원픽 보기' }));
      await actionable(page.getByRole('tab', { name: '전체 원픽 보기' }));
    });
    await check(flow, '피드 카드 표시', async () => {
      const cards = page.getByRole('button', { name: /제품 상세 보기$/ });
      await cards.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS }).catch(() => {});
      const count = await cards.count();
      if (!count) return { status: 'warn', detail: '표시된 카드 없음' };
      return `카드 ${count}개`;
    });
    await shot(page, 'home');

    flow = '검색';
    await check(flow, `홈 검색 "${SEARCH_QUERY}" 즉시 결과`, async () => {
      await page.getByRole('textbox', { name: '항목명 검색' }).first().fill(SEARCH_QUERY);
      const count = page.getByText(/^검색 결과/).first();
      await count.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      await noErrorCopy(page);
      return await count.innerText();
    });
    await check(flow, '검색 실행 → 탐색 검색 화면', async () => {
      await page.getByRole('button', { name: '검색 실행' }).click();
      await page.waitForURL(/\/explore/, { timeout: STEP_TIMEOUT_MS });
      await page.getByText(/^검색 결과/).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      await noErrorCopy(page);
    });
    await check(flow, '검색 결과 → 제품 상세 이동', async () => {
      const results = page.getByRole('button', { name: / 상세 보기$/ });
      const labels = await results.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
      const index = labels.findIndex((label) => !label.endsWith('제품 상세 보기'));
      if (index < 0) return { status: 'warn', detail: '검색 결과 0개' };
      await results.nth(index).click();
      await page.waitForURL(/\/item\//, { timeout: STEP_TIMEOUT_MS });
      await page.waitForLoadState('networkidle');
      await noErrorCopy(page);
      return '/item/:id';
    });
    await shot(page, 'search_item');

    flow = '원픽 등록';
    await check(flow, '등록 화면 진입', async () => {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '원픽 등록', exact: true }).click();
      await page.waitForURL(/\/pick\/find/, { timeout: STEP_TIMEOUT_MS });
      if (await page.getByText('로그인하고').first().isVisible().catch(() => false)) throw new Error('로그인 요구 화면으로 이동');
    });
    await check(flow, '등록할 항목 검색·선택 가능', async () => {
      const input = page.getByRole('textbox', { name: /원픽 .*검색$/ }).first();
      await input.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      if (!(await input.isEditable())) throw new Error('검색 입력이 비활성');
      await input.fill(SEARCH_QUERY);
      const choose = page.getByRole('button', { name: / 원픽 선택$| 선택$/ });
      await choose.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      await actionable(choose);
      await noErrorCopy(page);
      return `선택 버튼 ${await choose.count()}개 (제출하지 않음)`;
    });
    await shot(page, 'pick_find');

    flow = '프로필';
    await check(flow, '내 프로필 탭 이동', async () => {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await bottomTab(page, '내 프로필').first().click();
      await page.waitForURL(/\/profile/, { timeout: STEP_TIMEOUT_MS });
      await page.getByText(`@${qaUsername}`, { exact: true }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    });
    await check(flow, '핵심 요소 표시', async () => {
      await page.getByText('카테고리별 원픽').first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      await page.getByText('현재 원픽').first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      await actionable(page.getByRole('button', { name: '프로필과 제품 등록 요청 상태 새로고침' }));
      await noErrorCopy(page);
    });
    await check(flow, '"공개 프로필 보기" 이동', async () => {
      await page.getByText('공개 프로필 보기').first().click();
      await page.waitForURL(/\/u\//, { timeout: STEP_TIMEOUT_MS });
      await page.waitForLoadState('networkidle');
      await noErrorCopy(page);
    });
    // Own profile screens show the account's handle: no screenshots here.

    flow = '팔로우';
    let otherProfilePath = null;
    await check(flow, '피드에서 다른 사용자 프로필 이동', async () => {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: '전체 원픽 보기' }).click().catch(() => {});
      const people = page.getByRole('button', { name: /^@.+ 프로필 보기$/ });
      await people.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      const names = await people.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
      const index = names.findIndex((name) => name && name !== `@${qaUsername} 프로필 보기`);
      if (index < 0) return { status: 'warn', detail: '피드에 다른 사용자 없음' };
      await people.nth(index).click();
      await page.waitForURL(/\/u\//, { timeout: STEP_TIMEOUT_MS });
      otherProfilePath = new URL(page.url()).pathname;
    });
    if (otherProfilePath) {
      await check(flow, '팔로우 버튼 클릭 가능', async () => {
        const button = page.getByRole('button', { name: /^@.+ 팔로우( 취소)?$/ });
        await actionable(button);
        const label = await button.first().getAttribute('aria-label');
        return `${label?.endsWith('취소') ? '팔로우 중' : '팔로우 전'} 상태 (누르지 않음)`;
      });
      await shot(page, 'other_profile');
    } else {
      record(flow, '팔로우 버튼 클릭 가능', 'skip', '대상 사용자 없음');
    }

    flow = '알림';
    await check(flow, '알림 진입 버튼', async () => {
      for (const route of ['/', '/profile']) {
        await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle' });
        const button = page.getByRole('button', { name: /^알림 열기/ });
        if (await button.count()) { await actionable(button); return `${route}에서 발견`; }
      }
      return { status: 'warn', detail: '홈·내 프로필에 알림 진입 버튼 없음 (/notifications 직접 이동만 가능)' };
    });
    await check(flow, '알림 화면', async () => {
      await page.goto(`${BASE_URL}/notifications`, { waitUntil: 'networkidle' });
      await actionable(page.getByRole('button', { name: '홈으로' }));
      if (await page.getByText('로그인하면 내 원픽에 달린 댓글').isVisible()) throw new Error('비로그인 안내가 표시됨');
      await noErrorCopy(page);
      const items = await page.getByRole('button', { name: /알림, @/ }).count();
      return `알림 ${items}개`;
    });
    await shot(page, 'notifications');

    flow = '공유/딥링크';
    let pickPath = null;
    await check(flow, '피드 → 원픽 상세 이동', async () => {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: '전체 원픽 보기' }).click().catch(() => {});
      const open = page.getByRole('button', { name: /의 원픽에 의견 나누기$/ });
      await open.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      await open.first().click();
      // The card links to /pick/:id, which (since #250) redirects to /item/:itemId?pickId=:id.
      await page.waitForURL(/\/(pick|item)\/[^/]+/, { timeout: STEP_TIMEOUT_MS });
      const url = new URL(page.url());
      const focusedPickId = url.searchParams.get('pickId');
      pickPath = url.pathname.startsWith('/item/') && focusedPickId ? `/pick/${focusedPickId}` : url.pathname;
    });
    if (pickPath) {
      await check(flow, '원픽 딥링크 직접 열기 + 공유 버튼', async () => {
        const fresh = await context.newPage();
        let landed = pickPath;
        try {
          await fresh.goto(`${BASE_URL}${pickPath}`, { waitUntil: 'networkidle' });
          // Since #250 a shared /pick/:id link redirects to /item/:id?pickId=…; the
          // share card opens only after the review card's "공유" toggle is pressed.
          await fresh.waitForURL(/\/item\/[^/]+/, { timeout: STEP_TIMEOUT_MS }).catch(() => {});
          landed = new URL(fresh.url()).pathname;
          await noErrorCopy(fresh);
          const shareToggle = fresh.getByRole('button', { name: /^공유( · 신고)?$/ });
          await shareToggle.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
          await shareToggle.first().click(); // opens an in-page menu only; nothing is shared
          await fresh.getByText('이 원픽을 공유해보세요').waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
          await actionable(fresh.getByRole('button', { name: '이미지 카드 공유' }));
          await noErrorCopy(fresh);
          await shot(fresh, 'pick_deeplink');
        } finally { await fresh.close(); }
        return `${landed.replace(/[^/]+$/, ':id')} (공유하지 않음)`;
      });
    }
    if (otherProfilePath) {
      await check(flow, '프로필 딥링크 직접 열기 + 공유 버튼', async () => {
        const fresh = await context.newPage();
        try {
          await fresh.goto(`${BASE_URL}${otherProfilePath}`, { waitUntil: 'networkidle' });
          await actionable(fresh.getByRole('button', { name: '프로필 공유하기' }));
          await noErrorCopy(fresh);
        } finally { await fresh.close(); }
        return '/u/:username (공유하지 않음)';
      });
    }

    await context.close();
  } catch (error) {
    record('실행', '스크립트', 'fail', String(error?.message ?? error).split('\n')[0].slice(0, 200));
  } finally {
    if (supabase && session) await revoke(supabase, session);
    await browser.close();
    const counts = { pass: 0, fail: 0, warn: 0, skip: 0 };
    for (const s of steps) counts[s.status] += 1;
    writeReport({ baseUrl: BASE_URL, startedAt, login: loginLabel, counts, runtime });
  }
}

await main();
// A failed check is a QA finding; make it visible as a red run. Skips stay green.
if (steps.some((s) => s.status === 'fail')) process.exitCode = 1;
