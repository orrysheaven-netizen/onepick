// #858 — authenticated draft-restore QA on the tester site (workflow_dispatch only).
//
// Walks /pick/new as the dedicated QA general user up to the 4/4 review step with a
// photo and a review kept as a draft, then reloads the same web session while menu
// classification is still pending (twice — the #858 "second cold restore" case) and
// while the current-Pick lookup fails, and checks that the original step, photo, menu
// name and store name survive and nothing is registered automatically.
//
// Safety: every non-GET request to Supabase other than auth and an allowlist of
// read-only RPCs is ABORTED before it leaves the browser (see draft-restore-contract.mjs),
// so no Production row, Storage object or paid Edge Function call can result from this
// run even if the app changes. Credentials come only from the daily-qa Environment and
// never reach logs, reports or screenshots (no screenshots are taken).
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from 'playwright';
import { isPublicKey } from './setup-qa-profile.mjs';
import {
  API, SITE, DRAFT_KEY, classifyRequest, isMenuOptionsRequest, isCurrentPickSlotRead,
  readDraftFacts, assertReviewDraftKept, safeFailureCode, assertExecution,
} from './draft-restore-contract.mjs';

const OUT_DIR = path.resolve(process.env.QA_OUT_DIR || 'qa-output');
const STEP_TIMEOUT_MS = 20_000;
// Visibly synthetic fixture; the "new store" request path never writes until the final
// "원픽 등록하기" tap, which this QA never performs.
const STORE = '원픽 QA 초안 복원 검증 전용 매장';
const MAP = `https://map.naver.com/p/search/${encodeURIComponent(STORE)}`;
const MENU = process.env.QA_MENU_QUERY || '도가니탕';
const REVIEW = 'QA 초안 복원 검증 문장이에요. 실제 방문 후기가 아니에요.';
const EMAIL = process.env.ONEPICK_QA_EMAIL || '';
const PASSWORD = process.env.ONEPICK_QA_PASSWORD || '';

const steps = [];
const secrets = [EMAIL, PASSWORD].filter(Boolean);
function redact(text) {
  let out = String(text ?? '');
  for (const value of secrets) if (value) out = out.split(value).join('***');
  return out.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<jwt>').replace(/sb_(publishable|secret)_[\w-]+/g, '<key>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>').replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi, '<uuid>');
}
function record(check, status, detail = '') { steps.push({ check, status, detail: redact(detail) }); }
// One check; a thrown error fails that check only and returns false so the flow can stop.
async function check(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    const status = typeof result === 'object' && result?.status ? result.status : 'pass';
    const detail = typeof result === 'object' && result?.detail !== undefined ? result.detail : (typeof result === 'string' ? result : '');
    record(name, status, `${detail}${detail ? ' · ' : ''}${Date.now() - started}ms`);
    return status !== 'fail';
  } catch (error) {
    record(name, 'fail', `${safeFailureCode(error)} · ${String(error?.message ?? '').split('\n')[0].slice(0, 160)}`);
    return false;
  }
}

function writeReport(summary) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const icon = { pass: '✅', fail: '❌', warn: '⚠️', skip: '⏭️' };
  const lines = ['## #858 초안 복원 QA (로그인 · 쓰기 0)', '',
    `- 대상: ${SITE} · 배포 ${summary.deployment} · 뷰포트 390×844 · ${summary.startedAt}`,
    `- 결과: 통과 ${summary.counts.pass} · 실패 ${summary.counts.fail} · 경고 ${summary.counts.warn}`,
    `- 네트워크 격리: 차단된 쓰기 시도 ${summary.network.blockedWrites} · 차단된 함수 호출 ${summary.network.blockedFunctions} · 차단된 Storage ${summary.network.blockedStorage} · 차단된 텔레메트리 ${summary.network.blockedTelemetry}`,
    `- 원픽 행 수: 시작 ${summary.picks.before ?? '?'} → 종료 ${summary.picks.after ?? '?'}`,
    '', '| 확인 | 결과 | 근거 |', '| --- | --- | --- |'];
  for (const s of steps) lines.push(`| ${s.check} | ${icon[s.status] ?? ''} ${s.status} | ${String(s.detail).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
  if (summary.pageErrors.length) { lines.push('', '### JS 예외'); for (const e of summary.pageErrors) lines.push(`- ${e}`); }
  const md = redact(lines.join('\n'));
  fs.writeFileSync(path.join(OUT_DIR, 'draft-restore-report.md'), md);
  fs.writeFileSync(path.join(OUT_DIR, 'draft-restore-report.json'), redact(JSON.stringify({ ...summary, steps }, null, 2)));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  console.log(`===QA-DRAFT-RESTORE-BEGIN===\n${md}\n===QA-DRAFT-RESTORE-END===`);
}

async function main() {
  const startedAt = new Date().toISOString();
  assertExecution(process.env);
  const browser = await chromium.launch();
  const network = { blockedWrites: 0, blockedFunctions: 0, blockedStorage: 0, blockedTelemetry: 0 };
  const picks = { before: null, after: null };
  const pageErrors = [];
  let deployment = 'unknown';
  let apikey = null, session = null, userId = null;
  const api = async (p, method = 'GET', body) => {
    const r = await fetch(`${API}${p}`, { method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { apikey, 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session.access_token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!r.ok) throw new Error('API_REQUEST_FAILED');
    const raw = await r.text();
    return raw ? JSON.parse(raw) : null;
  };
  const countPicks = async () => {
    const rows = await api(`/rest/v1/picks?user_id=eq.${userId}&select=id`);
    if (!Array.isArray(rows)) throw new Error('API_REQUEST_FAILED');
    return rows.length;
  };

  try {
    // 1. Discover the public key from the site's own requests; confirm the deploy is current main.
    const discovery = await browser.newContext({ serviceWorkers: 'block' });
    const initial = await discovery.newPage();
    initial.on('request', (r) => { if (new URL(r.url()).origin === API && isPublicKey(r.headers().apikey)) apikey = r.headers().apikey; });
    await initial.goto(SITE, { waitUntil: 'networkidle', timeout: 30_000 });
    const dep = await initial.request.get(`${SITE}/deployment.json`);
    const depJson = dep.ok() ? await dep.json().catch(() => null) : null;
    deployment = depJson?.commitSha ? depJson.commitSha.slice(0, 7) : 'unreadable';
    if (!depJson || depJson.commitSha !== process.env.GITHUB_SHA) throw new Error('DEPLOYMENT_NOT_CURRENT');
    await discovery.close();
    if (!isPublicKey(apikey)) throw new Error('PUBLIC_KEY_NOT_FOUND');
    secrets.push(apikey);

    // 2. Password grant in Node (the site only offers social login), general-user check, baseline pick count.
    const loggedIn = await check('QA 계정 로그인·일반 사용자 확인', async () => {
      session = await api('/auth/v1/token?grant_type=password', 'POST', { email: EMAIL, password: PASSWORD });
      if (!session?.access_token) throw new Error('AUTH_FAILED');
      secrets.push(session.access_token, session.refresh_token);
      const user = await api('/auth/v1/user');
      if (!user?.id || user.id !== session.user?.id) throw new Error('IDENTITY_MISMATCH');
      if (await api('/rest/v1/rpc/current_user_is_admin', 'POST', {}) !== false) throw new Error('GENERAL_USER_REQUIRED');
      userId = user.id;
      picks.before = await countPicks();
      return `세션 발급 · 일반 사용자 · 원픽 ${picks.before}건`;
    });
    if (!loggedIn) return;

    // 3. Browser context with the write firewall and the two fault switches.
    const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'ko-KR', serviceWorkers: 'block' });
    const faults = { holdMenuOptions: false, failPickSlotRead: false };
    const heldRoutes = [];
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = request.url();
      const kind = classifyRequest(url, request.method());
      if (kind !== 'allow') {
        if (kind === 'block-write') network.blockedWrites += 1;
        else if (kind === 'block-function') network.blockedFunctions += 1;
        else if (kind === 'block-storage') network.blockedStorage += 1;
        else network.blockedTelemetry += 1;
        return route.abort('blockedbyclient');
      }
      if (faults.holdMenuOptions && isMenuOptionsRequest(url)) { heldRoutes.push(route); return; } // classification stays pending
      if (faults.failPickSlotRead && isCurrentPickSlotRead(url, request.method())) return route.abort('connectionfailed');
      return route.continue();
    });
    const releaseHeld = () => { for (const r of heldRoutes.splice(0)) r.continue().catch(() => {}); };
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(redact(String(e.message).slice(0, 200))));
    const storageKey = `sb-${new URL(API).hostname.split('.')[0]}-auth-token`;
    await page.goto(`${SITE}/legal/terms`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [storageKey, JSON.stringify(session)]);
    page.setDefaultTimeout(STEP_TIMEOUT_MS);

    const stepMeta = (n) => page.getByText(new RegExp(`^${n} / 4 · `));
    const draftFacts = () => page.evaluate((k) => sessionStorage.getItem(k), DRAFT_KEY).then((raw) => readDraftFacts(raw, userId));
    const expectKept = async () => {
      // The draft effect runs after render; poll briefly before judging.
      let last;
      for (let i = 0; i < 20; i += 1) {
        try { assertReviewDraftKept(await draftFacts(), { review: REVIEW, menu: MENU, store: STORE }); return; }
        catch (error) { last = error; await page.waitForTimeout(250); }
      }
      throw last;
    };
    const next = () => page.getByRole('button', { name: '다음', exact: true }).click();

    // 4. Reach 4/4 with a draft (read-only path: a "new store" request is only staged on the final tap).
    const reached = await check('등록 1/4~4/4 진입 (새 매장 요청 경로, 제출 없음)', async () => {
      await page.goto(`${SITE}/pick/new`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'URL 없음', exact: true }).click();
      await page.getByRole('button', { name: '찾는 매장이 없어요.', exact: true }).click();
      await page.getByRole('textbox', { name: '등록 요청 이름', exact: true }).fill(STORE);
      await next();
      await page.getByRole('textbox', { name: '네이버 지도 링크', exact: true }).fill(MAP);
      // Wait for the real catalog answer so the menu is classified by exact match, not the
      // unclassified fallback; the restore scenario below depends on a classified target.
      const menusLoaded = page.waitForResponse((r) => isMenuOptionsRequest(r.url()) && r.ok(), { timeout: STEP_TIMEOUT_MS });
      await next();
      await stepMeta(2).waitFor();
      await page.getByRole('textbox', { name: '메뉴 이름', exact: true }).fill(MENU);
      await menusLoaded;
      await page.getByText('메뉴를 확인했어요. 다음으로 넘어가주세요.', { exact: true }).waitFor();
      await next();
      await stepMeta(3).waitFor();
      const png = await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = 640; c.height = 480;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 640, 480);
        g.fillStyle = '#111'; g.font = 'bold 40px sans-serif'; g.fillText('ONEPICK QA', 70, 150);
        g.font = '28px sans-serif'; g.fillText('DRAFT RESTORE TEST', 70, 220); g.fillText('NOT A REAL MENU', 70, 280);
        return c.toDataURL('image/png').split(',')[1];
      });
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: '사진 고르기', exact: true }).click();
      await (await chooser).setFiles({ name: 'onepick-qa-draft.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
      await page.getByRole('img', { name: '선택한 대표 이미지 미리보기', exact: true }).waitFor();
      await next();
      await stepMeta(4).waitFor();
      await page.getByRole('textbox', { name: '원픽 한줄평', exact: true }).fill(REVIEW);
      await expectKept();
      return '4/4 한줄평 단계 · 사진·한줄평 초안 sessionStorage 저장 확인 (step=5)';
    });
    if (!reached) return;

    // 5. Two cold restores while menu classification is pending (#858). The target step must not be lost.
    faults.holdMenuOptions = true;
    for (const n of [1, 2]) {
      const ok = await check(`분류 대기 중 재진입 ${n}회차 — 2/4에서 대기, 초안 목표 단계 유지`, async () => {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await stepMeta(2).waitFor();
        await page.waitForTimeout(1500);
        if (await stepMeta(4).isVisible().catch(() => false)) throw new Error('RESTORE_TOO_EARLY');
        if (await page.getByRole('button', { name: '원픽 등록하기', exact: true }).isVisible().catch(() => false)) throw new Error('RESTORE_TOO_EARLY');
        await expectKept();
        return `2/4 "${STORE}" 대기 · 분류 요청 보류 ${heldRoutes.length}건 · draft step=5·사진 stored 유지`;
      });
      if (!ok) return;
    }

    // 6. Classification answers → the screen resumes 4/4 on its own with everything intact, nothing submitted.
    faults.holdMenuOptions = false;
    const resumed = await check('분류 완료 후 자동 복귀 — 4/4·한줄평·사진·메뉴·매장 유지, 자동 등록 없음', async () => {
      releaseHeld();
      await stepMeta(4).waitFor();
      const meta = await stepMeta(4).innerText();
      if (!meta.includes(STORE) || !meta.includes(MENU)) throw new Error('RESTORE_FAILED');
      const review = await page.getByRole('textbox', { name: '원픽 한줄평', exact: true }).inputValue();
      if (review !== REVIEW) throw new Error('RESTORE_FAILED');
      await page.getByRole('button', { name: '원픽 등록하기', exact: true }).waitFor(); // visible, never clicked
      await expectKept();
      return '4/4 복귀 · 한줄평 원문 일치 · 매장·메뉴명 표시 · 등록 버튼 미사용';
    });
    if (!resumed) return;

    // 7. Current-Pick lookup fails during restore → stay on 2/4 with the target kept; a manual "다음" then succeeds.
    faults.failPickSlotRead = true;
    const retried = await check('복원 중 원픽 조회 실패 → 목표 유지 → 수동 "다음" 재시도 성공', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await stepMeta(2).waitFor();
      await page.getByText('메뉴를 확인했어요. 다음으로 넘어가주세요.', { exact: true }).waitFor();
      await page.getByRole('alert').first().waitFor(); // the lookup error under the menu controls
      if (await stepMeta(4).isVisible().catch(() => false)) throw new Error('RETRY_FAILED');
      await expectKept(); // target not consumed on failure (#861)
      faults.failPickSlotRead = false;
      await next();
      await stepMeta(4).waitFor();
      const review = await page.getByRole('textbox', { name: '원픽 한줄평', exact: true }).inputValue();
      if (review !== REVIEW) throw new Error('RETRY_FAILED');
      return '조회 실패 시 2/4 유지(draft step=5) · 재시도 후 4/4 복귀 · 한줄평 유지';
    });
    faults.failPickSlotRead = false;
    if (!retried) return;

    // 8. Logout isolation: a signed-out visitor never sees the draft.
    await check('로그아웃 후 /pick/new — 초안 비노출', async () => {
      await page.evaluate((k) => localStorage.removeItem(k), storageKey);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText('로그인하고 원픽을 등록해보세요.', { exact: true }).waitFor();
      if (await page.getByRole('textbox', { name: '원픽 한줄평', exact: true }).isVisible().catch(() => false)
        || await stepMeta(4).isVisible().catch(() => false)) throw new Error('LOGOUT_ISOLATION_FAILED');
      return '로그인 안내 카드 · 한줄평 입력란·4/4 비노출 (다른 계정 격리는 오프라인 harness test-pick-draft-restore가 담당)';
    });
    await context.close();
  } finally {
    // 9. Writes: none may have left the browser; the account's pick count must be unchanged.
    if (userId) await check('Production 쓰기 0 · 원픽 행 수 불변', async () => {
      picks.after = await countPicks();
      if (network.blockedWrites > 0) throw new Error('UNEXPECTED_WRITE_ATTEMPT');
      if (picks.after !== picks.before) throw new Error('PICK_COUNT_CHANGED');
      return `쓰기 시도 차단 ${network.blockedWrites}건(0이어야 함) · 함수 차단 ${network.blockedFunctions} · 텔레메트리 차단 ${network.blockedTelemetry} · 원픽 ${picks.before}→${picks.after}`;
    }).catch(() => {});
    if (session) await fetch(`${API}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey, authorization: `Bearer ${session.access_token}` } }).catch(() => {});
    await browser.close().catch(() => {});
    const counts = { pass: 0, fail: 0, warn: 0 };
    for (const s of steps) counts[s.status] = (counts[s.status] ?? 0) + 1;
    writeReport({ startedAt, deployment, counts, network, picks, pageErrors });
    process.exitCode = counts.fail === 0 && steps.length >= 7 ? 0 : 1;
  }
}

main().catch((error) => {
  console.error(`draft-restore QA aborted: ${safeFailureCode(error)}`);
  process.exitCode = 1;
});
