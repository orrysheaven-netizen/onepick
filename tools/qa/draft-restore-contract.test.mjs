import assert from 'node:assert/strict';
import {
  API, SITE, classifyRequest, isCurrentPickSlotRead, isMenuOptionsRequest, readDraftFacts,
  assertReviewDraftKept, safeFailureCode, assertExecution,
} from './draft-restore-contract.mjs';

// Network policy: fail closed on anything that could write to Production.
assert.equal(classifyRequest(`${SITE}/pick/new`, 'GET'), 'allow');
assert.equal(classifyRequest(`${API}/rest/v1/picks?user_id=eq.x&category_id=eq.y`, 'GET'), 'allow');
assert.equal(classifyRequest(`${API}/rest/v1/rpc/store_menu_options`, 'POST'), 'allow');
assert.equal(classifyRequest(`${API}/rest/v1/rpc/current_user_is_admin`, 'POST'), 'allow');
assert.equal(classifyRequest(`${API}/auth/v1/token?grant_type=refresh_token`, 'POST'), 'allow');
assert.equal(classifyRequest(`${API}/rest/v1/rpc/capture_product_event`, 'POST'), 'block-telemetry');
assert.equal(classifyRequest(`${API}/rest/v1/rpc/stage_user_place_item`, 'POST'), 'block-write');
assert.equal(classifyRequest(`${API}/rest/v1/rpc/register_item_pick`, 'POST'), 'block-write');
assert.equal(classifyRequest(`${API}/rest/v1/rpc/unknown_future_rpc`, 'POST'), 'block-write', 'unknown RPCs fail closed');
assert.equal(classifyRequest(`${API}/rest/v1/picks`, 'POST'), 'block-write');
assert.equal(classifyRequest(`${API}/rest/v1/picks?id=eq.x`, 'PATCH'), 'block-write');
assert.equal(classifyRequest(`${API}/rest/v1/picks?id=eq.x`, 'DELETE'), 'block-write');
assert.equal(classifyRequest(`${API}/storage/v1/object/item-photos/u/a.jpg`, 'POST'), 'block-storage');
assert.equal(classifyRequest(`${API}/functions/v1/suggest-item-categories`, 'POST'), 'block-function');
assert.equal(classifyRequest('not a url', 'GET'), 'block-write');
// Default-deny counter-examples (Codex review on #872): path checks come before the method,
// auth is narrowed to the refresh grant, and non-Supabase origins are not a free pass.
assert.equal(classifyRequest(`${API}/functions/v1/suggest-item-categories`, 'GET'), 'block-function', 'GET still invokes an Edge Function');
assert.equal(classifyRequest(`${API}/functions/v1/suggest-item-categories?x=1`, 'OPTIONS'), 'block-function');
assert.equal(classifyRequest(`${API}/storage/v1/object/public/item-photos/a.jpg`, 'GET'), 'block-storage');
assert.equal(classifyRequest(`${API}/storage/v1/object/item-photos/u/a.jpg`, 'PUT'), 'block-storage');
assert.equal(classifyRequest(`${API}/auth/v1/user`, 'GET'), 'allow');
assert.equal(classifyRequest(`${API}/auth/v1/signup`, 'POST'), 'block-write');
assert.equal(classifyRequest(`${API}/auth/v1/token?grant_type=password`, 'POST'), 'block-write', 'only the refresh grant is needed in the browser');
assert.equal(classifyRequest(`${API}/auth/v1/user`, 'PUT'), 'block-write');
assert.equal(classifyRequest(`${API}/auth/v1/logout?scope=local`, 'POST'), 'block-write', 'logout is done by the runner outside the browser');
assert.equal(classifyRequest(`${API}/auth/v1/recover`, 'POST'), 'block-write');
assert.equal(classifyRequest(`${SITE}/api/anything`, 'POST'), 'block-write', 'same-site non-read is unexpected');
assert.equal(classifyRequest(`${SITE}/pick/new`, 'DELETE'), 'block-write');
assert.equal(classifyRequest('https://third-party.example/collect', 'POST'), 'block-external');
assert.equal(classifyRequest('https://third-party.example/collect', 'PUT'), 'block-external');
assert.equal(classifyRequest('https://image.tmdb.org/t/p/w500/x.jpg', 'GET'), 'allow', 'third-party reads (images) pass');
assert.equal(classifyRequest(`${API}/rest/v1/rpc/store_menu_options`, 'PUT'), 'block-write', 'read RPC allowlist is POST only');
assert.equal(classifyRequest(`${API}/rest/v1/rpc/`, 'POST'), 'block-write');

assert.equal(isMenuOptionsRequest(`${API}/rest/v1/rpc/store_menu_options`), true);
assert.equal(isMenuOptionsRequest(`${API}/rest/v1/rpc/store_menu_options_v2`), false);
assert.equal(isCurrentPickSlotRead(`${API}/rest/v1/picks?select=*&user_id=eq.u&category_id=eq.c`, 'GET'), true);
assert.equal(isCurrentPickSlotRead(`${API}/rest/v1/picks?select=id&user_id=eq.u`, 'GET'), false, 'other picks reads untouched');
assert.equal(isCurrentPickSlotRead(`${API}/rest/v1/picks?user_id=eq.u&category_id=eq.c`, 'POST'), false);

// Draft facts mirror mobile/src/lib/pick/pickDraft.ts record shape (v1).
const record = (fields, photo = 'stored', userId = 'user-1') => JSON.stringify({ v: 1, userId, fields, photo, savedAt: Date.now() });
const good = { step: 5, review: 'R', menuQuery: 'M', store: { kind: 'new', name: 'S' } };
assert.deepEqual(readDraftFacts(record(good), 'user-1'),
  { step: 5, review: 'R', menuQuery: 'M', storeName: 'S', storeKind: 'new', photo: 'stored' });
assert.throws(() => readDraftFacts(null, 'user-1'), /DRAFT_MISSING/);
assert.throws(() => readDraftFacts('{bad', 'user-1'), /DRAFT_INVALID/);
assert.throws(() => readDraftFacts(record(good, 'stored', 'someone-else'), 'user-1'), /DRAFT_OWNER_MISMATCH/);

const expected = { review: 'R', menu: 'M', store: 'S' };
assert.equal(assertReviewDraftKept(readDraftFacts(record(good), 'user-1'), expected), true);
// The #858 regression: a restore while classification was pending saved step 2 instead of the target.
assert.throws(() => assertReviewDraftKept(readDraftFacts(record({ ...good, step: 2 }), 'user-1'), expected), /DRAFT_STEP_LOST/);
assert.throws(() => assertReviewDraftKept(readDraftFacts(record({ ...good, review: '' }), 'user-1'), expected), /DRAFT_REVIEW_LOST/);
assert.throws(() => assertReviewDraftKept(readDraftFacts(record(good, 'lost'), 'user-1'), expected), /DRAFT_PHOTO_LOST/);
assert.throws(() => assertReviewDraftKept(readDraftFacts(record({ ...good, store: { kind: 'place', name: 'S' } }), 'user-1'), expected), /DRAFT_STORE_LOST/);

assert.equal(safeFailureCode(new Error('DRAFT_STEP_LOST')), 'DRAFT_STEP_LOST');
assert.equal(safeFailureCode(new Error('secret leaked here')), 'UNCLASSIFIED_FAILURE');

const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'orrysheaven-netizen/onepick',
  GITHUB_RUN_ATTEMPT: '1', ONEPICK_QA_EMAIL: 'e', ONEPICK_QA_PASSWORD: 'p' };
assert.doesNotThrow(() => assertExecution(env));
assert.throws(() => assertExecution({ ...env, GITHUB_EVENT_NAME: 'schedule' }), /EXECUTION_NOT_AUTHORIZED/);
assert.throws(() => assertExecution({ ...env, GITHUB_REF: 'refs/heads/feature' }), /EXECUTION_NOT_AUTHORIZED/);
assert.throws(() => assertExecution({ ...env, GITHUB_RUN_ATTEMPT: '2' }), /EXECUTION_NOT_AUTHORIZED/);
assert.throws(() => assertExecution({ ...env, ONEPICK_QA_PASSWORD: '' }), /EXECUTION_NOT_AUTHORIZED/);

console.log('draft-restore contract: PASS');
