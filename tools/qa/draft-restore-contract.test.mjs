// Offline checks of the draft-restore QA policy. No browser, network, account or model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRestoreGuard, aiSuccessFixture, pickFixtureCategory, assertDraftRestoreExecution,
  inspectDraft, markPhotoLost, reassignDraftOwner, assertReviewDraft, safeRestoreFailureCode, RESTORE_FAILURE_CODES,
  isAllowedAuthMutation, isStorageRead, isMenuOptionsRequest, isCurrentPickSlotRead, isPasswordGrant,
  guardedFetch, forwardWithoutRedirects, handleRoute, classifyRuntimeMessage, createRestoreRuntime, RUNTIME_EVENT_CODES,
  READ_RPCS, RESTORE_READ_RPCS, BOOTSTRAP_READ_RPCS, KNOWN_TELEMETRY_BEACONS, isKnownTelemetryBeacon, REDIRECT_STATUSES,
  RESTORE_MENU, RESTORE_MENU_EDITED, RESTORE_REVIEW,
} from './draft-restore-contract.mjs';
import http from 'node:http';

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
    ['POST', `${API}/auth/v1/logout`],
    ['POST', `${API}/auth/v1/logout?scope=global`],
    ['POST', `${API}/auth/v1/logout?scope=others`],
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

// GPT review of #873 (Medium): a global sign-out would revoke the QA account's other sessions.
test('auth allow-list is exact: refresh grant and LOCAL logout only', () => {
  const ok = (p) => isAllowedAuthMutation(new URL(`${API}${p}`), 'POST');
  assert.equal(ok('/auth/v1/token?grant_type=refresh_token'), true);
  assert.equal(ok('/auth/v1/logout?scope=local'), true);
  assert.equal(ok('/auth/v1/logout'), false, 'scope defaults to global on the server');
  assert.equal(ok('/auth/v1/logout?scope=global'), false);
  assert.equal(ok('/auth/v1/logout?scope=others'), false);
  // GPT review L1 (head 085bdc8): a repeated scope parameter is refused outright, whatever a server would pick.
  assert.equal(ok('/auth/v1/logout?scope=local&scope=global'), false, 'duplicate scope is never allowed');
  assert.equal(ok('/auth/v1/logout?scope=global&scope=local'), false);
  assert.equal(ok('/auth/v1/logout?scope=local&scope=local'), false);
  assert.equal(ok('/auth/v1/logout?scope=local&other=1'), true, 'one scope=local with unrelated params is still the local sign-out');
  assert.equal(ok('/auth/v1/logout?scope=Local'), false);
  assert.equal(ok('/auth/v1/logout?scope=local%20'), false);
  assert.equal(isPasswordGrant(new URL(`${API}/auth/v1/token?grant_type=password`), 'POST'), true);
  assert.equal(isPasswordGrant(new URL(`${API}/auth/v1/token?grant_type=refresh_token`), 'POST'), false);
  assert.equal(ok('/auth/v1/token?grant_type=password'), false, 'the password grant is never a browser allowance');
  assert.equal(ok('/auth/v1/token?grant_type=password'), false);
  assert.equal(ok('/auth/v1/token'), false);
  assert.equal(ok('/auth/v1/signup'), false);
  assert.equal(ok('/auth/v1/user'), false);
  assert.equal(ok('/auth/v1/recover'), false);
  assert.equal(ok('/auth/v1/logout/extra'), false);
  assert.equal(isAllowedAuthMutation(new URL(`${API}/auth/v1/logout`), 'PUT'), false);
  assert.equal(isAllowedAuthMutation(new URL(`${API}/auth/v1/token?grant_type=refresh_token`), 'PATCH'), false);
  // #873 L2: grant_type must appear exactly once, for the browser refresh and the Node password grant alike.
  const pw = (p) => isPasswordGrant(new URL(`${API}${p}`), 'POST');
  for (const q of ['grant_type=refresh_token&grant_type=password', 'grant_type=password&grant_type=refresh_token',
    'grant_type=refresh_token&grant_type=refresh_token', 'grant_type=password&grant_type=password', 'grant_type=', 'grant_type=Refresh_Token',
    'grant_type=refresh_token%20', 'grant_type=id_token', 'grant_type=pkce']) {
    assert.equal(ok(`/auth/v1/token?${q}`), false, `browser refuses ${q}`);
    assert.equal(pw(`/auth/v1/token?${q}`), false, `Node refuses ${q}`);
  }
  assert.equal(ok('/auth/v1/token?grant_type=refresh_token&other=1'), true, 'one refresh grant with unrelated params is still the refresh');
  assert.equal(pw('/auth/v1/token?grant_type=password&other=1'), true, 'one password grant with unrelated params is still the login');
  assert.equal(isPasswordGrant(new URL(`${API}/auth/v1/token?grant_type=password`), 'GET'), false);
});

// GPT review of #873 (Medium): an outside-origin mutation attempt must be a finding, not a
// silent drop that leaves the run green. Reads and known analytics beacons stay silent.
test('a non-Supabase origin never receives a write, and an outside mutation attempt fails the run', () => {
  const guard = createRestoreGuard({ api: API, site: SITE });
  for (const [method, url] of [['POST', `${SITE}/api/picks`], ['DELETE', `${SITE}/pick/1`], ['PUT', `${SITE}/`]]) {
    const result = decide(guard, method, url);
    assert.equal(result.action, 'abort'); assert.equal(result.fail, 'UNEXPECTED_WRITE'); assert.equal(result.kind, 'SITE_REQUEST');
  }
  const outsideWrites = [['POST', 'https://other-project.supabase.co/rest/v1/picks'], ['PUT', 'https://api.example.com/upload'],
    ['DELETE', 'http://localhost:54321/rest/v1/picks'], ['POST', `https://evil.example/${encodeURIComponent(API)}`],
    ['PATCH', 'https://ygoipwzakzdnkaaxyrgb.supabase.co.evil.example/rest/v1/picks'], ['POST', 'https://static.cloudflareinsights.com.evil.example/beacon'],
    // GPT review L2 (head 085bdc8): the beacon allowance is host + path + method, not the host.
    ['POST', 'https://cloudflareinsights.com/cdn-cgi/other'], ['PUT', 'https://cloudflareinsights.com/cdn-cgi/rum'], ['DELETE', 'https://cloudflareinsights.com/cdn-cgi/rum'],
    ['POST', 'https://static.cloudflareinsights.com/beacon'], ['POST', 'https://static.cloudflareinsights.com/cdn-cgi/rum'], ['POST', 'https://cloudflareinsights.com/'],
    ['POST', 'https://cloudflareinsights.com/cdn-cgi/rum/extra'], ['POST', 'https://cloudflareinsights.com/cdn-cgi/rum%2F'], ['POST', 'https://cloudflareinsights.com/cdn-cgi/RUM'],
    // #873 L1: the beacon origin is exact — plain HTTP and non-default ports are findings, not drops.
    ['POST', 'http://cloudflareinsights.com/cdn-cgi/rum'], ['POST', 'https://cloudflareinsights.com:444/cdn-cgi/rum'],
    ['POST', 'http://cloudflareinsights.com:443/cdn-cgi/rum'], ['POST', 'https://cloudflareinsights.com:8443/cdn-cgi/rum'], ['PUT', 'http://cloudflareinsights.com/cdn-cgi/rum']];
  for (const [method, url] of outsideWrites) {
    const result = decide(guard, method, url);
    assert.equal(result.action, 'abort', url); assert.equal(result.fail, 'UNEXPECTED_ORIGIN', url); assert.equal(result.kind, 'OUTSIDE_ORIGIN', url);
    assert.equal(result.reason, 'blockedbyclient', 'still never forwarded');
    assert.ok(!JSON.stringify(result).includes('evil') && !JSON.stringify(result).includes('example'), 'no host leaks');
  }
  assert.equal(guard.counts.blockedWrites, 3);
  assert.equal(guard.counts.blockedOutside, outsideWrites.length);
  assert.equal(guard.failed, true);
  // Reads outside and the known analytics beacon are dropped silently.
  const silent = createRestoreGuard({ api: API, site: SITE });
  for (const [method, url] of [['GET', 'https://fonts.gstatic.com/x.woff2'], ['HEAD', 'https://cdn.example/x.png'], ['OPTIONS', 'https://api.example.com/upload'],
    ['GET', 'https://static.cloudflareinsights.com/beacon.min.js/vcd15cbe7772f49c399c6a5babf22c1241717689176015'], ['POST', 'https://cloudflareinsights.com/cdn-cgi/rum'],
    ['POST', 'https://cloudflareinsights.com/cdn-cgi/rum?x=1']]) {
    assert.deepEqual(decide(silent, method, url), { action: 'abort', reason: 'blockedbyclient', silent: true }, `${method} ${url}`);
  }
  assert.equal(silent.counts.externalDropped, 6);
  assert.equal(silent.failed, false);
  assert.deepEqual(KNOWN_TELEMETRY_BEACONS, [{ origin: 'https://cloudflareinsights.com', host: 'cloudflareinsights.com', path: '/cdn-cgi/rum', method: 'POST' }], 'exactly the Cloudflare Web Analytics report call');
  assert.equal(isKnownTelemetryBeacon(new URL('https://cloudflareinsights.com/cdn-cgi/rum'), 'POST'), true);
  assert.equal(isKnownTelemetryBeacon(new URL('https://cloudflareinsights.com/cdn-cgi/rum'), 'PUT'), false);
  assert.equal(isKnownTelemetryBeacon(new URL('https://static.cloudflareinsights.com/cdn-cgi/rum'), 'POST'), false);
  assert.equal(isKnownTelemetryBeacon(new URL('https://cloudflareinsights.com/cdn-cgi/rum2'), 'POST'), false);
  assert.equal(isKnownTelemetryBeacon(new URL('http://cloudflareinsights.com/cdn-cgi/rum'), 'POST'), false, 'HTTP is not the beacon');
  assert.equal(isKnownTelemetryBeacon(new URL('https://cloudflareinsights.com:444/cdn-cgi/rum'), 'POST'), false, 'a non-default port is not the beacon');
  assert.equal(isKnownTelemetryBeacon(new URL('https://cloudflareinsights.com:443/cdn-cgi/rum'), 'POST'), true, 'the explicit default port is the same origin');
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

// GPT review of #873 (High): the guard must cover the run from its first browser context,
// before the Supabase project is even known. An unbound guard binds to the first
// *.supabase.co request and refuses to be re-bound to another origin.
test('unbound guard: binds to the first Supabase host, judges it with the same policy, rejects a different origin', () => {
  const guard = createRestoreGuard({ api: null, site: SITE });
  assert.equal(guard.api, null);
  assert.deepEqual(decide(guard, 'GET', `${SITE}/`), { action: 'continue' });
  assert.deepEqual(decide(guard, 'GET', 'https://fonts.gstatic.com/x.woff2'), { action: 'abort', reason: 'blockedbyclient', silent: true });
  assert.equal(guard.api, null, 'site and outside requests never bind');
  // A write to a Supabase host before binding is still judged by the Supabase policy, not treated as "outside".
  const early = decide(guard, 'POST', `${API}/rest/v1/rpc/register_item_pick`);
  assert.equal(early.fail, 'UNEXPECTED_WRITE'); assert.equal(early.kind, 'OTHER_RPC');
  assert.equal(guard.api, API, 'bound by the first Supabase request');
  assert.equal(decide(guard, 'GET', `${API}/functions/v1/youtube-catalog`).fail, 'UNEXPECTED_FUNCTION');
  // A second Supabase project is now an outside origin.
  const other = decide(guard, 'GET', 'https://other-project.supabase.co/rest/v1/picks');
  assert.deepEqual(other, { action: 'abort', reason: 'blockedbyclient', silent: true });
  assert.equal(decide(guard, 'POST', 'https://other-project.supabase.co/rest/v1/rpc/home_pick_feed_page').fail, 'UNEXPECTED_ORIGIN');
  assert.doesNotThrow(() => guard.bindApi(API));
  assert.throws(() => guard.bindApi('https://other-project.supabase.co'), /API_ORIGIN_MISMATCH/);
  assert.throws(() => createRestoreGuard({ api: 42, site: SITE }), /GUARD_CONFIG_INVALID/);
  // bindApi first, then discovery requests: the bound origin wins.
  const pinned = createRestoreGuard({ api: null, site: SITE });
  pinned.bindApi(API);
  assert.equal(decide(pinned, 'POST', 'https://other-project.supabase.co/rest/v1/rpc/home_pick_feed_page').fail, 'UNEXPECTED_ORIGIN');
});

// The bootstrap (home visit for discovery, signed-in /profile, tab bar) may only POST the
// STABLE read RPCs listed for it; the restore scenario only its own. Anything else the app
// might call during either phase — notification read marks, follows, registrations — fails.
test('bootstrap and restore read RPC allow-lists are explicit; other RPCs fail closed', () => {
  const guard = createRestoreGuard({ api: API, site: SITE });
  for (const rpc of ['home_pick_feed_page', 'food_item_recent_ranking', 'home_showcase_page', 'item_brands', 'notification_unread_count',
    'profile_follow_counts', 'follow_counts', 'profile_taste_composition', 'my_comment_page', 'ranking_categories']) {
    assert.ok(BOOTSTRAP_READ_RPCS.has(rpc) || RESTORE_READ_RPCS.has(rpc), rpc);
    assert.deepEqual(decide(guard, 'POST', `${API}/rest/v1/rpc/${rpc}`), { action: 'continue' }, rpc);
  }
  for (const rpc of ['mark_notification_group_read', 'notification_group_page', 'follow_user', 'unfollow_user', 'register_pick',
    'change_pick', 'remove_pick', 'update_pick_review', 'delete_comment', 'save_profile_bio', 'set_profile_ai_visibility',
    'brand_branch_page', 'search_online_sellers', 'admin_operations_snapshot']) {
    assert.ok(!READ_RPCS.has(rpc), rpc);
    assert.equal(decide(guard, 'POST', `${API}/rest/v1/rpc/${rpc}`).fail, 'UNEXPECTED_WRITE', rpc);
  }
  // Table GETs the bootstrap issues (profiles, categories, item_providers) are reads; table writes are not.
  assert.deepEqual(decide(guard, 'GET', `${API}/rest/v1/profiles?select=*&id=eq.${USER}`), { action: 'continue' });
  assert.deepEqual(decide(guard, 'GET', `${API}/rest/v1/item_providers?select=*`), { action: 'continue' });
  assert.equal(decide(guard, 'PATCH', `${API}/rest/v1/profiles?id=eq.${USER}`).fail, 'UNEXPECTED_WRITE');
  assert.equal(decide(guard, 'DELETE', `${API}/rest/v1/profile_social_links?id=eq.1`).fail, 'UNEXPECTED_WRITE');
  for (const rpc of READ_RPCS) assert.match(rpc, /^[a-z_]+$/, rpc);
  assert.equal(READ_RPCS.size, RESTORE_READ_RPCS.size + BOOTSTRAP_READ_RPCS.size, 'the two lists do not overlap');
});

// GPT review of #873 (High): the harness's own Node fetches are under the same policy. The
// password grant is allowed once; fixtures, holds and silent drops are browser-only.
test('Node policy: reads, refresh, local logout and ONE password grant; everything else is a finding and never fetched', async () => {
  const guard = createRestoreGuard({ api: null, site: SITE });
  const calls = [];
  const fetchStub = async (url, init) => { calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${url}`); return { ok: true, status: 200, json: async () => ({}) }; };
  const nodeFetch = guardedFetch(guard, fetchStub);
  // Login binds the API origin and is counted.
  await nodeFetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', body: '{}' });
  assert.equal(guard.api, API);
  assert.equal(guard.counts.nodeLogins, 1);
  await assert.rejects(nodeFetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', body: '{}' }), /NODE_CALL_BLOCKED/, 'a second login is a finding');
  assert.equal(guard.counts.nodeLogins, 1);
  // Allowed harness calls.
  await nodeFetch(`${SITE}/deployment.json`);
  await nodeFetch(`${API}/rest/v1/picks?user_id=eq.${USER}&select=id`);
  await nodeFetch(`${API}/rest/v1/rpc/current_user_is_admin`, { method: 'POST', body: '{}' });
  await nodeFetch(`${API}/auth/v1/logout?scope=local`, { method: 'POST' });
  await nodeFetch(`${API}/auth/v1/token?grant_type=refresh_token`, { method: 'post' });
  assert.equal(calls.length, 6);
  // Refused before any network: writes, functions (GET too), global logout, other origins, browser-only paths.
  for (const [method, url, code] of [
    ['POST', `${API}/rest/v1/rpc/register_item_pick`, 'UNEXPECTED_WRITE'],
    ['POST', `${API}/rest/v1/picks`, 'UNEXPECTED_WRITE'],
    ['GET', `${API}/functions/v1/profile-ai-status`, 'UNEXPECTED_FUNCTION'],
    ['POST', `${API}/functions/v1/suggest-item-categories`, 'NODE_CALL_BLOCKED'], // browser-only fixture path
    ['POST', `${API}/rest/v1/rpc/capture_product_event`, 'NODE_CALL_BLOCKED'], // silent drop is browser-only
    ['POST', `${API}/auth/v1/logout?scope=global`, 'UNEXPECTED_WRITE'],
    ['POST', `${API}/auth/v1/logout`, 'UNEXPECTED_WRITE'],
    ['POST', `${API}/auth/v1/signup`, 'UNEXPECTED_WRITE'],
    ['POST', 'https://other-project.supabase.co/auth/v1/token?grant_type=password', 'UNEXPECTED_ORIGIN'],
    ['POST', 'https://api.example.com/upload', 'UNEXPECTED_ORIGIN'],
    ['GET', 'https://api.example.com/x', 'NODE_CALL_BLOCKED'],
    ['DELETE', `${SITE}/x`, 'UNEXPECTED_WRITE'],
    ['GET', 'not a url', 'NODE_CALL_BLOCKED'],
    // #873 L2: a repeated or wrong grant_type is neither the login nor the refresh.
    ['POST', `${API}/auth/v1/token?grant_type=password&grant_type=refresh_token`, 'UNEXPECTED_WRITE'],
    ['POST', `${API}/auth/v1/token?grant_type=refresh_token&grant_type=password`, 'UNEXPECTED_WRITE'],
    ['POST', `${API}/auth/v1/token?grant_type=password&grant_type=password`, 'UNEXPECTED_WRITE'],
    ['POST', `${API}/auth/v1/token?grant_type=refresh_token&grant_type=refresh_token`, 'UNEXPECTED_WRITE'],
    ['POST', `${API}/auth/v1/token?grant_type=id_token`, 'UNEXPECTED_WRITE'],
  ]) {
    await assert.rejects(nodeFetch(url, { method }), new RegExp(`^Error: ${code}$`), `${method} ${url}`);
  }
  assert.equal(calls.length, 6, 'a refused call never reaches fetch');
  assert.equal(guard.failed, true);
  assert.ok(guard.counts.blockedNodeCalls >= 4);
  // A pre-bound guard refuses a password grant to another project outright.
  const bound = createRestoreGuard({ api: API, site: SITE });
  assert.deepEqual(bound.decideNode({ url: 'https://other-project.supabase.co/auth/v1/token?grant_type=password', method: 'POST' }), { allowed: false, code: 'UNEXPECTED_ORIGIN' });
  assert.equal(bound.counts.nodeLogins, 0);
});

// GPT review of #873 (Medium/Low): restore-mode runtime events are codes and counts. A
// message carrying a token, the account e-mail, a username or a URL never reaches the
// collector's output in any form.
test('restore runtime collector: closed codes and counts only, no message text, URL or account detail', () => {
  const secrets = [`eyJ${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`, 'qa-user@example.com', 'qa_user_42', USER, `${API}/rest/v1/picks?user_id=eq.${USER}`, 'sb_secret_abcdef'];
  const runtime = createRestoreRuntime();
  runtime.pageError(`TypeError: Failed to fetch ${secrets[4]}`);
  runtime.pageError(`Uncaught Error: token ${secrets[0]} for ${secrets[1]}`);
  runtime.consoleError(`Failed to load resource: net::ERR_BLOCKED_BY_CLIENT ${secrets[4]}`);
  runtime.consoleError(`Failed to load resource: the server responded with a status of 401 () ${secrets[4]}`);
  runtime.consoleError(`Warning: Each child in a list should have a unique "key" prop. ${secrets[2]}`);
  runtime.consoleError(`[supabase] ${secrets[5]} rejected for ${secrets[3]}`);
  runtime.response(`${API}/rest/v1/picks?user_id=eq.${USER}`, 401, API, SITE);
  runtime.response(`${API}/functions/v1/suggest-item-categories?token=${secrets[0]}`, 502, API, SITE);
  runtime.response(`${SITE}/pick/new?u=${secrets[2]}`, 404, API, SITE);
  runtime.response(`https://cdn.example/${secrets[1]}`, 500, API, SITE);
  runtime.response(`${API}/rest/v1/items`, 200, API, SITE);
  const out = runtime.summary;
  assert.deepEqual(out.events, { NETWORK_ERROR: 1, JS_EXCEPTION: 1, REQUEST_BLOCKED: 1, HTTP_ERROR: 1, REACT_WARNING: 1, CONSOLE_ERROR: 1 });
  assert.deepEqual(out.responses, [{ status: 401, kind: 'TABLE_REQUEST' }, { status: 502, kind: 'FUNCTION_REQUEST' }, { status: 404, kind: 'SITE_REQUEST' }, { status: 500, kind: 'OUTSIDE_ORIGIN' }]);
  assert.equal(runtime.total, 10);
  const text = JSON.stringify(out);
  for (const secret of secrets) assert.ok(!text.includes(secret), `leaked: ${secret.slice(0, 12)}`);
  assert.ok(!/https?:|\/rest\/|\/functions\/|@/.test(text), 'no URL, path or e-mail shape at all');
  for (const code of Object.keys(out.events)) assert.ok(RUNTIME_EVENT_CODES.has(code), code);
  assert.equal(classifyRuntimeMessage('pageerror', 'anything else'), 'JS_EXCEPTION');
  assert.equal(classifyRuntimeMessage('console', undefined), 'CONSOLE_ERROR');
  // The flow's own failure path is closed too: nothing from a message, URL or account survives.
  for (const raw of [`HTTP 400 (${secrets[1]})`, `Error: ${secrets[0]}`, `매장 표시 변경: "${secrets[2]}"`, secrets[4]]) {
    assert.equal(safeRestoreFailureCode(new Error(raw)), 'UNCLASSIFIED_FAILURE', raw);
  }
  for (const code of ['SUPABASE_NOT_DISCOVERED', 'LOGIN_FAILED', 'APP_SESSION_NOT_RECOGNIZED', 'QA_USERNAME_MISSING', 'PROFILE_NOT_SHOWN',
    'NODE_CALL_BLOCKED', 'API_ORIGIN_MISMATCH', 'MENU_EDIT_NOT_RESET', 'RESUME_SKIPPED_PHOTO_STEP', 'STORE_CHANGE_NOT_RESET']) {
    assert.equal(safeRestoreFailureCode(new Error(code)), code);
  }
  assert.notEqual(RESTORE_MENU_EDITED, RESTORE_MENU);
  assert.ok(RESTORE_MENU_EDITED.startsWith(RESTORE_MENU), 'edited name stays visibly synthetic');
});

test('third-party and telemetry requests are dropped without a finding', () => {
  const guard = createRestoreGuard({ api: API, site: SITE });
  assert.deepEqual(decide(guard, 'GET', 'https://fonts.gstatic.com/x.woff2'), { action: 'abort', reason: 'blockedbyclient', silent: true });
  assert.deepEqual(decide(guard, 'POST', 'https://cloudflareinsights.com/cdn-cgi/rum'), { action: 'abort', reason: 'blockedbyclient', silent: true });
  assert.deepEqual(decide(guard, 'POST', `${API}/rest/v1/client_error_events`), { action: 'abort', reason: 'blockedbyclient', silent: true });
  assert.deepEqual(decide(guard, 'POST', `${API}/rest/v1/rpc/capture_product_event`), { action: 'abort', reason: 'blockedbyclient', silent: true });
  assert.equal(decide(guard, 'GET', 'not a url').fail, 'UNEXPECTED_ORIGIN');
  assert.equal(guard.counts.externalDropped, 2);
  assert.equal(guard.counts.telemetryDropped, 2);
  assert.equal(guard.counts.blockedOutside, 1);
  assert.equal(guard.counts.blockedWrites, 0);
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
    blockedWrites: 0, blockedFunctions: 0, blockedOutside: 0, blockedNodeCalls: 0, blockedRedirects: 0, nodeLogins: 0, held: 0, slotReadFailed: 0 });
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
    const outsidePost = await call('POST', 'https://api.example.com/upload', '{}');
    const globalLogout = await call('POST', `${API}/auth/v1/logout?scope=global`, '{}');
    const telemetry = await call('POST', `${API}/rest/v1/client_error_events`, '{}');
    const beacon = await call('POST', 'https://cloudflareinsights.com/cdn-cgi/rum', '{}');
    const beaconHostOther = await call('POST', 'https://static.cloudflareinsights.com/beacon', '{}');
    const dupScopeLogout = await call('POST', `${API}/auth/v1/logout?scope=local&scope=global`, '{}');
    for (const result of [register, upload, del, fnGet, authSignup, sitePost, outsidePost, globalLogout, telemetry, beacon, beaconHostOther, dupScopeLogout]) assert.ok(result.error, 'write never reaches a server');
    assert.deepEqual(blocked.map((b) => b.code), ['UNEXPECTED_WRITE', 'UNEXPECTED_WRITE', 'UNEXPECTED_WRITE', 'UNEXPECTED_FUNCTION', 'UNEXPECTED_WRITE', 'UNEXPECTED_WRITE', 'UNEXPECTED_ORIGIN', 'UNEXPECTED_WRITE', 'UNEXPECTED_ORIGIN', 'UNEXPECTED_WRITE']);
    assert.deepEqual(blocked.map((b) => b.kind), ['OTHER_RPC', 'STORAGE_REQUEST', 'TABLE_REQUEST', 'FUNCTION_REQUEST', 'AUTH_REQUEST', 'SITE_REQUEST', 'OUTSIDE_ORIGIN', 'AUTH_REQUEST', 'OUTSIDE_ORIGIN', 'AUTH_REQUEST']);
    assert.equal(guard.counts.blockedWrites, 7);
    assert.equal(guard.counts.blockedFunctions, 1);
    assert.equal(guard.counts.blockedOutside, 2);
    assert.equal(guard.counts.externalDropped, 1, 'the analytics beacon is dropped silently');
    assert.equal(guard.counts.telemetryDropped, 1);
    assert.equal(guard.counts.aiFailed, 1);
    assert.equal(guard.counts.aiFixture, 1);
    assert.equal(guard.counts.placeCatalogFixture, 1);
    assert.equal(forwarded, 2, 'only the page itself and the read RPC were forwarded');
    const refresh = await call('POST', `${API}/auth/v1/token?grant_type=refresh_token`, '{}');
    assert.equal(refresh.ok, true, 'token refresh is forwarded (answered by the fixture origin here)');
    const localLogout = await call('POST', `${API}/auth/v1/logout?scope=local`, '{}');
    assert.equal(localLogout.ok, true, 'local sign-out is forwarded');
    assert.equal(forwarded, 4);
    // #873 L1/L2 in the page: repeated/wrong grant types and a beacon on a non-default port
    // are aborted before any transmission and counted as findings. (Plain HTTP from this
    // HTTPS page is stopped by the browser as mixed content, so it is asserted at the policy level.)
    const blockedBefore = blocked.length;
    const counterexamples = [];
    for (const q of ['grant_type=refresh_token&grant_type=password', 'grant_type=password&grant_type=refresh_token',
      'grant_type=refresh_token&grant_type=refresh_token', 'grant_type=password']) {
      counterexamples.push(await call('POST', `${API}/auth/v1/token?${q}`, '{}'));
    }
    counterexamples.push(await call('POST', 'https://cloudflareinsights.com:444/cdn-cgi/rum', '{}'));
    for (const result of counterexamples) assert.ok(result.error, 'never transmitted');
    assert.deepEqual(blocked.slice(blockedBefore).map((b) => b.code), ['UNEXPECTED_WRITE', 'UNEXPECTED_WRITE', 'UNEXPECTED_WRITE', 'UNEXPECTED_WRITE', 'UNEXPECTED_ORIGIN']);
    assert.equal(forwarded, 4, 'no counterexample was forwarded');
    assert.equal(guard.counts.blockedWrites, 11);
    assert.equal(guard.counts.blockedOutside, 3);
    assert.equal(guard.counts.externalDropped, 1, 'only the real HTTPS beacon was dropped silently');

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
    assert.equal(guard.counts.blockedWrites, 11, 'faults added no findings');
    assert.equal(forwarded, 5);
  } finally {
    await context.close();
    await browser.close();
  }
});

// ---------------------------------------------------------------------------------------
// GPT review (head 085bdc8, High): an admitted request answered with a redirect must not
// make the browser or Node issue a second request the guard never judged. The fixtures below
// are two isolated loopback servers: `allowed` plays the site and the Supabase origin (bound
// explicitly) and answers chosen paths with 3xx; `forbidden` plays every redirect target
// (another origin, a registration RPC, an Edge Function) and counts what reaches it. The
// credentials are visibly fake; no real host, account, token or network is involved.
// ---------------------------------------------------------------------------------------
const FAKE = { email: 'fake-qa-858@example.invalid', password: 'not-a-real-password-858', token: `eyJ${'f'.repeat(24)}.${'a'.repeat(24)}.${'k'.repeat(24)}`, apikey: 'fake-anon-key-858' };
const listen = (handler) => new Promise((resolve) => { const server = http.createServer(handler); server.listen(0, '127.0.0.1', () => resolve(server)); });
const origin = (server) => `http://127.0.0.1:${server.address().port}`;
async function startRedirectFixture() {
  const forbiddenHits = [];
  const forbidden = await listen((req, res) => { forbiddenHits.push(`${req.method} ${req.url}`); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"written":true}'); });
  const F = origin(forbidden);
  const allowedHits = [];
  let api;
  const redirectTo = (res, status, location) => { res.writeHead(status, { location, 'content-type': 'text/plain' }); res.end('redirecting'); };
  // One handler, two listeners: the site origin and the (explicitly bound) Supabase origin.
  const handler = (req, res) => {
    allowedHits.push(`${req.method} ${req.url}`);
    const A = origin(api);
    const path = req.url.split('?')[0];
    if (path === '/' || path === '/pick/new') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><body>fixture site</body>'); }
    if (path === '/deployment.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"sha":"fixture"}'); }
    if (path === '/moved-site') return redirectTo(res, 302, `${F}/landing`);                              // allowed site GET → other origin
    if (path === '/rest/v1/items') return redirectTo(res, 301, `${F}/rest/v1/items`);                      // allowed API read GET → other origin
    if (path === '/rest/v1/rpc/store_menu_options') return redirectTo(res, 307, `${A}/rest/v1/rpc/register_item_pick`); // read RPC → write RPC, same origin, method kept
    if (path === '/rest/v1/rpc/current_user_is_admin') return redirectTo(res, 308, `${A}/functions/v1/suggest-item-categories`); // read RPC → Edge Function
    if (path === '/rest/v1/rpc/home_pick_feed_page') return redirectTo(res, 303, `${F}/rest/v1/rpc/home_pick_feed_page`);          // read RPC → other project
    if (path === '/auth/v1/token') return redirectTo(res, 307, `${F}/auth/v1/token?grant_type=password`);   // Node password grant → other origin
    if (path === '/auth/v1/logout') return redirectTo(res, 308, `${A}/auth/v1/logout?scope=global`);        // local logout → global logout
    if (path === '/rest/v1/rpc/register_item_pick' || path.startsWith('/functions/v1/') || path.startsWith('/auth/v1/logout')) {
      forbiddenHits.push(`${req.method} ${req.url}`); res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"written":true}');
    }
    if (path === '/rest/v1/picks') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('[]'); }
    if (path === '/not-modified') { res.writeHead(304); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
  };
  const site = await listen(handler);
  api = await listen(handler);
  const close = () => Promise.all([site, api, forbidden].map((s) => new Promise((r) => s.close(r))));
  return { site: origin(site), api: origin(api), forbidden: F, forbiddenHits, allowedHits, close };
}
const secretsIn = (text) => Object.values(FAKE).filter((v) => text.includes(v));

test('Node redirects: guardedFetch never follows a 3xx, a caller cannot opt back in, the target receives nothing', async () => {
  const fx = await startRedirectFixture();
  try {
    const guard = createRestoreGuard({ api: fx.api, site: fx.site });
    const nodeFetch = guardedFetch(guard);
    const authHeaders = { apikey: FAKE.apikey, authorization: `Bearer ${FAKE.token}`, 'content-type': 'application/json' };
    // Plain reads still work, and a 304 is not treated as a redirect.
    assert.equal((await nodeFetch(`${fx.site}/deployment.json`)).status, 200);
    assert.equal((await nodeFetch(`${fx.api}/rest/v1/picks?select=id`, { headers: authHeaders })).status, 200);
    assert.equal((await nodeFetch(`${fx.api}/not-modified`, { headers: authHeaders })).status, 304);
    const errors = [];
    const attempt = async (url, init) => { try { await nodeFetch(url, init); errors.push('NO_ERROR'); } catch (error) { errors.push(error.message); } };
    // The password grant is admitted once — and its 307 to another origin is refused, even though
    // the caller asked fetch to follow redirects.
    const body = JSON.stringify({ email: FAKE.email, password: FAKE.password });
    await attempt(`${fx.api}/auth/v1/token?grant_type=password`, { method: 'POST', headers: authHeaders, body, redirect: 'follow' });
    await attempt(`${fx.api}/rest/v1/rpc/store_menu_options`, { method: 'POST', headers: authHeaders, body: '{}', redirect: 'follow' });
    await attempt(`${fx.api}/rest/v1/rpc/current_user_is_admin`, { method: 'POST', headers: authHeaders, body: '{}' });
    await attempt(`${fx.api}/rest/v1/rpc/home_pick_feed_page`, { method: 'POST', headers: authHeaders, body: '{}', redirect: 'error' });
    await attempt(`${fx.api}/rest/v1/items?select=*`, { headers: authHeaders });
    await attempt(`${fx.api}/auth/v1/logout?scope=local`, { method: 'POST', headers: authHeaders });
    await attempt(`${fx.site}/moved-site`);
    assert.deepEqual(errors, Array(7).fill('REDIRECT_BLOCKED'));
    assert.equal(guard.counts.blockedRedirects, 7);
    assert.equal(guard.counts.nodeLogins, 1);
    assert.equal(guard.failed, true);
    assert.deepEqual(fx.forbiddenHits, [], 'no redirect target was ever requested');
    assert.equal(fx.allowedHits.filter((h) => h.includes('register_item_pick') || h.includes('/functions/') || h.includes('scope=global')).length, 0);
    // The report carries closed codes only: kind of the original URL and of the target, status.
    const kinds = guard.blocked.map((b) => [b.code, b.kind, b.target, b.status]);
    assert.deepEqual(kinds, [
      ['REDIRECT_BLOCKED', 'AUTH_REQUEST', 'OUTSIDE_ORIGIN', 307], ['REDIRECT_BLOCKED', 'OTHER_RPC', 'OTHER_RPC', 307],
      ['REDIRECT_BLOCKED', 'OTHER_RPC', 'FUNCTION_REQUEST', 308], ['REDIRECT_BLOCKED', 'OTHER_RPC', 'OUTSIDE_ORIGIN', 303],
      ['REDIRECT_BLOCKED', 'TABLE_REQUEST', 'OUTSIDE_ORIGIN', 301], ['REDIRECT_BLOCKED', 'AUTH_REQUEST', 'AUTH_REQUEST', 308],
      ['REDIRECT_BLOCKED', 'SITE_REQUEST', 'OUTSIDE_ORIGIN', 302]]);
    const text = JSON.stringify({ blocked: guard.blocked, counts: guard.counts, errors });
    assert.deepEqual(secretsIn(text), [], 'no fake credential or token in the report');
    assert.ok(!/127\.0\.0\.1|https?:|\/rest\/|\/auth\//.test(text), 'no URL, host or path in the report');
    assert.equal(RESTORE_FAILURE_CODES.has('REDIRECT_BLOCKED'), true);
    assert.equal(safeRestoreFailureCode(new Error('REDIRECT_BLOCKED')), 'REDIRECT_BLOCKED');
    for (const status of [300, 301, 302, 303, 305, 307, 308]) assert.ok(REDIRECT_STATUSES.has(status));
    assert.equal(REDIRECT_STATUSES.has(304), false);
  } finally { await fx.close(); }
});

test('Node redirects: the fetch implementation is always called with redirect=manual, whatever init says', async () => {
  const guard = createRestoreGuard({ api: API, site: SITE });
  const seen = [];
  const stub = async (url, init) => { seen.push(init.redirect); return { status: 200, headers: new Headers() }; };
  const nodeFetch = guardedFetch(guard, stub);
  await nodeFetch(`${SITE}/deployment.json`);
  await nodeFetch(`${SITE}/deployment.json`, { redirect: 'follow' });
  await nodeFetch(`${SITE}/deployment.json`, { redirect: 'error' });
  await nodeFetch(`${API}/rest/v1/picks?select=id`, { method: 'GET', redirect: undefined });
  assert.deepEqual(seen, ['manual', 'manual', 'manual', 'manual']);
  // A stub answering 3xx without a Location header is still a finding (target INVALID_URL).
  const redirecting = guardedFetch(guard, async () => ({ status: 302, headers: new Headers() }));
  await assert.rejects(redirecting(`${SITE}/x`), /^Error: REDIRECT_BLOCKED$/);
  assert.deepEqual(guard.blocked.at(-1), { code: 'REDIRECT_BLOCKED', kind: 'SITE_REQUEST', status: 302, target: 'INVALID_URL' });
  // Relative Location is resolved against the request URL before classification.
  const relative = guardedFetch(guard, async () => ({ status: 307, headers: new Headers({ location: '/functions/v1/paid' }) }));
  await assert.rejects(relative(`${API}/rest/v1/rpc/store_menu_options`, { method: 'POST' }), /REDIRECT_BLOCKED/);
  assert.equal(guard.blocked.at(-1).target, 'FUNCTION_REQUEST');
});

test('browser redirects: the route handler performs admitted requests itself and aborts any 3xx before the browser can follow it', async () => {
  const { chromium } = await import('playwright');
  const fx = await startRedirectFixture();
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const guard = createRestoreGuard({ api: fx.api, site: fx.site });
  const blocked = [];
  // Exactly what the live runner installs: no `forward` override, so forwardWithoutRedirects is used.
  await context.route('**/*', (route) => handleRoute(guard, route, { onBlocked: (entry) => blocked.push(entry) }));
  const page = await context.newPage();
  const consoleText = [];
  page.on('console', (m) => consoleText.push(m.text()));
  try {
    await page.goto(`${fx.site}/pick/new`);
    assert.equal(await page.evaluate(() => document.body.textContent), 'fixture site', 'admitted navigation is fulfilled from the fetched response');
    const call = (method, url, body, redirect = 'follow') => page.evaluate(async ([m, u, b, r]) => {
      try {
        const res = await fetch(u, { method: m, redirect: r, headers: { 'content-type': 'application/json', apikey: 'fake-anon-key-858', authorization: 'Bearer eyJ' + 'f'.repeat(24) + '.' + 'a'.repeat(24) + '.' + 'k'.repeat(24) }, body: b });
        return { ok: res.ok, status: res.status, type: res.type };
      } catch (error) { return { error: String(error?.name ?? error) }; }
    }, [method, url, body ?? null, redirect]);
    // Admitted and answered without a redirect: a read.
    assert.equal((await call('GET', `${fx.api}/rest/v1/picks?select=id`)).ok, true);
    // Every redirecting admitted request fails in the page, with the browser's default `follow`.
    const results = [
      await call('GET', `${fx.site}/moved-site`),
      await call('GET', `${fx.api}/rest/v1/items?select=*`),
      await call('POST', `${fx.api}/rest/v1/rpc/store_menu_options`, '{}'),
      await call('POST', `${fx.api}/rest/v1/rpc/current_user_is_admin`, '{}'),
      await call('POST', `${fx.api}/rest/v1/rpc/home_pick_feed_page`, '{}'),
      await call('POST', `${fx.api}/auth/v1/logout?scope=local`, '{}'),
      await call('POST', `${fx.api}/auth/v1/token?grant_type=refresh_token`, JSON.stringify({ refresh_token: FAKE.token }), 'manual'),
    ];
    for (const result of results) assert.ok(result.error, `redirecting request fails in the page: ${JSON.stringify(result)}`);
    // A top-level navigation that redirects is refused too (the browser would otherwise follow it).
    const nav = await page.goto(`${fx.site}/moved-site`).then(() => 'navigated', (error) => error.message);
    assert.notEqual(nav, 'navigated');
    assert.ok(/ERR_BLOCKED_BY_CLIENT|ERR_FAILED|blocked/i.test(nav), nav);
    assert.equal(blocked.length, 8);
    assert.ok(blocked.every((b) => b.code === 'REDIRECT_BLOCKED'));
    assert.deepEqual(blocked.map((b) => b.kind), ['SITE_REQUEST', 'TABLE_REQUEST', 'OTHER_RPC', 'OTHER_RPC', 'OTHER_RPC', 'AUTH_REQUEST', 'AUTH_REQUEST', 'SITE_REQUEST']);
    assert.equal(guard.counts.blockedRedirects, 8);
    assert.equal(guard.failed, true);
    assert.deepEqual(fx.forbiddenHits, [], 'no redirect target (other origin, write RPC, Edge Function, global logout) received a request');
    // The browser never issued the follow-up request itself either: the allowed server saw each
    // redirecting path exactly once, from Playwright's fetch, and nothing else.
    const follow = fx.allowedHits.filter((h) => /register_item_pick|\/functions\/|scope=global|landing/.test(h));
    assert.deepEqual(follow, []);
    // Nothing in the guard's report or in the page's own console carries URLs or the fake credentials.
    const text = JSON.stringify({ blocked: guard.blocked, counts: guard.counts });
    assert.deepEqual(secretsIn(text), []);
    assert.ok(!/127\.0\.0\.1|https?:/.test(text));
    const runtime = createRestoreRuntime();
    for (const line of consoleText) runtime.consoleError(line);
    assert.deepEqual(secretsIn(JSON.stringify(runtime.summary)), []);
    assert.ok(!/https?:|127\.0\.0\.1/.test(JSON.stringify(runtime.summary)));
  } finally {
    await context.close();
    await browser.close();
    await fx.close();
  }
});

test('browser redirects: a held classification request released later is forwarded under the same no-redirect rule', async () => {
  const { chromium } = await import('playwright');
  const fx = await startRedirectFixture();
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const guard = createRestoreGuard({ api: fx.api, site: fx.site });
  const blocked = [];
  const onBlocked = (entry) => blocked.push(entry);
  await context.route('**/*', (route) => handleRoute(guard, route, { onBlocked }));
  const page = await context.newPage();
  try {
    await page.goto(`${fx.site}/pick/new`);
    guard.setFault('holdMenuOptions', true);
    const held = page.evaluate(async (u) => { try { const r = await fetch(u, { method: 'POST', body: '{}' }); return { status: r.status }; } catch (error) { return { error: String(error?.name ?? error) }; } }, `${fx.api}/rest/v1/rpc/store_menu_options`);
    for (let i = 0; i < 40 && guard.parkedCount === 0; i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.equal(guard.parkedCount, 1);
    guard.setFault('holdMenuOptions', false);
    // The live runner's release path.
    assert.equal(await guard.release((route) => forwardWithoutRedirects(guard, route, onBlocked)), 1);
    assert.ok((await held).error, 'the released request redirected to a write RPC and was aborted');
    assert.deepEqual(blocked.map((b) => [b.code, b.kind]), [['REDIRECT_BLOCKED', 'OTHER_RPC']]);
    assert.deepEqual(fx.forbiddenHits, []);
    assert.equal(guard.counts.held, 1);
    assert.equal(guard.counts.blockedRedirects, 1);
  } finally {
    await context.close();
    await browser.close();
    await fx.close();
  }
});
