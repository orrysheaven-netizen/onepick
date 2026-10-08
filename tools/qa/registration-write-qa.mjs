// Manual, one-time production smoke. Never imported by the scheduled Daily QA.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { isPublicKey } from './setup-qa-profile.mjs';
import { SITE, API, STORE, MENU, REVIEW, uuid, requireCondition as need,
  assertExecution, assertSessionBudget, createWriteGuard, enterRegistration,
  PICK_COLUMNS, assertStoredFixture, safeFailureCode, safeRequestKind } from './registration-write-contract.mjs';

async function main() {
  assertExecution(process.env);
  const readOnly = process.env.QA_REGISTRATION_MODE === 'verify_existing';
  const browser = await chromium.launch();
  let session, key, guard, registration, fault = false;
  let phase = 'preflight', failureCode = null;
  let firstBlockedRequest = null;
  const completed = [];
  // Only fixed labels, enumerated codes and booleans reach the summary. No raw errors, URLs, identity,
  // response bodies, screenshots, trace or storageState artifacts are produced.
  async function request(path, method = 'GET', body) {
    const r = await fetch(`${API}${path}`, { method, redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: { apikey: key, 'content-type': 'application/json',
        ...(session ? { authorization: `Bearer ${session.access_token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    need(r.ok, 'API_REQUEST_FAILED');
    const raw = await r.text();
    return raw ? JSON.parse(raw) : null;
  }
  try {
    const discovery = await browser.newContext({ serviceWorkers: 'block' });
    const initial = await discovery.newPage();
    initial.on('request', r => {
      if (new URL(r.url()).origin === API && isPublicKey(r.headers().apikey)) key = r.headers().apikey;
    });
    await initial.goto(SITE, { waitUntil: 'networkidle', timeout: 30_000 });
    const deployment = await initial.request.get(`${SITE}/deployment.json`);
    need(deployment.ok() && (await deployment.json()).commitSha === process.env.GITHUB_SHA,
      'DEPLOYMENT_NOT_CURRENT');
    await discovery.close();
    need(isPublicKey(key), 'PUBLIC_KEY_NOT_FOUND');
    session = await request('/auth/v1/token?grant_type=password', 'POST', {
      email: process.env.ONEPICK_QA_EMAIL, password: process.env.ONEPICK_QA_PASSWORD,
    });
    need(session?.access_token, 'AUTH_FAILED');
    assertSessionBudget(session);
    const user = await request('/auth/v1/user');
    need(uuid(user?.id) && user.id === session.user?.id
      && user.email?.toLowerCase() === process.env.ONEPICK_QA_EMAIL.toLowerCase(), 'IDENTITY_MISMATCH');
    need(await request('/rest/v1/rpc/current_user_is_admin', 'POST', {}) === false, 'GENERAL_USER_REQUIRED');
    const assertEmpty = async () => {
      const rows = await request(`/rest/v1/picks?user_id=eq.${user.id}&select=id&limit=1`);
      need(Array.isArray(rows) && rows.length === 0, 'QA_ACCOUNT_ALREADY_HAS_PICKS');
    };
    if (!readOnly) await assertEmpty();
    const categories = await request(`/rest/v1/categories?name=eq.${encodeURIComponent(MENU)}&is_visible=eq.true&select=id`);
    need(Array.isArray(categories) && categories.length === 1 && uuid(categories[0].id), 'CATEGORY_AMBIGUOUS');
    const categoryId = categories[0].id;
    completed.push(readOnly ? '전용 일반 QA 계정·현재 배포 확인' : '전용 일반 QA 계정·빈 원픽·현재 배포 확인');

    const verify = async (expected = null) => {
      const rows = await request(`/rest/v1/picks?user_id=eq.${user.id}&select=${PICK_COLUMNS}`);
      need(Array.isArray(rows) && rows.length === 1 && uuid(rows[0].item_id), 'PICK_COUNT_MISMATCH');
      const items = await request(`/rest/v1/items?id=eq.${rows[0].item_id}&select=id,name,status,created_by,image_path,thumbnail_path`);
      const fixture = assertStoredFixture(rows, items, user.id, categoryId, expected);
      if (expected?.image_path) need(fixture.image_path === expected.image_path
        && fixture.thumbnail_path === expected.thumbnail_path, 'PHOTO_PERSISTENCE_FAILED');
      if (!readOnly) need(guard.uploads.map(file => `${user.id}/${file}`).includes(fixture.image_path)
        && guard.uploads.map(file => `${user.id}/${file}`).includes(fixture.thumbnail_path), 'PHOTO_PERSISTENCE_FAILED');
      return fixture;
    };
    if (readOnly) {
      phase = 'existing-fixture';
      registration = await verify();
      completed.push('기존 테스트 원픽 1건·사진 참조 확인');
    }
    guard = createWriteGuard(user.id, categoryId, {
      readOnly, existingItemId: readOnly ? registration.item_id : null,
    });

    const context = await browser.newContext({ viewport: { width: 390, height: 844 },
      locale: 'ko-KR', serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const r = route.request();
      // Exact taxonomy matching needs no model. Explicitly block optional AI,
      // telemetry, and best-effort photo cleanup without fabricating responses.
      const u = new URL(r.url());
      if (u.origin === API && ['/functions/v1/suggest-item-categories',
        '/rest/v1/client_error_events', '/rest/v1/rpc/capture_product_event'].includes(u.pathname)) {
        await route.abort('blockedbyclient'); return;
      }
      try {
        let body;
        if (r.headers()['content-type']?.includes('application/json')) body = r.postDataJSON();
        const kind = guard.admit({ url: r.url(), method: r.method(), body,
          headers: r.headers(), bytes: r.postDataBuffer()?.length ?? 0 });
        if (kind === 'block-cleanup') { await route.abort('blockedbyclient'); return; }
        if (kind === 'read') { await route.continue(); return; }
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
        need(response.ok(), 'WRITE_REQUEST_FAILED');
        if (kind === 'stage') guard.acceptStage(await response.json());
        if (kind === 'upload') guard.acceptUpload(r.url());
        if (kind === 'register') registration = guard.acceptRegistration(await response.json());
        await route.fulfill({ response });
      } catch (error) {
        failureCode ??= safeFailureCode(error);
        firstBlockedRequest ??= { phase, kind: safeRequestKind(r.url()) };
        fault = true;
        await route.abort('blockedbyclient').catch(() => {});
      }
    });
    const page = await context.newPage();
    // Create a deterministic test card with ordinary canvas APIs, not a food photo.
    await page.goto(`${SITE}/legal/terms`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(([k, v]) => localStorage.setItem(k, v),
      [`sb-${new URL(API).hostname.split('.')[0]}-auth-token`, JSON.stringify(session)]);
    if (readOnly) {
      phase = 'detail-navigation';
      await page.goto(`${SITE}/item/${registration.item_id}`, { waitUntil: 'domcontentloaded' });
    } else {
      const png = await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = 640; c.height = 480;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 640, 480);
        g.fillStyle = '#111'; g.font = 'bold 40px sans-serif'; g.fillText('ONEPICK QA', 70, 150);
        g.font = '28px sans-serif'; g.fillText('TEST IMAGE', 70, 220);
        g.fillText('NOT A REAL MENU', 70, 280);
        return c.toDataURL('image/png').split(',')[1];
      });
      phase = 'registration';
      await enterRegistration(page, Buffer.from(png, 'base64'), async () => {
        need(!fault, 'READ_PREFLIGHT_FAILED');
        await assertEmpty();
        assertSessionBudget(session);
        guard.arm();
      });
      await page.waitForURL(url => registration && url.pathname === `/item/${registration.item_id}`, { timeout: 60_000 });
      need(!fault && registration && guard.uploads.length === 2, 'REGISTRATION_NOT_VERIFIED');
      completed.push('사진 선택·원본/썸네일 업로드·등록 1회·상세 이동');
    }
    phase = 'persistence';
    registration = await verify(registration);
    completed.push('저장 데이터 재조회 확인');
    phase = 'reload';
    await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });
    phase = 'detail-title';
    await page.getByText(STORE, { exact: false }).first().waitFor({ state: 'visible', timeout: 30_000 });
    phase = 'detail-review';
    await page.getByText(REVIEW, { exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 });
    phase = 'photo-display';
    await page.getByRole('img', { name: STORE, exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(label => [...document.querySelectorAll('[aria-label]')].some(el => {
      if (el.getAttribute('aria-label') !== label) return false;
      const image = el instanceof HTMLImageElement ? el : el.querySelector('img');
      return image?.complete && image.naturalWidth > 0;
    }), STORE, { timeout: 30_000 });
    phase = 'final-persistence';
    await verify(registration);
    need(!fault, 'UNEXPECTED_REQUEST');
    completed.push('새로고침 후 상세·한줄평·저장 데이터 유지');
    phase = 'complete';
  } catch (error) {
    failureCode ??= safeFailureCode(error);
  } finally {
    let cleanupOk = true;
    try { if (session?.access_token) await request('/auth/v1/logout?scope=local', 'POST'); }
    catch { cleanupOk = false; }
    await browser.close();
    const success = phase === 'complete' && cleanupOk;
    const report = [readOnly ? '## 기존 원픽 읽기 검증' : '## 원픽 등록 쓰기 QA', '', `- 결과: ${success ? '통과' : '실패 / 수동 확인 필요'}`,
      `- 종료 단계: ${phase}`, `- 실패 코드: ${failureCode ?? (success ? 'NONE' : 'SESSION_CLEANUP_FAILED')}`, `- 세션 폐기: ${cleanupOk ? '완료' : '실패'}`,
      ...(firstBlockedRequest ? [`- 최초 차단 단계: ${firstBlockedRequest.phase}`, `- 차단 요청 종류: ${firstBlockedRequest.kind}`] : []),
      ...completed.map(s => `- ${s}`),
      '- 테스트 데이터는 자동 삭제하거나 관리자 승인하지 않아요.',
      readOnly ? '- 이번 실행은 기존 테스트 데이터만 읽어요. 신규 등록·업로드·교체·삭제하지 않아요.'
        : '- 실패 시에도 데이터가 일부 생성됐을 수 있어요. 자동 재시도하지 않아요.'].join('\n');
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
    if (!success) process.exitCode = 1;
  }
}
main().catch(() => { console.error('Registration QA stopped. No credentials or raw responses are logged.'); process.exitCode = 1; });

