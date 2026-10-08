import test from 'node:test';
import assert from 'node:assert/strict';
import { API, SITE, STORE, MAP, REVIEW, assertExecution, assertSessionBudget, createWriteGuard } from './registration-write-contract.mjs';
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
