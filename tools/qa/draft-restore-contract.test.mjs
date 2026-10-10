// Offline checks of the draft-restore QA policy. No browser, network, account or model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRestoreGuard, aiSuccessFixture, pickFixtureCategory, assertDraftRestoreExecution,
  inspectDraft, markPhotoLost, reassignDraftOwner, assertReviewDraft, safeRestoreFailureCode, RESTORE_FAILURE_CODES,
  isAllowedAuthMutation, isStorageRead, isMenuOptionsRequest, isCurrentPickSlotRead,
  RESTORE_MENU, RESTORE_REVIEW,
} from './draft-restore-contract.mjs';

const API = 'https://qa-project.supabase.co';
const SITE = 'https://onepick-5cl.pages.dev';
const CATEGORY = { categoryId: '11111111-2222-4333-8444-555555555555', name: '테스트 메뉴' };
const USER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER = 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const decide = (guard, method, url) => guard.decide({ url, method });

test('reads pass through on both origins; every other write fails closed', () => {
  const guard = createRestoreGuard({ api: API, site: SITE });
  assert.deepEqual(decide(guard, 'GET', `${SITE}/pick/new`), { action: 'continue' });
  assert.deepEqual(decide(guard, 'GET', `${API}/rest/v1/picks?user_id=eq.${USER}&select=id`), { action: 'continue' });
  assert.deepEqual(decide(guard, 'HEAD', `${API}/storage/v1/object/public/brand-logos/x.png`), { action: 'continue' });
  assert.deepEqual(decide(guard, 'OPTIONS', `${API}/rest/v1/rpc/store_menu_options`), { action: 'continue' });
  for (const rpc of ['search_store_catalog_page', 'store_menu_options', 'current_user_is_admin', 'notification_unread_count']) {
    assert.deepEqual(decide(guard, 'POST', `${API}/rest/v1/rpc/${rpc}`), { action: 'continue' }, rpc);
  }
  assert.equal(guard.failed, false);

  const writes = [
    ['POST', `${API}/rest/v1/rpc/register_item_pick`],
    ['POST', `${API}/rest/v1/rpc/stage_user_place_item`],
    ['POST', `${API}/rest/v1/rpc/suggest_item_map_link`],
    ['POST', `${API}/rest/v1/rpc/unknown_function`],
    ['POST', `${API}/rest/v1/picks`],
    ['PATCH', `${API}/rest/v1/profiles?id=eq.${USER}`],
    ['DELETE', `${API}/rest/v1/picks?id=eq.x`],
    ['POST', `${API}/storage/v1/object/item-photos/${USER}/a.jpg`],
    ['PUT', `${API}/storage/v1/object/item-photos/${USER}/a.jpg`],
    ['DELETE', `${API}/storage/v1/object/item-photos/${USER}/a.jpg`],
    ['POST', `${API}/auth/v1/signup`],
    ['POST', `${API}/auth/v1/token?grant_type=password`],
    ['PUT', `${API}/auth/v1/user`],
    ['POST', `${API}/auth/v1/recover`],
    ['POST', `${API}/auth/v1/user/identities`],
    ['POST', `${SITE}/anything`],
    ['PUT', `${SITE}/api/profile`],
    ['PATCH', `${SITE}/pick/new`],
  ];
  for (const [method, url] of writes) {
    const result = decide(guard, method, url);
    assert.equal(result.action, 'abort', `${method} ${url}`);
    assert.equal(result.fail, 'UNEXPECTED_WRITE', `${method} ${url}`);
    assert.ok(!JSON.stringify(result).includes(USER), 'report never carries the URL');
  }
  assert.equal(guard.failed, true);
  assert.equal(guard.counts.blockedWrites, writes.length);
  // The two auth mutations the signed-in app may legitimately issue are the only ones let through.
  assert.deepEqual(decide(guard, 'POST', `${API}/auth/v1/token?grant_type=refresh_token`), { action: 'continue' });
  assert.deepEqual(decide(guard, 'POST', `${API}/auth/v1/logout?scope=local`), { action: 'continue' });
  assert.deepEqual(decide(guard, 'GET', `${API}/auth/v1/user`), { action: 'continue' });
  assert.equal(guard.counts.blockedWrites, writes.length, 'allowed auth mutations are not findings');
  assert.ok(guard.blocked.length <= 10);
  assert.ok(guard.blocked.every((entry) => entry.code === 'UNEXPECTED_WRITE' && typeof entry.kind === 'string'));
});

// Codex review of #872 (High): Edge Functions reached by GET and non-Supabase write
// requests must not escape the guard. Functions are judged before the read allowance.
test('functions never pass by method: GET/HEAD/OPTIONS on /functions/v1 fail closed as paid calls', () => {
  const guard = createRestoreGuard({ api: API, site: SITE });
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']) {
    for (const fn of ['suggest-item-categories', 'link-category-suggestions', 'youtube-catalog', 'cleanup-item-photos']) {
      const result = decide(guard, method, `${API}/functions/v1/${fn}?x=${USER}`);
      assert.equal(result.action, 'abort', `${method} ${fn}`);
      assert.equal(result.fail, 'UNEXPECTED_FUNCTION', `${method} ${fn}`);
      assert.equal(result.kind, 'FUNCTION_REQUEST');
      assert.ok(!JSON.stringify(result).includes(USER));
    }
  }
  // POST to any function other than the intercepted menu AI is a paid call too.
  assert.equal(decide(guard, 'POST', `${API}/functions/v1/link-category-suggestions`).fail, 'UNEXPECTED_FUNCTION');
  assert.equal(guard.counts.blockedFunctions, 21);
  assert.equal(guard.counts.blockedWrites, 0);
  assert.equal(guard.failed, true, 'a blocked function call fails the run even with zero table writes');
  // The intercepted menu AI stays local in both modes and is never a finding.
  assert.equal(decide(guard, 'POST', `${API}/functions/v1/suggest-item-categories`).silent, true);
  assert.equal(guard.counts.blockedFunctions, 21);
});

test('storage: only GET/HEAD of public objects and renders pass; everything else fails closed', () => {
  const guard = createRestoreGuard({ api: API, site: SITE });
  assert.deepEqual(decide(guard, 'GET', `${API}/storage/v1/object/public/item-photos/a/b.jpg`), { action: 'continue' });
  assert.deepEqual(decide(guard, 'HEAD', `${API}/storage/v1/render/image/public/brand-logos/x.png?width=64`), { action: 'continue' });
  const denied = [
    ['GET', `${API}/storage/v1/object/item-photos/${USER}/a.jpg`], // private object read is not part of this QA
    ['GET', `${API}/storage/v1/object/sign/item-photos/${USER}/a.jpg`],
    ['GET', `${API}/storage/v1/bucket`],
    ['POST', `${API}/storage/v1/object/list/item-photos`],
    ['POST', `${API}/storage/v1/object/sign/item-photos/${USER}/a.jpg`],
    ['POST', `${API}/storage/v1/object/public/item-photos/a.jpg`],
    ['OPTIONS', `${API}/storage/v1/object/item-photos/${USER}/a.jpg`],
  ];
  for (const [method, url] of denied) {
    const result = decide(guard, method, url);
    assert.equal(result.fail, 'UNEXPECTED_WRITE', `${method} ${url}`);
    assert.equal(result.kind, 'STORAGE_REQUEST');
  }
  assert.equal(guard.counts.blockedWrites, denied.length);
  assert.equal(isStorageRead(new URL(`${API}/storage/v1/object/public/x/y`), 'GET'), true);
  assert.equal(isStorageRead(new URL(`${API}/storage/v1/object/public/x/y`), 'POST'), false);
});

test('auth allow-list is exact: refresh grant and logout only', () => {
  const ok = (p) => isAllowedAuthMutation(new URL(`${API}${p}`), 'POST');
  assert.equal(ok('/auth/v1/token?grant_type=refresh_token'), true);
  assert.equal(ok('/auth/v1/logout'), true);
  assert.equal(ok('/auth/v1/logout?scope=global'), true);
  assert.equal(ok('/auth/v1/token?grant_type=password'), false);
  assert.equal(ok('/auth/v1/token'), false);
  assert.equal(ok('/auth/v1/signup'), false);
  assert.equal(ok('/auth/v1/user'), false);
  assert.equal(ok('/auth/v1/recover'), false);
  assert.equal(ok('/auth/v1/logout/extra'), false);
  assert.equal(isAllowedAuthMutation(new URL(`${API}/auth/v1/logout`), 'PUT'), false);
  assert.equal(isAllowedAuthMutation(new URL(`${API}/auth/v1/token?grant_type=refresh_token`), 'PATCH'), false);
});

test('a non-Supabase origin never receives a write: same-site and third-party mutations do not continue', () => {
  const guard = createRestoreGuard({ api: API, site: SITE });
  for (const [method, url] of [['POST', `${SITE}/api/picks`], ['DELETE', `${SITE}/pick/1`], ['PUT', `${SITE}/`]]) {
    const result = decide(guard, method, url);
    assert.equal(result.action, 'abort'); assert.equal(result.fail, 'UNEXPECTED_WRITE'); assert.equal(result.kind, 'SITE_REQUEST');
  }
  for (const [method, url] of [['POST', 'https://other-project.supabase.co/rest/v1/picks'], ['PUT', 'https://api.example.com/upload'],
    ['DELETE', 'http://localhost:54321/rest/v1/picks'], ['POST', `https://evil.example/${encodeURIComponent(API)}`]]) {
    const result = decide(guard, method, url);
    assert.equal(result.action, 'abort', url); assert.equal(result.silent, true, url); assert.equal(result.fail, undefined, url);
  }
  assert.equal(guard.counts.blockedWrites, 3);
  assert.equal(guard.counts.externalDropped, 4);
  // No request decision ever returns 'continue' for a non-read outside the Supabase origin.
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const url of [`${SITE}/x`, 'https://cdn.example/x', 'https://ygoipwzakzdnkaaxyrgb.supabase.co.evil.example/rest/v1/picks']) {
      assert.notEqual(decide(guard, method, url).action, 'continue', `${method} ${url}`);
    }
  }
});

test('restore faults: classification can be held and the current-Pick lookup failed, nothing else changes', () => {
  const guard = createRestoreGuard({ api: API, site: SITE });
  const menu = `${API}/rest/v1/rpc/store_menu_options`;
  const slot = `${API}/rest/v1/picks?select=*&user_id=eq.${USER}&category_id=eq.${OTHER}`;
  assert.deepEqual(decide(guard, 'POST', menu), { action: 'continue' });
  assert.deepEqual(decide(guard, 'GET', slot), { action: 'continue' });
  assert.throws(() => guard.setFault('nope', true), /GUARD_FAULT_INVALID/);
  assert.throws(() => guard.setFault('holdMenuOptions', 'yes'), /GUARD_FAULT_INVALID/);

  guard.setFault('holdMenuOptions', true);
  assert.deepEqual(decide(guard, 'POST', menu), { action: 'hold' });
  assert.deepEqual(decide(guard, 'POST', `${API}/rest/v1/rpc/current_user_is_admin`), { action: 'continue' }, 'other reads unaffected');
  assert.deepEqual(decide(guard, 'GET', slot), { action: 'continue' });
  guard.setFault('holdMenuOptions', false);
  assert.deepEqual(decide(guard, 'POST', menu), { action: 'continue' });

  guard.setFault('failPickSlotRead', true);
  assert.deepEqual(decide(guard, 'GET', slot), { action: 'abort', reason: 'connectionfailed', silent: true });
  assert.deepEqual(decide(guard, 'GET', `${API}/rest/v1/picks?select=id&user_id=eq.${USER}`), { action: 'continue' }, 'pick count read is not the slot read');
  assert.deepEqual(decide(guard, 'GET', `${API}/rest/v1/items?select=*`), { action: 'continue' });
  guard.setFault('failPickSlotRead', false);
  assert.deepEqual(decide(guard, 'GET', slot), { action: 'continue' });

  assert.equal(guard.counts.held, 1);
  assert.equal(guard.counts.slotReadFailed, 1);
  assert.equal(guard.failed, false, 'injected faults are never findings');
  assert.equal(isMenuOptionsRequest(new URL(menu), 'POST'), true);
  assert.equal(isMenuOptionsRequest(new URL(menu), 'GET'), false);
  assert.equal(isCurrentPickSlotRead(new URL(slot), 'GET'), true);
  assert.equal(isCurrentPickSlotRead(new URL(slot), 'DELETE'), false);
});

test('third-party and telemetry requests are dropped without a finding', () => {
  const guard = createRestoreGuard({ api: API, site: SITE });
  assert.deepEqual(decide(guard, 'GET', 'https://fonts.gstatic.com/x.woff2'), { action: 'abort', reason: 'blockedbyclient', silent: true });
  assert.deepEqual(decide(guard, 'POST', 'https://static.cloudflareinsights.com/beacon'), { action: 'abort', reason: 'blockedbyclient', silent: true });
  assert.deepEqual(decide(guard, 'POST', `${API}/rest/v1/client_error_events`), { action: 'abort', reason: 'blockedbyclient', silent: true });
  assert.deepEqual(decide(guard, 'POST', `${API}/rest/v1/rpc/capture_product_event`), { action: 'abort', reason: 'blockedbyclient', silent: true });
  assert.equal(decide(guard, 'GET', 'not a url').fail, 'UNEXPECTED_ORIGIN');
  assert.equal(guard.counts.externalDropped, 2);
  assert.equal(guard.counts.telemetryDropped, 2);
  assert.equal(guard.counts.blockedWrites, 1);
});

test('menu AI is failed or answered by fixture per mode; never forwarded', () => {
  const guard = createRestoreGuard({ api: API, site: SITE });
  const ai = `${API}/functions/v1/suggest-item-categories`;
  assert.equal(guard.mode, 'fail');
  assert.deepEqual(decide(guard, 'POST', ai), { action: 'abort', reason: 'failed', silent: true });
  assert.throws(() => guard.setMode('success'), /FIXTURE_CATEGORY_INVALID/);
  assert.throws(() => guard.setMode('success', { categoryId: 'not-a-uuid', name: 'x' }), /FIXTURE_CATEGORY_INVALID/);
  assert.throws(() => guard.setMode('other'), /GUARD_MODE_INVALID/);
  guard.setMode('success', CATEGORY);
  const answered = decide(guard, 'POST', ai);
  assert.equal(answered.action, 'fulfill');
  assert.equal(answered.status, 200);
  assert.deepEqual(answered.json, aiSuccessFixture(CATEGORY));
  assert.equal(answered.json.suggestions[0].confidence, 'high');
  assert.equal(answered.json.needsNewCategory, false);
  guard.setMode('fail');
  assert.equal(decide(guard, 'POST', ai).reason, 'failed');
  assert.deepEqual(guard.counts, { aiFailed: 2, aiFixture: 1, placeCatalogFixture: 0, telemetryDropped: 0, externalDropped: 0,
    blockedWrites: 0, blockedFunctions: 0, held: 0, slotReadFailed: 0 });
});

test('category_uses_place_catalog is answered locally with false', () => {
  const guard = createRestoreGuard({ api: API, site: SITE });
  assert.deepEqual(decide(guard, 'POST', `${API}/rest/v1/rpc/category_uses_place_catalog`), { action: 'fulfill', status: 200, json: false });
  assert.equal(guard.counts.placeCatalogFixture, 1);
  assert.equal(guard.failed, false);
});

test('fixture category comes only from a real, place-enabled store_menu_options row', () => {
  assert.equal(pickFixtureCategory(null), null);
  assert.equal(pickFixtureCategory([{ category_id: 'bad', name: 'x', place_enabled: true }]), null);
  assert.equal(pickFixtureCategory([{ category_id: OTHER, name: '일반 메뉴', place_enabled: false }]), null);
  const rows = [
    { category_id: OTHER, name: '일반 메뉴', group_name: null, place_enabled: false },
    { category_id: CATEGORY.categoryId, name: '카탈로그 메뉴', group_name: null, place_enabled: true },
  ];
  assert.deepEqual(pickFixtureCategory(rows), { categoryId: CATEGORY.categoryId, name: '카탈로그 메뉴' });
});

test('execution gate: manual run on main with secrets only', () => {
  const ok = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'orrysheaven-netizen/onepick',
    GITHUB_RUN_ATTEMPT: '1', ONEPICK_QA_EMAIL: 'x', ONEPICK_QA_PASSWORD: 'y' };
  assert.doesNotThrow(() => assertDraftRestoreExecution(ok));
  for (const patch of [{ GITHUB_EVENT_NAME: 'schedule' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REPOSITORY: 'someone/onepick' }, { GITHUB_RUN_ATTEMPT: '2' },
    { ONEPICK_QA_EMAIL: '' }, { ONEPICK_QA_PASSWORD: undefined }]) {
    assert.throws(() => assertDraftRestoreExecution({ ...ok, ...patch }), /EXECUTION_NOT_AUTHORIZED/, JSON.stringify(patch));
  }
});

test('draft inspection and the mutations applied between reloads', () => {
  const fields = { step: 5, query: '카페', requesting: false, newName: '', mapLink: '', store: { kind: 'place', name: 'QA 매장' },
    menuQuery: RESTORE_MENU, manualCategory: false, categoryQuery: '', menu: null, pickScope: null, review: RESTORE_REVIEW };
  const raw = JSON.stringify({ v: 1, userId: USER, savedAt: 1, photo: 'stored', fields });
  const photoRaw = JSON.stringify({ v: 1, userId: USER, base64: 'AAAA', thumbnailBase64: 'BBBB', uploadId: 'u1' });
  const draft = inspectDraft(raw, photoRaw);
  assert.deepEqual(draft, { userId: USER, step: 5, review: RESTORE_REVIEW, menuQuery: RESTORE_MENU, menuName: null,
    storeName: 'QA 매장', photo: 'stored', photoRecordMatches: true });
  assert.ok(!JSON.stringify(draft).includes('AAAA'), 'photo bytes never surface');
  assert.doesNotThrow(() => assertReviewDraft(draft, { storeName: 'QA 매장', userId: USER }));
  assert.throws(() => assertReviewDraft(null, { userId: USER }), /DRAFT_MISSING/);
  assert.throws(() => assertReviewDraft({ ...draft, step: 2 }, { userId: USER }), /DRAFT_STEP_LOST/);
  assert.throws(() => assertReviewDraft({ ...draft, review: '' }, { userId: USER }), /DRAFT_REVIEW_LOST/);
  assert.throws(() => assertReviewDraft({ ...draft, photoRecordMatches: false }, { userId: USER }), /DRAFT_PHOTO_LOST/);
  assert.throws(() => assertReviewDraft(draft, { storeName: '다른 매장', userId: USER }), /DRAFT_STORE_LOST/);
  assert.throws(() => assertReviewDraft(draft, { userId: OTHER }), /DRAFT_OWNER_MISMATCH/);
  // A photo record owned by someone else is not a restorable photo.
  assert.equal(inspectDraft(raw, JSON.stringify({ v: 1, userId: OTHER, base64: 'x' })).photoRecordMatches, false);
  assert.equal(inspectDraft(raw, null).photoRecordMatches, false);
  assert.equal(inspectDraft('{not json', null), null);
  assert.equal(inspectDraft(JSON.stringify({ v: 2, fields }), null), null);

  const lost = JSON.parse(markPhotoLost(raw));
  assert.equal(lost.photo, 'lost');
  assert.deepEqual(lost.fields, fields);
  assert.throws(() => markPhotoLost(JSON.stringify({ v: 1, userId: USER, photo: 'none', fields })), /DRAFT_PHOTO_NOT_STORED/);
  const moved = JSON.parse(reassignDraftOwner(raw, OTHER));
  assert.equal(moved.userId, OTHER);
  assert.throws(() => reassignDraftOwner(raw, USER), /DRAFT_REASSIGN_INVALID/);
  assert.throws(() => reassignDraftOwner(raw, 'nope'), /DRAFT_REASSIGN_INVALID/);
});

test('failure codes are a closed vocabulary', () => {
  assert.equal(safeRestoreFailureCode(new Error('UNEXPECTED_WRITE')), 'UNEXPECTED_WRITE');
  assert.equal(safeRestoreFailureCode(new Error('PICK_COUNT_CHANGED')), 'PICK_COUNT_CHANGED');
  assert.equal(safeRestoreFailureCode(new Error('UNEXPECTED_FUNCTION')), 'UNEXPECTED_FUNCTION');
  // Unknown text — library errors, page text, anything that could carry a token — never reaches the report.
  assert.equal(safeRestoreFailureCode(new Error(`token eyJabc for ${USER}`)), 'UNCLASSIFIED_FAILURE');
  assert.equal(safeRestoreFailureCode(new Error('매장 표시 변경: "카페 어딘가"')), 'UNCLASSIFIED_FAILURE');
  assert.equal(safeRestoreFailureCode(null), 'UNCLASSIFIED_FAILURE');
  for (const code of RESTORE_FAILURE_CODES) assert.match(code, /^[A-Z_]+$/, code);
});

// The same route handler the live flow installs, exercised in a real Chromium against a
// local fixture page. Nothing leaves the browser: reads are answered by the fixture
// origin, writes must be aborted, fixtures must be parsed as JSON by page code.
test('route handler in a browser: reads answered, fixtures fulfilled, writes aborted', async () => {
  const { chromium } = await import('playwright');
  const { handleRoute, createRestoreGuard: make } = await import('./draft-restore-contract.mjs');
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const guard = make({ api: API, site: SITE });
  const blocked = [];
  let forwarded = 0;
  // Reads that the guard lets through are answered here instead of the network.
  const forward = async (route) => {
    forwarded += 1;
    const toApi = route.request().url().startsWith(API);
    await route.fulfill({ status: 200, contentType: toApi ? 'application/json' : 'text/html',
      body: toApi ? '[{"category_id":"11111111-2222-4333-8444-555555555555","name":"테스트 메뉴","place_enabled":true}]' : '<body>site</body>' });
  };
  await context.route('**/*', (route) => handleRoute(guard, route, { onBlocked: (entry) => blocked.push(entry), forward }));
  const page = await context.newPage();
  try {
    await page.goto(`${SITE}/pick/new`);
    const call = (method, url, body) => page.evaluate(async ([m, u, b]) => {
      try {
        const r = await fetch(u, { method: m, headers: { 'content-type': 'application/json' }, body: b });
        return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
      } catch (error) { return { error: String(error?.name ?? error) }; }
    }, [method, url, body ?? null]);

    const options = await call('POST', `${API}/rest/v1/rpc/store_menu_options`, '{}');
    assert.equal(options.ok, true);
    assert.deepEqual(pickFixtureCategory(options.json), { categoryId: '11111111-2222-4333-8444-555555555555', name: '테스트 메뉴' });

    const aiFailed = await call('POST', `${API}/functions/v1/suggest-item-categories`, '{"store":{}}');
    assert.ok(aiFailed.error, 'AI call fails in fail mode');
    guard.setMode('success', pickFixtureCategory(options.json));
    const aiFixture = await call('POST', `${API}/functions/v1/suggest-item-categories`, '{"store":{}}');
    assert.equal(aiFixture.ok, true);
    assert.equal(aiFixture.json.suggestions[0].confidence, 'high');
    assert.equal(aiFixture.json.suggestions[0].categoryId, '11111111-2222-4333-8444-555555555555');
    const placeCatalog = await call('POST', `${API}/rest/v1/rpc/category_uses_place_catalog`, '{"p_category_id":"x"}');
    assert.deepEqual(placeCatalog, { ok: true, status: 200, json: false });

    const register = await call('POST', `${API}/rest/v1/rpc/register_item_pick`, '{}');
    const upload = await call('POST', `${API}/storage/v1/object/item-photos/${USER}/a.jpg`, 'bytes');
    const del = await call('DELETE', `${API}/rest/v1/picks?id=eq.x`);
    const fnGet = await call('GET', `${API}/functions/v1/youtube-catalog?q=x`);
    const authSignup = await call('POST', `${API}/auth/v1/signup`, '{}');
    const sitePost = await call('POST', `${SITE}/api/anything`, '{}');
    const telemetry = await call('POST', `${API}/rest/v1/client_error_events`, '{}');
    for (const result of [register, upload, del, fnGet, authSignup, sitePost, telemetry]) assert.ok(result.error, 'write never reaches a server');
    assert.deepEqual(blocked.map((b) => b.code), ['UNEXPECTED_WRITE', 'UNEXPECTED_WRITE', 'UNEXPECTED_WRITE', 'UNEXPECTED_FUNCTION', 'UNEXPECTED_WRITE', 'UNEXPECTED_WRITE']);
    assert.deepEqual(blocked.map((b) => b.kind), ['OTHER_RPC', 'STORAGE_REQUEST', 'TABLE_REQUEST', 'FUNCTION_REQUEST', 'AUTH_REQUEST', 'SITE_REQUEST']);
    assert.equal(guard.counts.blockedWrites, 5);
    assert.equal(guard.counts.blockedFunctions, 1);
    assert.equal(guard.counts.telemetryDropped, 1);
    assert.equal(guard.counts.aiFailed, 1);
    assert.equal(guard.counts.aiFixture, 1);
    assert.equal(guard.counts.placeCatalogFixture, 1);
    assert.equal(forwarded, 2, 'only the page itself and the read RPC were forwarded');
    const refresh = await call('POST', `${API}/auth/v1/token?grant_type=refresh_token`, '{}');
    assert.equal(refresh.ok, true, 'token refresh is forwarded (answered by the fixture origin here)');
    assert.equal(forwarded, 3);

    // Fault switches in the browser: a held classification request stays pending until
    // release(), and the current-Pick lookup fails without becoming a finding.
    guard.setFault('holdMenuOptions', true);
    let settled = false;
    const held = call('POST', `${API}/rest/v1/rpc/store_menu_options`, '{}').then((r) => { settled = true; return r; });
    for (let i = 0; i < 20 && guard.parkedCount === 0; i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.equal(guard.parkedCount, 1, 'request parked');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(settled, false, 'the page is still waiting');
    guard.setFault('holdMenuOptions', false);
    assert.equal(await guard.release(forward), 1);
    assert.equal((await held).ok, true, 'released request completes as a read');
    guard.setFault('failPickSlotRead', true);
    const slot = await call('GET', `${API}/rest/v1/picks?select=*&user_id=eq.${USER}&category_id=eq.${OTHER}`);
    assert.ok(slot.error, 'slot lookup fails in the page');
    guard.setFault('failPickSlotRead', false);
    assert.equal(guard.counts.held, 1);
    assert.equal(guard.counts.slotReadFailed, 1);
    assert.equal(guard.counts.blockedWrites, 5, 'faults added no findings');
    assert.equal(forwarded, 4);
  } finally {
    await context.close();
    await browser.close();
  }
});
