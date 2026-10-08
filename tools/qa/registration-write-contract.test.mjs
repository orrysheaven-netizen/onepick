import test from 'node:test';
import assert from 'node:assert/strict';
import { API, SITE, STORE, MAP, REVIEW, assertExecution, assertSessionBudget, createWriteGuard, PICK_COLUMNS, assertStoredFixture, safeFailureCode, safeRequestKind } from './registration-write-contract.mjs';
const user = '11111111-1111-4111-8111-111111111111';
const category = '22222222-2222-4222-8222-222222222222';
const item = '33333333-3333-4333-8333-333333333333';
const pick = '44444444-4444-4444-8444-444444444444';
const stage = { p_category_id: category, p_name: STORE, p_map_url: MAP, p_road_address: '' };
const staged = { id: item, category_id: category, name: STORE, status: 'pending', created_by: user };
const write = (rpc, body) => ({ url: `${API}/rest/v1/rpc/${rpc}`, method: 'POST', body });
const image = (file, overrides = {}) => ({ url: `${API}/storage/v1/object/item-photos/${user}/${file}`,
  method: 'POST', headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' }, bytes: 100, ...overrides });
const register = { p_category_id: category, p_channel: 'offline', p_item_id: item,
  p_one_line_review: REVIEW, p_expected_previous_pick_id: null, p_request_id: pick,
  p_image_path: `${user}/fixture.jpg`, p_thumbnail_path: `${user}/fixture-thumb.jpg` };
test('session has sufficient lifetime without enabling token refresh writes', () => {
  const now = 10_000;
  const session = (exp, expires_at = exp) => ({ expires_at,
    access_token: `fixture.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.fixture` });
  assert.doesNotThrow(() => assertSessionBudget(session(now + 3600), now));
  assert.doesNotThrow(() => assertSessionBudget(session(now + 900), now));
  for (const s of [session(now + 899), session(now - 1), session(now + 3600, now + 899),
    session(now + 899, now + 3600), session('20000'), session(now + 3600, '20000'),
    { access_token: 'bad' }, session(null)]) {
    assert.throws(() => assertSessionBudget(s, now));
  }
  assert.throws(() => assertSessionBudget(session(now + 3600), now + 2701));
  const g = createWriteGuard(user, category); g.arm();
  assert.throws(() => g.admit({ url: `${API}/auth/v1/token?grant_type=refresh_token`, method: 'POST' }));
});
function prepared() {
  const g = createWriteGuard(user, category); g.arm();
  g.admit(write('stage_user_place_item', stage)); g.acceptStage(staged);
  return g;
}
function uploaded() {
  const g = prepared();
  for (const f of ['fixture.jpg', 'fixture-thumb.jpg']) { g.admit(image(f)); g.acceptUpload(image(f).url); }
  return g;
}
test('manual main first attempt with explicit confirmation and existing secrets only', () => {
  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'orrysheaven-netizen/onepick', CONFIRM_QA_REGISTRATION: 'true',
    GITHUB_RUN_ATTEMPT: '1', ONEPICK_QA_EMAIL: 'fixture', ONEPICK_QA_PASSWORD: 'fixture' };
  assert.doesNotThrow(() => assertExecution(env));
  for (const key of Object.keys(env)) assert.throws(() => assertExecution({ ...env, [key]: '' }));
  for (const change of [{ GITHUB_EVENT_NAME: 'schedule' }, { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_RUN_ATTEMPT: '2' }, { CONFIRM_QA_REGISTRATION: 'false' }]) {
    assert.throws(() => assertExecution({ ...env, ...change }));
  }
});
test('menu options load before writes are armed without permitting mutations', () => {
  const g = createWriteGuard(user, category);
  assert.equal(g.admit(write('store_menu_options', {})), 'read');
  assert.throws(() => g.admit(write('stage_user_place_item', stage)));
  assert.throws(() => g.admit(write('unknown_menu_rpc', {})));
});
test('unarmed, arbitrary hosts, real business staging and repeated attempts are rejected', () => {
  const g = createWriteGuard(user, category);
  assert.throws(() => g.admit(write('stage_user_place_item', stage)));
  g.arm();
  for (const body of [{ ...stage, p_name: 'Actual Business' }, { ...stage, p_map_url: 'https://map.naver.com/' },
    { ...stage, p_category_id: item }, { ...stage, p_branch_name: 'branch' }, { ...stage, extra: true }]) {
    assert.throws(() => g.admit(write('stage_user_place_item', body)));
  }
  assert.throws(() => g.admit({ url: 'https://attacker.invalid', method: 'GET' }));
  assert.equal(g.admit({ url: `${SITE}/pick/new`, method: 'GET' }), 'read');
  assert.equal(g.admit(write('stage_user_place_item', stage)), 'stage');
  assert.throws(() => g.admit(write('stage_user_place_item', stage)), 'no retry after ambiguous response');
});
test('staged item must be own, pending, fixed fixture without a prior photo', () => {
  for (const row of [{ ...staged, status: 'active' }, { ...staged, created_by: item },
    { ...staged, image_path: 'existing.jpg' }, { ...staged, name: 'other' }, { ...staged, id: 'invalid' }]) {
    const g = createWriteGuard(user, category); g.arm(); g.admit(write('stage_user_place_item', stage));
    assert.throws(() => g.acceptStage(row));
    assert.throws(() => g.admit(image('fixture.jpg')));
  }
});
test('only one new full/thumbnail pair in the authenticated user folder', () => {
  const g = prepared();
  for (const req of [image('../other.jpg'), image('fixture.jpg', { method: 'PUT' }),
    image('fixture.jpg', { bytes: 0 }), image('fixture.jpg', { bytes: 2_000_001 }),
    image('fixture.jpg', { headers: { 'content-type': 'image/jpeg', 'x-upsert': 'true' } }),
    image('fixture.jpg', { url: `${API}/storage/v1/object/item-photos/${item}/fixture.jpg` })]) {
    assert.throws(() => g.admit(req));
  }
  assert.equal(g.admit(image('fixture.jpg')), 'upload');
  assert.throws(() => g.admit(image('different-thumb.jpg')));
  assert.throws(() => g.admit(image('fixture.jpg')), 'no upload retry');
  g.acceptUpload(image('fixture.jpg').url);
  assert.equal(g.admit(image('fixture-thumb.jpg')), 'upload');
  assert.throws(() => g.admit(write('register_item_pick', register)), 'both uploads must succeed first');
  g.acceptUpload(image('fixture-thumb.jpg').url);
  assert.throws(() => g.admit(image('third.jpg')));
  assert.equal(g.admit(write('register_item_pick', register)), 'register');
});
test('replacement, other target, alternative photo, extra params and repeated saves are blocked', () => {
  for (const changed of [{ p_expected_previous_pick_id: item }, { p_item_id: pick },
    { p_channel: 'online' }, { p_one_line_review: 'fake review' }, { p_image_path: `${item}/fixture.jpg` },
    { p_provider_id: item }, { p_request_id: 'invalid' }]) {
    assert.throws(() => uploaded().admit(write('register_item_pick', { ...register, ...changed })));
  }
  const g = uploaded(); g.admit(write('register_item_pick', register));
  assert.throws(() => g.admit(write('register_item_pick', register)));
  const result = { item_id: item, pick_id: pick, published: false, retried: false, replaced_pick_id: null };
  assert.deepEqual(g.acceptRegistration(result), result);
  for (const change of [{ published: true }, { retried: true }, { replaced_pick_id: pick }, { item_id: pick }]) {
    assert.throws(() => g.acceptRegistration({ ...result, ...change }));
  }
});
test('unknown writes and direct table mutations are blocked; cleanup never deletes', () => {
  const g = uploaded();
  assert.throws(() => g.admit(write('admin_approve_item', { p_item_id: item })));
  assert.throws(() => g.admit({ url: `${API}/rest/v1/picks`, method: 'DELETE' }));
  assert.throws(() => g.admit({ url: `${API}/rest/v1/items`, method: 'PATCH', body: {} }));
  assert.equal(g.admit({ url: `${API}/storage/v1/object/item-photos`, method: 'DELETE' }), 'block-cleanup');
});

test('read-only recovery cannot arm, register, upload or refresh even with write confirmation', () => {
  const g = createWriteGuard(user, category, { readOnly: true });
  assert.throws(() => g.arm(), /READ_ONLY_MODE/);
  for (const req of [write('stage_user_place_item', stage), write('register_item_pick', register), image('fixture.jpg'),
    { url: `${API}/auth/v1/token?grant_type=refresh_token`, method: 'POST' }]) assert.throws(() => g.admit(req));
  assert.equal(g.admit(write('item_review_page', {})), 'read');
});

test('photo-credit read is restricted to the verified fixture and exact RPC payload', () => {
  const g = createWriteGuard(user, category, { readOnly: true, existingItemId: item });
  const req = write('item_photo_credit', { p_item_id: item });
  assert.equal(g.admit(req), 'read');
  assert.equal(g.admit(req), 'read', 'reload may repeat a read');
  for (const body of [undefined, null, [], {}, { p_item_id: pick },
    { p_item_id: item, extra: true }]) {
    assert.throws(() => g.admit({ ...req, body }), /PHOTO_CREDIT_NOT_ALLOWED/);
  }
  for (const method of ['PATCH', 'PUT', 'DELETE']) assert.throws(() => g.admit({ ...req, method }));
  for (const url of [`${SITE}/rest/v1/rpc/item_photo_credit`,
    `${API}/rest/v1/rpc/item_photo_credit_extra`, `${API}/rest/v1/rpc/admin_approve_item`]) {
    assert.throws(() => g.admit({ ...req, url }));
  }
  assert.throws(() => g.arm(), /READ_ONLY_MODE/);
  for (const mutation of [write('stage_user_place_item', stage), write('register_item_pick', register),
    image('fixture.jpg'), { url: `${API}/rest/v1/picks`, method: 'DELETE' },
    { url: `${API}/auth/v1/token?grant_type=refresh_token`, method: 'POST' }]) {
    assert.throws(() => g.admit(mutation));
  }
  assert.throws(() => createWriteGuard(user, category, { existingItemId: item }), /INVALID_ID/);
  assert.throws(() => createWriteGuard(user, category, { readOnly: true, existingItemId: 'bad' }), /INVALID_ID/);
  assert.throws(() => createWriteGuard(user, category, { readOnly: true }).admit(req));
  assert.throws(() => createWriteGuard(user, category).admit(req));
  assert.equal(prepared().admit(req), 'read', 'registration mode only admits its own staged item');
  assert.throws(() => prepared().admit(write('item_photo_credit', { p_item_id: pick })));
});

test('request diagnostics expose only fixed categories, never URLs or query secrets', () => {
  for (const [url, expected] of [
    [`${API}/rest/v1/rpc/item_photo_credit?secret=PRIVATE`, 'PHOTO_CREDIT_RPC'],
    [`${API}/rest/v1/rpc/PRIVATE`, 'OTHER_RPC'],
    [`${API}/auth/v1/token?refresh_token=PRIVATE`, 'AUTH_REQUEST'],
    [`${API}/storage/v1/object/PRIVATE`, 'STORAGE_REQUEST'],
    [`${API}/rest/v1/PRIVATE`, 'TABLE_REQUEST'],
    [`${API}/functions/v1/PRIVATE`, 'OTHER_API_REQUEST'],
    [`${SITE}/PRIVATE`, 'SITE_REQUEST'], ['https://private.invalid/PRIVATE', 'OUTSIDE_ORIGIN'],
    ['PRIVATE', 'INVALID_URL'],
  ]) assert.equal(safeRequestKind(url), expected);
  assert.equal(safeFailureCode(new Error('PHOTO_CREDIT_NOT_ALLOWED')), 'PHOTO_CREDIT_NOT_ALLOWED');
});

test('recovery execution still requires manual main first attempt and existing QA secrets', () => {
  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'orrysheaven-netizen/onepick', GITHUB_RUN_ATTEMPT: '1',
    ONEPICK_QA_EMAIL: 'fixture', ONEPICK_QA_PASSWORD: 'fixture', QA_REGISTRATION_MODE: 'verify_existing' };
  assert.doesNotThrow(() => assertExecution(env));
  for (const key of Object.keys(env)) assert.throws(() => assertExecution({ ...env, [key]: '' }));
  assert.throws(() => assertExecution({ ...env, QA_REGISTRATION_MODE: 'register' }));
  assert.throws(() => assertExecution({ ...env, GITHUB_RUN_ATTEMPT: '2' }));
});

test('persisted fixture uses real table columns and rejects other rows, ended picks and mismatched photos', () => {
  assert.equal(PICK_COLUMNS, 'id,item_id,category_id,channel,one_line_review,ended_at,status');
  const row = { id: pick, item_id: item, category_id: category, channel: 'offline',
    one_line_review: REVIEW, ended_at: null, status: 'needs_review' };
  const photoItem = { ...staged, image_path: `${user}/fixture.jpg`, thumbnail_path: `${user}/fixture-thumb.jpg` };
  const expected = assertStoredFixture([row], [photoItem], user, category);
  assert.equal(expected.pick_id, pick);
  assert.doesNotThrow(() => assertStoredFixture([row], [photoItem], user, category, expected));
  for (const rows of [[], [row, row], [{ ...row, status: 'active' }], [{ ...row, ended_at: '2026-10-08' }],
    [{ ...row, one_line_review: 'another review' }], [{ ...row, category_id: item }],
    [{ ...row, ended_at: undefined, is_current: true }]]) {
    assert.throws(() => assertStoredFixture(rows, [photoItem], user, category));
  }
  for (const items of [[], [photoItem, photoItem], [{ ...photoItem, created_by: category }],
    [{ ...photoItem, name: 'another store' }], [{ ...photoItem, status: 'active' }],
    [{ ...photoItem, image_path: `${category}/fixture.jpg` }],
    [{ ...photoItem, thumbnail_path: `${user}/another-thumb.jpg` }]]) {
    assert.throws(() => assertStoredFixture([row], items, user, category));
  }
  assert.throws(() => assertStoredFixture([row], [photoItem], user, category, { ...expected, pick_id: item }));
});

test('failure diagnostics never echo arbitrary error messages or response data', () => {
  assert.equal(safeFailureCode(new Error('PICK_PERSISTENCE_FAILED')), 'PICK_PERSISTENCE_FAILED');
  for (const value of ['SENSITIVE_TOKEN', 'https://example.invalid/private', 'PICK_PERSISTENCE_FAILED secret', '']) {
    assert.equal(safeFailureCode(new Error(value)), 'UNCLASSIFIED_FAILURE');
  }
  assert.equal(safeFailureCode(null), 'UNCLASSIFIED_FAILURE');
});

