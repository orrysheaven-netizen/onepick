// Default-deny network policy and draft helpers for the opt-in `/pick/new` draft
// restore QA (`QA_DRAFT_RESTORE=1`, issue #858). Pure functions only: the browser
// flow in logged-in-qa.mjs asks `decide()` for every request and never calls the
// network itself. Nothing here fabricates a registration, upload or AI answer the
// product would treat as real: fixtures are limited to (a) a synthetic menu AI
// suggestion and (b) `category_uses_place_catalog = false`, both of which only
// steer the screen along the restore path without a data write.
import { assertSessionBudget, requireCondition as need, uuid } from './registration-write-contract.mjs';

export { assertSessionBudget, uuid };

// Visibly synthetic inputs. The menu name must not match the taxonomy exactly, so
// the AI pass is attempted (and intercepted) instead of an exact-match short cut.
export const RESTORE_MENU = 'QA 복원 검증 메뉴 858';
// Typed over RESTORE_MENU on 2/4 in the "edit after confirm" regression (#858): still synthetic.
export const RESTORE_MENU_EDITED = 'QA 복원 검증 메뉴 858 수정';
export const RESTORE_REVIEW = 'QA 초안 복원 검증용 한줄평이에요. 등록하지 않아요.';
export const DRAFT_KEY = 'onepick:pick-draft:v1';
export const DRAFT_PHOTO_KEY = 'onepick:pick-draft-photo:v1';
export const AI_PATH = '/functions/v1/suggest-item-categories';
export const PLACE_CATALOG_RPC = '/rest/v1/rpc/category_uses_place_catalog';

// Database functions the web app calls through POST that only read. Every entry is
// declared STABLE with no INSERT/UPDATE/DELETE in its latest migration (checked
// 2026-10-10 against supabase/migrations). Re-review whenever a listed function gains
// side effects. Two groups, one policy:
//  - the registration screen (`/pick/new`) during the restore scenario itself;
//  - the bootstrap the restore run performs under the same guard before the scenario:
//    Supabase discovery on `/` (home feed, rankings, brands), the signed-in `/profile`
//    check (own picks, comments, requests, follow counts, taste composition) and the tab
//    bar's unread badge. The bootstrap must not need anything outside this list; a POST
//    to any other RPC fails the run closed.
export const RESTORE_READ_RPCS = new Set(['search_store_catalog_page', 'search_store_catalog', 'search_place_catalog',
  'store_menu_options', 'current_user_is_admin', 'item_review_page', 'item_brands', 'search_items', 'search_item_pick_counts',
  'item_photo_credit', 'brand_profile']);
export const BOOTSTRAP_READ_RPCS = new Set(['home_pick_feed_page', 'home_following_feed_page', 'home_showcase_page', 'home_editorial_items',
  'food_item_recent_ranking', 'food_menu_recent_ranking', 'food_menu_pick_counts', 'ranking_categories', 'category_ranking',
  'category_top_items', 'explore_recent_items_page', 'dish_channel_overview', 'notification_unread_count',
  'profile_follow_counts', 'follow_counts', 'profile_follow_connections_page', 'profile_taste_composition',
  'my_comment_page', 'pick_comment_page', 'comment_locate']);
export const READ_RPCS = new Set([...RESTORE_READ_RPCS, ...BOOTSTRAP_READ_RPCS]);
// Best-effort telemetry: dropped silently, never a finding and never forwarded.
const TELEMETRY_PATHS = new Set(['/rest/v1/client_error_events', '/rest/v1/rpc/capture_product_event']);
// The one third-party beacon the deployed page sends: Cloudflare Web Analytics, injected by
// Cloudflare Pages, loads `static.cloudflareinsights.com/beacon.min.js` (a GET — a read like
// any other outside read) and reports with `POST https://cloudflareinsights.com/cdn-cgi/rum`.
// Only that exact host + path + method is dropped silently; any other mutation aimed at
// those hosts (or anywhere else outside the two origins) is a finding (GPT review L2).
// The origin must match exactly (#873 L1): plain HTTP or a non-default port is not the beacon.
export const KNOWN_TELEMETRY_BEACONS = [{ origin: 'https://cloudflareinsights.com', host: 'cloudflareinsights.com', path: '/cdn-cgi/rum', method: 'POST' }];
export function isKnownTelemetryBeacon(u, method) {
  return KNOWN_TELEMETRY_BEACONS.some((b) => u.origin === b.origin && u.hostname === b.host && u.pathname === b.path && method === b.method);
}
// Responses a forwarded request may NOT come back with: a redirect would make the browser
// (or Node's fetch) issue a second request the guard never judged. 304 is not a redirect.
export const REDIRECT_STATUSES = new Set([300, 301, 302, 303, 305, 307, 308]);
// The Supabase project is discovered from the deployed bundle at run time, so a guard
// may start unbound and bind to the first request whose host matches this pattern.
export const SUPABASE_HOST_PATTERN = /\.supabase\.co$/;

// Only a manual run of the dedicated workflow on main may use the QA account for this flow.
export function assertDraftRestoreExecution(env) {
  need(env.GITHUB_EVENT_NAME === 'workflow_dispatch'
    && env.GITHUB_REF === 'refs/heads/main'
    && env.GITHUB_REPOSITORY === 'orrysheaven-netizen/onepick'
    && env.GITHUB_RUN_ATTEMPT === '1'
    && Boolean(env.ONEPICK_QA_EMAIL && env.ONEPICK_QA_PASSWORD), 'EXECUTION_NOT_AUTHORIZED');
}

// Synthetic AI answer for the "classification succeeds" pass. The category must come
// from the real `store_menu_options` response captured in the same run, so the app's
// own allow-list (`aiAllowed`) accepts it; the harness never invents a category id.
export function aiSuccessFixture(category) {
  need(category && uuid(category.categoryId) && typeof category.name === 'string' && category.name.length > 0, 'FIXTURE_CATEGORY_INVALID');
  return {
    suggestions: [{ categoryId: category.categoryId, label: category.name, reason: 'QA fixture', confidence: 'high' }],
    needsNewCategory: false,
  };
}

// `rows` is the raw `store_menu_options` response. The screen only accepts AI
// suggestions for `place_enabled` menus (new.tsx `availableMenus`), so pick one of those.
export function pickFixtureCategory(rows) {
  if (!Array.isArray(rows)) return null;
  const chosen = rows.find((row) => row && row.place_enabled === true && uuid(row.category_id)
    && typeof row.name === 'string' && row.name);
  return chosen ? { categoryId: chosen.category_id, name: chosen.name } : null;
}

// Closed diagnostic vocabulary against the configured origins. Never returns URL parts.
export function requestKind(url, api, site) {
  let u;
  try { u = new URL(url); } catch { return 'INVALID_URL'; }
  if (u.origin === site) return 'SITE_REQUEST';
  if (u.origin !== api) return 'OUTSIDE_ORIGIN';
  if (u.pathname.startsWith('/rest/v1/rpc/')) return 'OTHER_RPC';
  if (u.pathname.startsWith('/auth/v1/')) return 'AUTH_REQUEST';
  if (u.pathname.startsWith('/storage/v1/')) return 'STORAGE_REQUEST';
  if (u.pathname.startsWith('/functions/v1/')) return 'FUNCTION_REQUEST';
  if (u.pathname.startsWith('/rest/v1/')) return 'TABLE_REQUEST';
  return 'OTHER_API_REQUEST';
}

// The only Supabase Auth mutations the signed-in web app may need during the run:
// a token refresh and the *local* sign-out (this browser's session only). A global
// sign-out would revoke the QA account's other sessions; sign-up, password/identity
// changes, recovery mails and new password grants are account changes. All fail closed.
// `scope` must be given exactly once (GPT review L1): a repeated parameter such as
// `?scope=local&scope=global` is refused whatever the server would pick. The same holds for
// `grant_type` (#873 L2): exactly one value, equal to the expected grant, or it is refused.
export function hasSingleGrantType(u, grant) {
  const grants = u.searchParams.getAll('grant_type');
  return grants.length === 1 && grants[0] === grant;
}
export function isAllowedAuthMutation(u, method) {
  if (method !== 'POST') return false;
  if (u.pathname === '/auth/v1/logout') {
    const scopes = u.searchParams.getAll('scope');
    return scopes.length === 1 && scopes[0] === 'local';
  }
  return u.pathname === '/auth/v1/token' && hasSingleGrantType(u, 'refresh_token');
}

// The harness's own sign-in from Node (the app only offers social login). Allowed to the
// Node policy exactly once per run and never to the browser.
export function isPasswordGrant(u, method) {
  return method === 'POST' && u.pathname === '/auth/v1/token' && hasSingleGrantType(u, 'password');
}

// Storage reads the screen may issue for already-published images. Anything else on
// Storage (uploads, deletes, listing, signing, private objects) is not part of this QA.
const STORAGE_READ_PREFIXES = ['/storage/v1/object/public/', '/storage/v1/render/image/public/'];
export function isStorageRead(u, method) {
  return (method === 'GET' || method === 'HEAD') && STORAGE_READ_PREFIXES.some((p) => u.pathname.startsWith(p));
}

export const MENU_OPTIONS_RPC = '/rest/v1/rpc/store_menu_options';
export const PICKS_TABLE = '/rest/v1/picks';

// The classification request the restore waits on (held to reproduce "classification pending").
export function isMenuOptionsRequest(u, method) {
  return method === 'POST' && u.pathname === MENU_OPTIONS_RPC;
}

// The current-Pick lookup confirmMenu performs before leaving 2/4 (failed to reproduce #861/#865 test 14).
export function isCurrentPickSlotRead(u, method) {
  return method === 'GET' && u.pathname === PICKS_TABLE && u.searchParams.has('user_id') && u.searchParams.has('category_id');
}

/**
 * Request policy. `mode` is 'fail' (menu AI unreachable) or 'success' (fixture answer).
 * `faults` are the two restore fault switches: `holdMenuOptions` parks the classification
 * request so the screen stays "pending"; `failPickSlotRead` fails the current-Pick lookup.
 * Returns one of:
 *   { action: 'continue' }                      forward (reads only) — without following redirects, see forwardWithoutRedirects
 *   { action: 'hold' }                          park the request until release() (fault)
 *   { action: 'abort', reason, silent: true }   drop without a finding (telemetry, 3rd-party reads, AI failure, injected fault)
 *   { action: 'fulfill', status, json }         answer locally with a fixture
 *   { action: 'abort', reason, fail: CODE }     blocked write / paid call / outside write: the run fails closed
 * `kind` (closed vocabulary from requestKind) is attached for the report; no URL leaks.
 *
 * `api` may be null: the Supabase origin is then bound to the first request whose host
 * matches SUPABASE_HOST_PATTERN (the discovery visit), so the very first browser context
 * of a run is already under this policy. `bindApi()` pins it explicitly afterwards.
 *
 * Order matters: Functions and Storage are judged BEFORE the generic read allowance so a
 * GET to an Edge Function (paid AI) or a non-public Storage path can never slip through.
 * Outside the two origins only GET/HEAD/OPTIONS (fonts, images) and known analytics
 * beacons are dropped silently; any other outside mutation attempt is a finding, even
 * though it is never forwarded.
 */
export function createRestoreGuard({ api = null, site }) {
  need((api === null || typeof api === 'string') && typeof site === 'string', 'GUARD_CONFIG_INVALID');
  let mode = 'fail';
  let fixture = null;
  const faults = { holdMenuOptions: false, failPickSlotRead: false };
  const counts = { aiFailed: 0, aiFixture: 0, placeCatalogFixture: 0, telemetryDropped: 0, externalDropped: 0,
    blockedWrites: 0, blockedFunctions: 0, blockedOutside: 0, blockedNodeCalls: 0, blockedRedirects: 0, nodeLogins: 0, held: 0, slotReadFailed: 0 };
  const blocked = [];
  const parked = [];
  const fail = (code, url, extra = {}) => {
    if (code === 'UNEXPECTED_FUNCTION') counts.blockedFunctions += 1;
    else if (code === 'UNEXPECTED_ORIGIN') counts.blockedOutside += 1;
    else if (code === 'NODE_CALL_BLOCKED') counts.blockedNodeCalls += 1;
    else if (code === 'REDIRECT_BLOCKED') counts.blockedRedirects += 1;
    else counts.blockedWrites += 1;
    const kind = requestKind(url, api, site);
    if (blocked.length < 10) blocked.push({ code, kind, ...extra });
    return { action: 'abort', reason: 'blockedbyclient', fail: code, kind, ...extra };
  };
  const bind = (origin) => {
    need(typeof origin === 'string' && (api === null || api === origin), 'API_ORIGIN_MISMATCH');
    api = origin;
  };
  const isApiHost = (u) => (api === null ? SUPABASE_HOST_PATTERN.test(u.hostname) : u.origin === api);
  const guard = {
    get api() { return api; },
    get mode() { return mode; },
    get faults() { return { ...faults }; },
    get counts() { return { ...counts }; },
    get blocked() { return blocked.slice(); },
    get failed() { return counts.blockedWrites > 0 || counts.blockedFunctions > 0 || counts.blockedOutside > 0 || counts.blockedNodeCalls > 0 || counts.blockedRedirects > 0; },
    get parkedCount() { return parked.length; },
    bindApi: bind,
    // An admitted request answered with a redirect (GPT review High, head 085bdc8): the
    // follow-up request is never issued, in the browser or from Node. Recorded as a finding
    // with the closed kind of the original URL and of the redirect target (never the URLs).
    rejectRedirect({ url, status, location }) {
      let target = 'INVALID_URL';
      if (location) { try { target = requestKind(new URL(String(location), url).href, api, site); } catch { target = 'INVALID_URL'; } }
      return fail('REDIRECT_BLOCKED', url, { status: Number(status) || 0, target });
    },
    setMode(next, category = null) {
      need(next === 'fail' || next === 'success', 'GUARD_MODE_INVALID');
      fixture = next === 'success' ? aiSuccessFixture(category) : null;
      mode = next;
    },
    setFault(name, on) {
      need(Object.hasOwn(faults, name) && typeof on === 'boolean', 'GUARD_FAULT_INVALID');
      faults[name] = on;
    },
    // handleRoute parks held routes here; release() lets them through (as reads).
    park(route) { parked.push(route); },
    async release(forward) {
      const routes = parked.splice(0);
      for (const route of routes) await forward(route).catch(() => {});
      return routes.length;
    },
    decide({ url, method }) {
      let u;
      try { u = new URL(url); } catch { return fail('UNEXPECTED_ORIGIN', 'invalid:'); }
      const read = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
      if (u.origin === site) return read ? { action: 'continue' } : fail('UNEXPECTED_WRITE', url);
      if (!isApiHost(u)) {
        // Never forwarded. Fonts/images (reads) and the one known analytics beacon are not
        // findings; any other mutation aimed outside the two origins is, even though it is dropped.
        if (read || isKnownTelemetryBeacon(u, method)) {
          counts.externalDropped += 1;
          return { action: 'abort', reason: 'blockedbyclient', silent: true };
        }
        return fail('UNEXPECTED_ORIGIN', url);
      }
      if (api === null) bind(u.origin);
      // Supabase origin from here on. Paid/side-effect surfaces first, whatever the method.
      if (u.pathname.startsWith('/functions/v1/')) {
        if (method === 'POST' && u.pathname === AI_PATH) {
          if (mode === 'success') {
            counts.aiFixture += 1;
            return { action: 'fulfill', status: 200, json: fixture };
          }
          counts.aiFailed += 1;
          return { action: 'abort', reason: 'failed', silent: true };
        }
        return fail('UNEXPECTED_FUNCTION', url);
      }
      if (u.pathname.startsWith('/storage/v1/')) {
        return isStorageRead(u, method) ? { action: 'continue' } : fail('UNEXPECTED_WRITE', url);
      }
      if (u.pathname.startsWith('/auth/v1/')) {
        if (read) return { action: 'continue' };
        return isAllowedAuthMutation(u, method) ? { action: 'continue' } : fail('UNEXPECTED_WRITE', url);
      }
      if (read) {
        if (faults.failPickSlotRead && isCurrentPickSlotRead(u, method)) {
          counts.slotReadFailed += 1;
          return { action: 'abort', reason: 'connectionfailed', silent: true };
        }
        return { action: 'continue' };
      }
      if (TELEMETRY_PATHS.has(u.pathname)) {
        counts.telemetryDropped += 1;
        return { action: 'abort', reason: 'blockedbyclient', silent: true };
      }
      if (method === 'POST' && u.pathname === PLACE_CATALOG_RPC) {
        // Read-only SQL in production, but answered locally so the resumed step never
        // depends on catalog/brand rows and never reaches the brand-scope prompt.
        counts.placeCatalogFixture += 1;
        return { action: 'fulfill', status: 200, json: false };
      }
      if (method === 'POST' && u.pathname.startsWith('/rest/v1/rpc/') && READ_RPCS.has(u.pathname.slice('/rest/v1/rpc/'.length))) {
        if (faults.holdMenuOptions && isMenuOptionsRequest(u, method)) {
          counts.held += 1;
          return { action: 'hold' };
        }
        return { action: 'continue' };
      }
      // Everything else — registration RPCs, table inserts/updates, unknown RPCs — fails closed.
      return fail('UNEXPECTED_WRITE', url);
    },
    // Policy for the harness's own fetches from Node (login, execution gate, Pick count,
    // sign-out). Same read/auth allowance as the browser, plus the password grant exactly
    // once. Fixtures, holds and silent drops are browser-only: Node asking for one of
    // those paths is itself a finding. Returns { allowed, code? }; nothing is fetched here.
    decideNode({ url, method }) {
      let u;
      try { u = new URL(url); } catch { return { allowed: false, code: fail('NODE_CALL_BLOCKED', 'invalid:').fail }; }
      if (isApiHost(u) && isPasswordGrant(u, method)) {
        if (counts.nodeLogins >= 1) return { allowed: false, code: fail('NODE_CALL_BLOCKED', url).fail };
        counts.nodeLogins += 1;
        if (api === null) bind(u.origin);
        return { allowed: true };
      }
      const verdict = guard.decide({ url, method });
      if (verdict.action === 'continue') return { allowed: true };
      if (verdict.fail) return { allowed: false, code: verdict.fail };
      return { allowed: false, code: fail('NODE_CALL_BLOCKED', url).fail };
    },
  };
  return guard;
}

// `fetch` for the harness's Node side: consults the guard first and never sends a request
// it would not allow. Redirects are never followed: `redirect` is forced to 'manual' whatever
// the caller passed (a caller cannot opt back into 'follow'), and a 3xx answer is a finding
// (`REDIRECT_BLOCKED`) — the Location target is never requested. The thrown error carries
// only the closed code.
export function guardedFetch(guard, fetchImpl = globalThis.fetch) {
  return async (url, init = {}) => {
    const method = String(init.method ?? 'GET').toUpperCase();
    const verdict = guard.decideNode({ url: String(url), method });
    if (!verdict.allowed) throw new Error(verdict.code);
    const response = await fetchImpl(url, { ...init, redirect: 'manual' });
    if (REDIRECT_STATUSES.has(response.status)) {
      guard.rejectRedirect({ url: String(url), status: response.status, location: response.headers?.get?.('location') });
      throw new Error('REDIRECT_BLOCKED');
    }
    return response;
  };
}

// Forwarding of an admitted browser request. `route.continue()` would let the browser follow
// a redirect to a destination the guard never judged (route handlers run once per request:
// https://playwright.dev/docs/network#redirects), so the request is performed by Playwright
// with redirects disabled and the first response is fulfilled as-is; a 3xx is aborted and
// recorded as `REDIRECT_BLOCKED` without any request to its target. A transport failure
// (connection refused, DNS) is aborted the way a plain continue() would have failed.
export async function forwardWithoutRedirects(guard, route, onBlocked = () => {}) {
  let response;
  try {
    response = await route.fetch({ maxRedirects: 0 });
  } catch {
    await route.abort('failed').catch(() => {});
    return { action: 'abort', reason: 'failed', silent: true };
  }
  const status = response.status();
  if (REDIRECT_STATUSES.has(status)) {
    const verdict = guard.rejectRedirect({ url: route.request().url(), status, location: response.headers()['location'] });
    onBlocked({ code: verdict.fail, kind: verdict.kind });
    await route.abort('blockedbyclient').catch(() => {});
    return verdict;
  }
  await route.fulfill({ response });
  return { action: 'continue' };
}

// Restore-mode runtime events are reported as closed codes and counts, never as the
// browser's message text, a URL or a status line that could carry page content, a token
// or the account. The code set is small on purpose: it tells whether the page broke
// (JS_EXCEPTION), a request was refused by the guard or the network (REQUEST_BLOCKED,
// NETWORK_ERROR), the server answered an error (HTTP_ERROR) or something else was logged.
export const RUNTIME_EVENT_CODES = new Set(['JS_EXCEPTION', 'REQUEST_BLOCKED', 'NETWORK_ERROR', 'HTTP_ERROR', 'REACT_WARNING', 'CONSOLE_ERROR']);
export function classifyRuntimeMessage(kind, text) {
  const t = String(text ?? '');
  if (/ERR_BLOCKED_BY_CLIENT|blockedbyclient|net::ERR_FAILED|ERR_CONNECTION_FAILED|connectionfailed/i.test(t)) return 'REQUEST_BLOCKED';
  if (/Failed to fetch|NetworkError|Load failed|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|fetch failed/i.test(t)) return 'NETWORK_ERROR';
  if (/the server responded with a status of \d{3}|\b(4\d\d|5\d\d) \(/i.test(t)) return 'HTTP_ERROR';
  if (kind === 'pageerror') return 'JS_EXCEPTION';
  if (/^Warning:|React|act\(\)|key prop|forwardRef/i.test(t)) return 'REACT_WARNING';
  return 'CONSOLE_ERROR';
}

// Collector used for every browser context of a restore run. Only counts per code plus
// (status, kind) pairs for HTTP errors are kept; `kind` is requestKind's closed vocabulary.
export function createRestoreRuntime() {
  const events = {};
  const responses = [];
  return {
    pageError(message) { const code = classifyRuntimeMessage('pageerror', message); events[code] = (events[code] ?? 0) + 1; },
    consoleError(message) { const code = classifyRuntimeMessage('console', message); events[code] = (events[code] ?? 0) + 1; },
    response(url, status, api, site) {
      if (status < 400) return;
      if (responses.length < 50) responses.push({ status, kind: requestKind(url, api, site) });
    },
    get summary() { return { events: { ...events }, responses: responses.slice() }; },
    get total() { return Object.values(events).reduce((a, b) => a + b, 0) + responses.length; },
  };
}

// Playwright route handler shared by the live flow and the offline browser test, so
// what is tested is what runs. `onBlocked` receives { code, kind } for a failed write;
// `forward` (default: forwardWithoutRedirects) lets the offline test answer admitted reads
// locally. The live flow never passes `forward`, so admitted requests cannot redirect.
export async function handleRoute(guard, route, { onBlocked = () => {}, forward = null } = {}) {
  const request = route.request();
  const verdict = guard.decide({ url: request.url(), method: request.method() });
  if (verdict.action === 'continue') {
    return forward ? (await forward(route), verdict) : forwardWithoutRedirects(guard, route, onBlocked);
  }
  if (verdict.action === 'hold') { guard.park(route); return verdict; }
  if (verdict.action === 'fulfill') {
    await route.fulfill({ status: verdict.status, contentType: 'application/json', body: JSON.stringify(verdict.json) });
    return verdict;
  }
  if (verdict.fail) onBlocked({ code: verdict.fail, kind: verdict.kind });
  await route.abort(verdict.reason).catch(() => {});
  return verdict;
}

// Draft record as the app stores it (mobile/src/lib/pick/pickDraft.ts, v1). Only the
// fields the QA asserts on are returned; the photo payload itself is never read back.
export function inspectDraft(rawDraft, rawPhoto) {
  let record = null;
  try { record = rawDraft ? JSON.parse(rawDraft) : null; } catch { record = null; }
  if (!record || record.v !== 1 || !record.fields || typeof record.fields !== 'object') return null;
  const f = record.fields;
  let photoRecordUser = null;
  try { photoRecordUser = rawPhoto ? JSON.parse(rawPhoto)?.userId ?? null : null; } catch { photoRecordUser = null; }
  return {
    userId: record.userId,
    step: f.step,
    review: typeof f.review === 'string' ? f.review : '',
    menuQuery: typeof f.menuQuery === 'string' ? f.menuQuery : '',
    menuName: f.menu && typeof f.menu === 'object' ? f.menu.name ?? null : null,
    storeName: f.store && typeof f.store === 'object' ? f.store.name ?? null : null,
    photo: record.photo,
    photoRecordMatches: record.photo === 'stored' ? photoRecordUser === record.userId : null,
  };
}

// Mutations the QA applies to sessionStorage between reloads. They return the new
// draft JSON (or null to delete) so the browser side stays a dumb setItem/removeItem.
export function markPhotoLost(rawDraft) {
  const record = JSON.parse(rawDraft);
  need(record?.v === 1 && record.photo === 'stored', 'DRAFT_PHOTO_NOT_STORED');
  return JSON.stringify({ ...record, photo: 'lost' });
}

export function reassignDraftOwner(rawDraft, otherUserId) {
  const record = JSON.parse(rawDraft);
  need(record?.v === 1 && uuid(otherUserId) && record.userId !== otherUserId, 'DRAFT_REASSIGN_INVALID');
  return JSON.stringify({ ...record, userId: otherUserId });
}

// Expected draft after the review step was reached: resume target 5 with everything kept.
export function assertReviewDraft(draft, { storeName, userId, menuQuery = RESTORE_MENU }) {
  need(draft, 'DRAFT_MISSING');
  need(draft.userId === userId, 'DRAFT_OWNER_MISMATCH');
  need(draft.step === 5, 'DRAFT_STEP_LOST');
  need(draft.review === RESTORE_REVIEW, 'DRAFT_REVIEW_LOST');
  need(draft.menuQuery === menuQuery, 'DRAFT_MENU_LOST');
  need(!storeName || draft.storeName === storeName, 'DRAFT_STORE_LOST');
  need(draft.photo === 'stored' && draft.photoRecordMatches === true, 'DRAFT_PHOTO_LOST');
}

// Every failure the restore flow can report. The report never carries error.message
// verbatim: an unknown message (library error, page text, anything that could hold a
// token or account detail) is reduced to UNCLASSIFIED_FAILURE.
export const RESTORE_FAILURE_CODES = new Set(['EXECUTION_NOT_AUTHORIZED', 'DEPLOYMENT_NOT_CURRENT', 'GENERAL_USER_REQUIRED',
  'SESSION_EXPIRY_INVALID', 'SESSION_BUDGET_INSUFFICIENT', 'PICK_COUNT_READ_FAILED',
  'FIXTURE_CATEGORY_INVALID', 'GUARD_MODE_INVALID', 'GUARD_FAULT_INVALID', 'GUARD_CONFIG_INVALID',
  'UNEXPECTED_WRITE', 'UNEXPECTED_FUNCTION', 'UNEXPECTED_ORIGIN', 'NODE_CALL_BLOCKED', 'REDIRECT_BLOCKED', 'API_ORIGIN_MISMATCH',
  'SUPABASE_NOT_DISCOVERED', 'LOGIN_FAILED', 'APP_SESSION_NOT_RECOGNIZED', 'QA_USERNAME_MISSING', 'PROFILE_NOT_SHOWN',
  'MENU_EDIT_NOT_RESET', 'RESUME_SKIPPED_PHOTO_STEP', 'STORE_CHANGE_NOT_RESET',
  'DRAFT_MISSING', 'DRAFT_OWNER_MISMATCH', 'DRAFT_STEP_LOST', 'DRAFT_REVIEW_LOST', 'DRAFT_MENU_LOST',
  'DRAFT_STORE_LOST', 'DRAFT_PHOTO_LOST', 'DRAFT_PHOTO_NOT_STORED', 'DRAFT_REASSIGN_INVALID',
  'PICK_COUNT_CHANGED', 'MENU_AI_NOT_ATTEMPTED', 'MENU_OPTIONS_NOT_CAPTURED', 'MENU_OPTIONS_NOT_HELD',
  'LOGIN_REQUIRED_SCREEN', 'STEP_NOT_REACHED', 'RESTORE_TOO_EARLY', 'RESTORE_FAILED', 'RETRY_FAILED',
  'STORE_LABEL_CHANGED', 'STEP_LABEL_CHANGED', 'NEXT_DISABLED', 'DRAFT_SHOWN_SIGNED_OUT',
  'OTHER_OWNER_DRAFT_RESTORED', 'OTHER_OWNER_DRAFT_KEPT', 'UNCLASSIFIED_FAILURE']);
export function safeRestoreFailureCode(error) {
  return RESTORE_FAILURE_CODES.has(error?.message) ? error.message : 'UNCLASSIFIED_FAILURE';
}
