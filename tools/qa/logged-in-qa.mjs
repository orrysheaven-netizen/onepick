// Logged-in user-flow QA of the OnePick tester site with the dedicated QA
// general-user account. Checks that the core UI a signed-in phone user needs is
// present, visible and clickable, and walks: login → home → search → pick
// registration → link category suggestion → profile → settings → public profile →
// notifications → share/deep link, plus read-only own picks list and pick comment area. The MVP shows
// the public-profile follow CTA, while the following-feed scope and follow notification setting stay hidden.
//
// Credential rules (docs/daily-qa.md "로그인 상태 QA 계정 규칙"):
// - ONEPICK_QA_EMAIL / ONEPICK_QA_PASSWORD come only from the environment
//   (GitHub Environment `daily-qa` secrets). Missing → skip, exit 0.
// - They are never printed, written to the report or shown on screen. The app
//   only offers social login, so the session is created with Supabase's
//   password grant from Node and handed to the browser; no login form is typed.
// - No screenshot is taken of the own profile screens, and the QA username is
//   masked in every screenshot and redacted from the report.
// - Read-only: nothing is submitted or shared. Buttons with side
//   effects are only checked for actionability (Playwright trial click). The
//   link suggestion lookup is pressed because it only reads the taxonomy.
//
// Output: <out>/logged-in-report.json, <out>/logged-in-report.md, screenshots.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from 'playwright';
import {
  SUGGESTION_ROUTE, ownProfileUsername, assertOwnProfile, assertPublicProfile, checkMenuSelection, assertNotifications,
  openHomeSearch, submitHomeSearch, openOwnComments, openNotificationsTab,
  assertFollowScopeHidden, assertFollowCtaVisible, assertFollowSettingHidden,
  pickIdSource, pickIdsFromResponse, assertPickConversation,
} from './logged-in-contract.mjs';

const BASE_URL = (process.env.QA_BASE_URL || 'https://onepick-5cl.pages.dev').replace(/\/$/, '');
const OUT_DIR = path.resolve(process.env.QA_OUT_DIR || 'qa-output');
const SEARCH_QUERY = process.env.QA_SEARCH_QUERY || '라면';
// Registration is link-first (#794): /pick/new starts with a Naver-map URL.
// Daily QA deliberately chooses the visible "URL 없음" fallback, then uses a
// query with >20 production catalog rows so #811 pagination is exercised.
const STORE_QUERY = process.env.QA_STORE_QUERY || '카페인중독';
const MENU_QUERY = process.env.QA_MENU_QUERY || '도가니탕';
// Opt-in registration safety only; not a guarantee that the entire live QA is offline.
const BLOCK_MENU_AI = process.env.QA_BLOCK_MENU_AI === '1';
// A non-Naver link keeps the check deterministic: the Edge Function does not fetch
// it, so the suggestion comes only from the typed name matching the taxonomy.
const LINK_URL = process.env.QA_LINK_URL || 'https://example.com/onepick-qa';
const LINK_NAME = process.env.QA_LINK_NAME || '도가니탕';
const LINK_EXPECT_CATEGORY = process.env.QA_LINK_EXPECT_CATEGORY || '도가니탕';
const EMAIL = process.env.ONEPICK_QA_EMAIL || '';
const PASSWORD = process.env.ONEPICK_QA_PASSWORD || '';
const STEP_TIMEOUT_MS = 15_000;
const ERROR_COPY = /(오류가 발생|문제가 발생|불러오지 못|실패했|Something went wrong|Unexpected error)/;
const SUPABASE_HOST = /\.supabase\.co$/;
const DISCOVERY_ATTEMPTS = 3;
const DISCOVERY_RETRY_MS = 30_000;

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
  // A run started right after a merge can hit Pages mid-deploy and see no Supabase call,
  // so try the page a few times before giving up.
  for (let attempt = 1; attempt <= DISCOVERY_ATTEMPTS; attempt += 1) {
    const found = await discoverSupabaseOnce(browser);
    if (found) return found;
    if (attempt < DISCOVERY_ATTEMPTS) {
      console.log(`Supabase 호출을 찾지 못함 (${attempt}/${DISCOVERY_ATTEMPTS}), ${DISCOVERY_RETRY_MS / 1000}초 뒤 재시도`);
      await new Promise((resolve) => setTimeout(resolve, DISCOVERY_RETRY_MS));
    }
  }
  return null;
}

async function discoverSupabaseOnce(browser) {
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
  let blockedMenuSuggestions = 0;
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

    const context = await browser.newContext({ ...device, locale: 'ko-KR', ...(BLOCK_MENU_AI ? { serviceWorkers: 'block' } : {}) });
    // Explicit safety mode only; do not change the scheduled QA's request policy.
    if (BLOCK_MENU_AI) await context.route(SUGGESTION_ROUTE, async (route) => {
      blockedMenuSuggestions += 1;
      await route.abort('blockedbyclient');
    });
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
      // Read the app's own profile response, not arbitrary username-looking text.
      // Keep only the username belonging to the authenticated QA user, never log the row.
      const profileResponse = page.waitForResponse(async (response) => {
        const url = new URL(response.url());
        if (url.origin !== supabase.origin || url.pathname !== '/rest/v1/profiles' || !response.ok()) return false;
        try { ownProfileUsername(await response.json(), session.user.id); return true; } catch { return false; }
      }, { timeout: STEP_TIMEOUT_MS }).catch(() => null);
      await page.goto(`${BASE_URL}/profile`, { waitUntil: 'networkidle' });
      if (await page.getByText('프로필을 완성해주세요').isVisible()) return { status: 'fail', detail: 'QA 계정에 사용자명이 없음' };
      if (await page.getByRole('button', { name: '로그인하기' }).isVisible()) throw new Error('프로필 화면이 비로그인 상태로 보임');
      const response = await profileResponse;
      if (!response) throw new Error('QA 계정의 프로필 응답을 확인하지 못함');
      qaUsername = ownProfileUsername(await response.json(), session.user.id);
      await assertOwnProfile(page, qaUsername);
      return '내 프로필 헤더 표시';
    });
    loginLabel = appReady ? '성공' : '세션 발급됨, 앱 인식 실패';
    if (!appReady) return;

    flow = '홈';
    await check(flow, '홈 화면 로드', async () => {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '메뉴 검색', exact: true }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      await noErrorCopy(page);
    });
    for (const label of ['홈', '탐색', '알림', '프로필']) {
      await check(flow, `하단 탭 "${label}"`, () => actionable(bottomTab(page, label)));
    }
    await check(flow, '하단 "원픽 등록" 버튼', () => actionable(page.getByRole('button', { name: '원픽 등록', exact: true })));
    await check(flow, '피드 카드 표시', async () => {
      const cards = page.getByRole('button', { name: / 상세 보기$/ });
      await cards.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS }).catch(() => {});
      const count = await cards.count();
      if (!count) return { status: 'warn', detail: '표시된 카드 없음' };
      return `카드 ${count}개`;
    });
    await check(flow, '팔로잉/전체 전환 비노출(초기 MVP)', async () => {
      await assertFollowScopeHidden(page, STEP_TIMEOUT_MS);
      return '전체 피드만 표시';
    });
    await shot(page, 'home');

    flow = '검색';
    let homeSearchResults = null;
    await check(flow, '검색 버튼 → 다이얼로그 열기', async () => {
      await openHomeSearch(page, STEP_TIMEOUT_MS);
      return '홈 검색 다이얼로그 표시';
    });
    await check(flow, `홈 검색 "${SEARCH_QUERY}" → 결과`, async () => {
      homeSearchResults = await submitHomeSearch(page, SEARCH_QUERY, STEP_TIMEOUT_MS);
      const count = await homeSearchResults.count();
      await noErrorCopy(page);
      return `검색 결과 ${count}개`;
    });
    await check(flow, '검색 결과 → 제품 상세 이동', async () => {
      if (!homeSearchResults) throw new Error('검색 결과 단계가 완료되지 않음');
      await homeSearchResults.first().click({ timeout: STEP_TIMEOUT_MS });
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
      await page.waitForURL(/\/pick\/new/, { timeout: STEP_TIMEOUT_MS });
      if (await page.getByText('로그인하고').first().isVisible().catch(() => false)) throw new Error('로그인 요구 화면으로 이동');
      await page.getByText('네이버 지도 링크를 입력해주세요.', { exact: true }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      await page.getByRole('button', { name: 'URL 없음', exact: true }).click({ timeout: STEP_TIMEOUT_MS });
    });
    await check(flow, '매장 검색 cold/warm + 선택 가능 (1/4 매장)', async () => {
      await page.getByText('1 / 4 · 오프라인 매장', { exact: true }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      // Measure the exact store-search RPC twice with the same request payload.
      // The first call comes from the UI and represents the cold path. The second
      // call is replayed from the same browser page so it can reuse the connection
      // and server caches without performing any write.
      const storeInput = page.getByRole('textbox', { name: '매장명 검색', exact: true });
      await storeInput.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      const rpcCalls = [];
      const rpcStarted = new WeakMap();
      const onRpcRequest = (request) => {
        const match = request.url().match(/\/rest\/v1\/rpc\/([^?]+)/);
        if (!match || request.method() !== 'POST') return;
        rpcStarted.set(request, {
          name: match[1],
          startedAt: Date.now(),
          url: request.url(),
          headers: request.headers(),
          body: request.postData(),
        });
      };
      const onRpcResponse = (response) => {
        const request = response.request();
        const pending = rpcStarted.get(request);
        if (!pending) return;
        const call = { ...pending, status: response.status(), ms: Date.now() - pending.startedAt, rows: null };
        rpcCalls.push(call);
        response.json().then((body) => {
          call.rows = Array.isArray(body) ? body.length : null;
        }).catch(() => {});
      };
      page.on('request', onRpcRequest);
      page.on('response', onRpcResponse);
      try {
        const coldUiStarted = Date.now();
        await storeInput.fill(STORE_QUERY);
        const result = page.getByRole('button', { name: /선택$/ });
        const noStore = page.getByText('매장을 찾지 못했어요', { exact: true });
        const searchError = page.getByText('검색하지 못했어요');
        await result.first().or(noStore).or(searchError).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
          .catch(() => { throw new Error(`"${STORE_QUERY}" 검색 응답 없음 · rpc=[${rpcCalls.map((c) => `${c.name} ${c.status} ${c.ms}ms`).join(', ') || '없음'}]`); });
        if (!(await result.count())) {
          const state = await searchError.isVisible().catch(() => false) ? '검색 오류 카드' : '일치 매장 없음';
          throw new Error(`"${STORE_QUERY}" ${state} · rpc=[${rpcCalls.map((c) => `${c.name} ${c.status} ${c.ms}ms`).join(', ') || '없음'}]`);
        }
        const coldUiMs = Date.now() - coldUiStarted;
        await page.waitForTimeout(50);

        const searchable = new Set(['search_store_catalog_page', 'search_store_catalog', 'search_place_catalog']);
        const coldCall = rpcCalls.find((call) => searchable.has(call.name)) ?? rpcCalls[0];
        if (!coldCall) throw new Error(`"${STORE_QUERY}" 검색 RPC를 확인하지 못함`);

        const replayHeaders = {};
        for (const name of ['apikey', 'authorization', 'content-type', 'accept', 'prefer', 'x-client-info']) {
          if (coldCall.headers[name]) replayHeaders[name] = coldCall.headers[name];
        }
        const warm = await page.evaluate(async ({ url, headers, body }) => {
          const startedAt = performance.now();
          const response = await fetch(url, { method: 'POST', headers, body });
          const json = await response.json().catch(() => null);
          return {
            status: response.status,
            rows: Array.isArray(json) ? json.length : null,
            ms: Math.round(performance.now() - startedAt),
          };
        }, { url: coldCall.url, headers: replayHeaders, body: coldCall.body });

        if (warm.status >= 400) throw new Error(`"${STORE_QUERY}" warm 검색 HTTP ${warm.status}`);
        const firstPageCount = await result.count();
        if (firstPageCount < 20) return {
          status: 'warn',
          detail: `pagination 검증 데이터 전제 불충족: "${STORE_QUERY}" 첫 페이지 ${firstPageCount}개(<20) · 제품 실패 판정 아님 · QA_STORE_QUERY로 20개 초과 검색어 지정 필요`,
        };
        const appendError = page.getByText('다음 매장을 불러오지 못했어요.', { exact: true });
        const deadline = Date.now() + STEP_TIMEOUT_MS;
        while (await result.count() <= 20 && Date.now() < deadline) {
          await result.last().scrollIntoViewIfNeeded();
          await page.mouse.wheel(0, 900);
          if (await appendError.isVisible().catch(() => false)) break;
          await page.waitForTimeout(200);
        }
        const pagedCount = await result.count();
        if (pagedCount <= 20) {
          const pageCalls = rpcCalls.filter((call) => call.name === 'search_store_catalog_page');
          const rpc = pageCalls.map((call, index) => `p${index + 1} ${call.status} ${call.ms}ms ${call.rows ?? '?'}행`).join(', ') || '페이지 RPC 없음';
          const state = await appendError.isVisible().catch(() => false) ? '추가 조회 오류 카드 표시' : '추가 결과 없음';
          throw new Error(`"${STORE_QUERY}" 21번째 이후 결과가 로드되지 않음 · ${state} · 현재 ${pagedCount}개 · rpc=[${rpc}]`);
        }
        await result.nth(20).click();
        await page.getByText(/^2 \/ 4 · /).waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
        await noErrorCopy(page);
        const rows = (value) => value == null ? '?' : value;
        return `"${STORE_QUERY}" cold RPC ${coldCall.ms}ms / warm RPC ${warm.ms}ms · UI 첫 결과 ${coldUiMs}ms · 첫 페이지 ${firstPageCount}개 → ${pagedCount}개 · 21번째 이후 매장 선택 · cold ${coldCall.name} ${coldCall.status} ${rows(coldCall.rows)}행 · warm ${warm.status} ${rows(warm.rows)}행`;
      } finally {
        page.off('request', onRpcRequest);
        page.off('response', onRpcResponse);
      }
    });
    await check(flow, '메뉴 선택 가능, "다음" 버튼 활성화 (2/4 메뉴)', async () => {
      // Step 2 selects a category for the menu; the "다음" button's press
      // (confirmMenu → selectItem.mutateAsync) is a write, so it is only
      // trial-clicked, never pressed.
      const blockedBefore = blockedMenuSuggestions;
      try {
        await checkMenuSelection(page, MENU_QUERY, STEP_TIMEOUT_MS, !BLOCK_MENU_AI);
      } catch (error) {
        if (BLOCK_MENU_AI && blockedMenuSuggestions > blockedBefore && error.code === 'QA_MENU_CHOICE_UNAVAILABLE') {
          return { status: 'warn', detail: '안전 제한으로 미검증: 메뉴 AI 요청 차단. 제품 실패/추천·다음 버튼 통과 판정 아님' };
        }
        throw error;
      }
      await noErrorCopy(page);
      return '메뉴 선택 → "다음" 버튼 활성화 (제출하지 않음)';
    });
    await shot(page, 'pick_new');

    flow = '링크 추천';
    // #366 removed the "링크로 카테고리 추천받기" entry from /pick/find; the screen itself is
    // still routed (auth intent `suggest_link_category`), so open it by URL.
    await check(flow, '링크 화면 직접 진입 (/pick/link)', async () => {
      await page.goto(`${BASE_URL}/pick/link`, { waitUntil: 'networkidle' });
      await page.getByRole('textbox', { name: '원픽 링크' }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      if (await page.getByText('추천 요청 전에 로그인합니다').isVisible().catch(() => false)) throw new Error('비로그인 안내가 표시됨');
      await noErrorCopy(page);
    });
    // A failure here must say which wait timed out and what the Edge Function answered (#315):
    // a bare locator timeout cannot tell a slow/failed function from a rendering or locator problem.
    const linkCalls = [];
    const isLinkCall = (url) => url.includes('/functions/v1/link-category-suggestions');
    const onLinkRequest = (request) => {
      if (isLinkCall(request.url()) && request.method() === 'POST') linkCalls.push({ started: Date.now(), response: null, ms: 0 });
    };
    const onLinkResponse = (response) => {
      const call = linkCalls[linkCalls.length - 1];
      if (!isLinkCall(response.url()) || response.request().method() !== 'POST' || !call || call.response) return;
      call.response = response;
      call.ms = Date.now() - call.started;
    };
    page.on('request', onLinkRequest);
    page.on('response', onLinkResponse);
    const linkCallSummary = async () => {
      if (linkCalls.length === 0) return 'Edge Function 호출 없음';
      const { response, started, ms } = linkCalls[linkCalls.length - 1];
      if (!response) return `Edge Function 응답 없음 (${Date.now() - started}ms 경과)`;
      const parts = [`Edge Function HTTP ${response.status()} · ${ms}ms`];
      const body = await Promise.race([
        response.json().catch(() => null),
        new Promise((resolve) => setTimeout(() => resolve(null), 3_000)),
      ]);
      if (body?.error) parts.push(`error=${String(body.error).slice(0, 40)}`);
      if (body && Array.isArray(body.suggestions)) {
        parts.push(`kind=${body.kind}`,
          `suggestions=[${body.suggestions.slice(0, 4).map((s) => String(s?.name).slice(0, 20)).join(', ')}]`,
          `categories=${Array.isArray(body.categories) ? body.categories.length : '?'}`);
      }
      return parts.join(' · ');
    };
    let linkPhase = '';
    const linkSuggested = await check(flow, `링크 확인 → "${LINK_EXPECT_CATEGORY}" 추천`, async () => {
      try {
        linkPhase = '입력·요청';
        await page.getByRole('textbox', { name: '원픽 링크' }).fill(LINK_URL);
        await page.getByRole('textbox', { name: '원픽 이름' }).fill(LINK_NAME);
        await page.getByRole('button', { name: '링크 확인하고 추천받기', exact: true }).click();
        linkPhase = '"추천 카테고리" 또는 오류 표시 대기';
        const section = page.getByText('추천 카테고리', { exact: true });
        const alert = page.getByRole('alert');
        await section.or(alert).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
        if (await alert.isVisible().catch(() => false)) throw new Error(`추천 오류: "${(await alert.innerText()).slice(0, 80)}"`);
        // The result title also echoes the typed name, so look only inside the suggestion card.
        // React Native Web renders <Text> as a div, so "innermost div holding the heading" is the
        // heading itself (#315). Also require the card's own "다른 카테고리 찾기" toggle, which is
        // present with or without suggestions, so the innermost match is the whole card.
        const card = page.locator('div', { has: section })
          .filter({ has: page.getByText('다른 카테고리 찾기', { exact: true }) })
          .last();
        linkPhase = '추천 후보 유무 확인';
        if (await card.getByText('자동 추천 후보가 없습니다').isVisible().catch(() => false)) throw new Error('자동 추천 후보 없음');
        linkPhase = `카드 안 "${LINK_EXPECT_CATEGORY}" 표시 대기`;
        await card.getByText(LINK_EXPECT_CATEGORY, { exact: true }).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
        linkPhase = '오류 문구 확인';
        await noErrorCopy(page);
        return { detail: `추천 후보에 표시 · ${await linkCallSummary()}` };
      } catch (error) {
        await shot(page, 'link_suggestion_failed');
        // check() keeps 200 characters, so the Edge Function summary goes before the error text.
        const message = String(error?.message ?? error).split('\n')[0].slice(0, 60);
        throw new Error(`[${linkPhase}] ${await linkCallSummary()} · ${message}`);
      }
    });
    page.off('request', onLinkRequest);
    page.off('response', onLinkResponse);
    if (linkSuggested) {
      // A single suggestion is preselected, so both follow-ups must be enabled. Neither is pressed.
      await check(flow, '"이 카테고리로 등록 요청 계속" 클릭 가능', () =>
        actionable(page.getByRole('button', { name: '이 카테고리로 등록 요청 계속', exact: true })));
      await check(flow, '"카테고리 없이 등록 요청" 클릭 가능', () =>
        actionable(page.getByRole('button', { name: '카테고리 없이 등록 요청', exact: true })));
      await shot(page, 'link_suggestion');
    } else {
      record(flow, '등록 요청 버튼 클릭 가능', 'skip', '추천 결과 없음');
    }

    flow = '프로필';
    // Comments are reached from the own profile, not a bottom tab.
    await check(flow, '프로필 탭 이동', async () => {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await bottomTab(page, '프로필').first().click();
      await page.waitForURL(/\/profile/, { timeout: STEP_TIMEOUT_MS });
      await assertOwnProfile(page, qaUsername);
    });
    await check(flow, '핵심 요소 표시', async () => {
      // No "현재 원픽" here: #308 drops that summary card from the signed-in own profile (#317).
      await actionable(page.getByRole('button', { name: '음식 원픽 보기', exact: true }));
      await actionable(page.getByRole('button', { name: '설정 열기', exact: true }));
      await noErrorCopy(page);
    });
    await check(flow, '내 원픽 목록 표시', async () => {
      // Read-only: the own picks list is only looked at; the row is trial-clicked, never opened.
      const rows = page.getByRole('button', { name: / 원픽 상세 보기$/ });
      // Empty copy per scope tab (profile.tsx): "첫 원픽을 골라보세요" / "다른 취향 원픽도 골라보세요".
      const empty = page.getByText(/첫 원픽을 골라보세요|다른 취향 원픽도 골라보세요/);
      await rows.first().or(empty).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS }).catch(() => {});
      const count = await rows.count();
      if (!count) {
        const shownEmpty = await empty.first().isVisible().catch(() => false);
        return { status: 'warn', detail: shownEmpty ? '내 원픽 없음(빈 상태 문구 표시) · 목록 확인 건너뜀' : '내 원픽 행도 빈 상태 문구도 보이지 않음 · 목록 확인 건너뜀' };
      }
      await actionable(rows);
      await noErrorCopy(page);
      return `내 원픽 ${count}개 표시`;
    });
    await check(flow, '프로필의 "내 댓글 보기"', async () => {
      await openOwnComments(page);
      const rows = page.getByRole('button', { name: /에 남긴 댓글 보기$/ });
      const empty = page.getByText('아직 남긴 댓글이 없어요');
      await rows.first().or(empty).waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      await noErrorCopy(page);
      const count = await rows.count();
      if (!count) return { status: 'warn', detail: '남긴 댓글 없음 · 이동/삭제 버튼 확인 건너뜀' };
      // Read-only: open the review the comment answers and only trial-click its 삭제 control.
      await rows.first().click();
      await page.waitForURL(/\/item\/[^/]+/, { timeout: STEP_TIMEOUT_MS });
      await actionable(page.getByRole('button', { name: '내 댓글 삭제' }));
      await noErrorCopy(page);
      return `내 댓글 ${count}개 · 상품 상세 이동 + 삭제 버튼 표시`;
    });
    await check(flow, '"공개 프로필 보기" 이동', async () => {
      if (!/\/profile/.test(page.url())) {
        await page.goto(`${BASE_URL}/profile`, { waitUntil: 'networkidle' });
      }
      await page.getByText('공개 프로필 보기').first().click();
      await page.waitForURL(/\/u\//, { timeout: STEP_TIMEOUT_MS });
      await page.waitForLoadState('networkidle');
      await assertPublicProfile(page, STEP_TIMEOUT_MS);
      await noErrorCopy(page);
    });
    // Own profile screens show the account's handle: no screenshots here.

    flow = '설정';
    await check(flow, '팔로우 알림 설정 비노출(초기 MVP)', async () => {
      await page.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle' });
      await assertFollowSettingHidden(page, STEP_TIMEOUT_MS);
      await noErrorCopy(page);
      return '차단 목록 표시 · 팔로우 알림 항목 없음';
    });

    flow = '공개 프로필';
    let otherProfilePath = null;
    await check(flow, '피드에서 다른 사용자 프로필 이동', async () => {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
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
      await check(flow, '팔로우 버튼 노출(MVP)', async () => {
        await page.waitForLoadState('networkidle');
        await assertFollowCtaVisible(page, STEP_TIMEOUT_MS);
        return '프로필 공유 버튼 표시 · 팔로우 CTA 표시';
      });
      await shot(page, 'other_profile');
    } else {
      record(flow, '팔로우 버튼 노출(MVP)', 'skip', '대상 사용자 없음');
    }

    flow = '알림';
    await check(flow, '알림 탭 진입', async () => {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await openNotificationsTab(page);
    });
    await check(flow, '알림 화면', async () => {
      await page.goto(`${BASE_URL}/notifications`, { waitUntil: 'networkidle' });
      const items = await assertNotifications(page);
      await noErrorCopy(page);
      return `알림 ${items}개`;
    });
    await shot(page, 'notifications');

    flow = '공유/딥링크';
    let pickId = null;
    await check(flow, '피드 → 상품 상세 → 원픽 공유 버튼', async () => {
      // #395: each review card's share control is now an "이 원픽 공유" icon that opens the
      // share sheet or copies the /pick/:id link at once, so it is only trial-clicked here.
      // The Pick id for the deep-link check comes from what the feed and the detail screen
      // load (home_pick_feed_page / item_review_page RPCs), preferring the opened item's Pick.
      const pickRows = [];
      const onPicksResponse = (response) => {
        const method = response.request().method();
        if (!pickIdSource(response.url(), method)) return;
        response.json().then((rows) => { pickRows.push(...pickIdsFromResponse(response.url(), method, rows)); }).catch(() => {});
      };
      page.on('response', onPicksResponse);
      try {
        await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
        const open = page.getByRole('button', { name: / 상세 보기$/ });
        await open.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
        await open.first().click();
        await page.waitForURL(/\/item\/[^/]+/, { timeout: STEP_TIMEOUT_MS });
        const itemId = decodeURIComponent(new URL(page.url()).pathname.split('/').pop() ?? '');
        const share = page.getByRole('button', { name: '이 원픽 공유', exact: true });
        await actionable(share); // trial click only; nothing is shared or copied
        const deadline = Date.now() + STEP_TIMEOUT_MS;
        while (!pickRows.length && Date.now() < deadline) await page.waitForTimeout(250);
        const chosen = pickRows.find((row) => row.itemId === itemId) ?? pickRows[0];
        if (!chosen) throw new Error('피드/상세 화면의 picks 응답에서 pickId를 찾지 못함');
        pickId = chosen.id;
        await noErrorCopy(page);
        return `/item/:id · 공유 버튼 ${await share.count()}개 (공유하지 않음)${chosen.itemId === itemId ? '' : ' · 딥링크는 피드의 다른 원픽 사용'}`;
      } finally {
        page.off('response', onPicksResponse);
      }
    });
    if (pickId) {
      await check(flow, '원픽 딥링크 직접 열기 → 한줄평 대화', async () => {
        const fresh = await context.newPage();
        try {
          await fresh.goto(`${BASE_URL}/pick/${encodeURIComponent(pickId)}`, { waitUntil: 'networkidle' });
          await assertPickConversation(fresh, pickId, STEP_TIMEOUT_MS);
          await noErrorCopy(fresh);
          await shot(fresh, 'pick_deeplink');
        } finally { await fresh.close(); }
        return '/pick/:id 한줄평 대화 표시';
      });
    }
    if (pickId) {
      await check(flow, '원픽 댓글 영역·작성 진입 표시', async () => {
        const fresh = await context.newPage();
        try {
          await fresh.goto(`${BASE_URL}/pick/${encodeURIComponent(pickId)}`, { waitUntil: 'networkidle' });
          await assertPickConversation(fresh, pickId, STEP_TIMEOUT_MS);
          await fresh.getByText('댓글', { exact: true }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
          // Read-only: the composer entry is only trial-clicked; no comment is typed or posted.
          const write = fresh.getByRole('button', { name: '댓글 쓰기', exact: true });
          if (!(await write.filter({ visible: true }).count())) {
            await noErrorCopy(fresh);
            // can_comment (item_review_page): only the Pick's owner or a member with their own active Pick
          // of the same item and channel may write, so a QA account without Picks never sees it.
          return { status: 'warn', detail: '댓글 영역 표시 · "댓글 쓰기" 없음(같은 항목에 본인 원픽이 있는 회원만 작성 가능 — QA 계정에 원픽이 없으면 정상)' };
          }
          await actionable(write);
          await noErrorCopy(fresh);
          const threads = await fresh.getByRole('button', { name: /에게 답글 달기$/ }).count();
          return `댓글 영역 표시 · "댓글 쓰기" 클릭 가능 · 답글 버튼 ${threads}개 (작성하지 않음)`;
        } finally { await fresh.close(); }
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
    if (blockedMenuSuggestions) record('원픽 등록', '안전 모드 검증 제한', 'warn', `추천 요청 ${blockedMenuSuggestions}건 차단 · 실제 AI 추천 미검증, 제품 회귀 판정 아님`);
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
