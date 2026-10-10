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
export const RESTORE_REVIEW = 'QA 초안 복원 검증용 한줄평이에요. 등록하지 않아요.';
export const DRAFT_KEY = 'onepick:pick-draft:v1';
export const DRAFT_PHOTO_KEY = 'onepick:pick-draft-photo:v1';
export const AI_PATH = '/functions/v1/suggest-item-categories';
export const PLACE_CATALOG_RPC = '/rest/v1/rpc/category_uses_place_catalog';

// Database functions the registration screen calls through POST that only read.
// Re-review whenever a listed function gains side effects.
export const READ_RPCS = new Set(['search_store_catalog_page', 'search_store_catalog', 'search_place_catalog',
  'store_menu_options', 'current_user_is_admin', 'home_pick_feed_page', 'item_review_page',
  'notification_unread_count', 'item_brands', 'search_items']);
// Best-effort telemetry: dropped silently, never a finding and never forwarded.
const TELEMETRY_PATHS = new Set(['/rest/v1/client_error_events', '/rest/v1/rpc/capture_product_event']);

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

/**
 * Request policy. `mode` is 'fail' (menu AI unreachable) or 'success' (fixture answer).
 * Returns one of:
 *   { action: 'continue' }                      forward unchanged (reads only)
 *   { action: 'abort', reason, silent: true }   drop without a finding (telemetry, 3rd-party, AI failure)
 *   { action: 'fulfill', status, json }         answer locally with a fixture
 *   { action: 'abort', reason, fail: CODE }     blocked write: the run fails closed
 * `kind` (closed vocabulary from requestKind) is attached for the report; no URL leaks.
 */
export function createRestoreGuard({ api, site }) {
  need(typeof api === 'string' && typeof site === 'string', 'GUARD_CONFIG_INVALID');
  let mode = 'fail';
  let fixture = null;
  const counts = { aiFailed: 0, aiFixture: 0, placeCatalogFixture: 0, telemetryDropped: 0, externalDropped: 0, blockedWrites: 0 };
  const blocked = [];
  const fail = (code, url) => {
    counts.blockedWrites += 1;
    const kind = requestKind(url, api, site);
    if (blocked.length < 10) blocked.push({ code, kind });
    return { action: 'abort', reason: 'blockedbyclient', fail: code, kind };
  };
  return {
    get mode() { return mode; },
    get counts() { return { ...counts }; },
    get blocked() { return blocked.slice(); },
    get failed() { return counts.blockedWrites > 0; },
    setMode(next, category = null) {
      need(next === 'fail' || next === 'success', 'GUARD_MODE_INVALID');
      fixture = next === 'success' ? aiSuccessFixture(category) : null;
      mode = next;
    },
    decide({ url, method }) {
      let u;
      try { u = new URL(url); } catch { return fail('UNEXPECTED_ORIGIN', 'invalid:'); }
      const read = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
      if (u.origin !== api && u.origin !== site) {
        // Fonts, analytics beacons and the like. Never forwarded, never a finding.
        counts.externalDropped += 1;
        return { action: 'abort', reason: 'blockedbyclient', silent: true };
      }
      if (u.origin === site) return read ? { action: 'continue' } : fail('UNEXPECTED_WRITE', url);
      if (read) return { action: 'continue' };
      if (TELEMETRY_PATHS.has(u.pathname)) {
        counts.telemetryDropped += 1;
        return { action: 'abort', reason: 'blockedbyclient', silent: true };
      }
      if (method === 'POST' && u.pathname === AI_PATH) {
        if (mode === 'success') {
          counts.aiFixture += 1;
          return { action: 'fulfill', status: 200, json: fixture };
        }
        counts.aiFailed += 1;
        return { action: 'abort', reason: 'failed', silent: true };
      }
      if (method === 'POST' && u.pathname === PLACE_CATALOG_RPC) {
        // Read-only SQL in production, but answered locally so the resumed step never
        // depends on catalog/brand rows and never reaches the brand-scope prompt.
        counts.placeCatalogFixture += 1;
        return { action: 'fulfill', status: 200, json: false };
      }
      if (method === 'POST' && u.pathname.startsWith('/rest/v1/rpc/') && READ_RPCS.has(u.pathname.slice('/rest/v1/rpc/'.length))) {
        return { action: 'continue' };
      }
      // Everything else — registration RPCs, table inserts/updates, Storage uploads
      // or deletes, auth changes, unknown functions — fails closed.
      return fail('UNEXPECTED_WRITE', url);
    },
  };
}

// Playwright route handler shared by the live flow and the offline browser test, so
// what is tested is what runs. `onBlocked` receives { code, kind } for a failed write;
// `forward` (default: route.continue()) lets the offline test answer admitted reads locally.
export async function handleRoute(guard, route, { onBlocked = () => {}, forward = (r) => r.continue() } = {}) {
  const request = route.request();
  const verdict = guard.decide({ url: request.url(), method: request.method() });
  if (verdict.action === 'continue') { await forward(route); return verdict; }
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
export function assertReviewDraft(draft, { storeName, userId }) {
  need(draft, 'DRAFT_MISSING');
  need(draft.userId === userId, 'DRAFT_OWNER_MISMATCH');
  need(draft.step === 5, 'DRAFT_STEP_LOST');
  need(draft.review === RESTORE_REVIEW, 'DRAFT_REVIEW_LOST');
  need(draft.menuQuery === RESTORE_MENU, 'DRAFT_MENU_LOST');
  need(!storeName || draft.storeName === storeName, 'DRAFT_STORE_LOST');
  need(draft.photo === 'stored' && draft.photoRecordMatches === true, 'DRAFT_PHOTO_LOST');
}

export function safeRestoreFailureCode(error) {
  const codes = new Set(['EXECUTION_NOT_AUTHORIZED', 'SESSION_EXPIRY_INVALID', 'SESSION_BUDGET_INSUFFICIENT',
    'FIXTURE_CATEGORY_INVALID', 'GUARD_MODE_INVALID', 'GUARD_CONFIG_INVALID', 'UNEXPECTED_WRITE', 'UNEXPECTED_ORIGIN',
    'DRAFT_MISSING', 'DRAFT_OWNER_MISMATCH', 'DRAFT_STEP_LOST', 'DRAFT_REVIEW_LOST', 'DRAFT_MENU_LOST',
    'DRAFT_STORE_LOST', 'DRAFT_PHOTO_LOST', 'DRAFT_PHOTO_NOT_STORED', 'DRAFT_REASSIGN_INVALID',
    'PICK_COUNT_CHANGED', 'MENU_AI_NOT_ATTEMPTED', 'MENU_OPTIONS_NOT_CAPTURED']);
  return codes.has(error?.message) ? error.message : null;
}
