// Network policy and draft assertions for the #858 draft-restore QA.
// Pure functions only (unit-tested offline); the browser run is draft-restore-qa.mjs.
//
// Goal: walk /pick/new to the 4/4 review step with a photo and review kept as a
// draft, then reload the same web session while menu classification is pending
// or the current-Pick lookup fails, and prove the original step, photo, menu and
// store survive — with ZERO Production writes, no Storage upload and no paid AI call.
export const SITE = 'https://onepick-5cl.pages.dev';
export const API = 'https://ygoipwzakzdnkaaxyrgb.supabase.co';
export const DRAFT_KEY = 'onepick:pick-draft:v1';
export const DRAFT_PHOTO_KEY = 'onepick:pick-draft-photo:v1';
export const MENU_OPTIONS_RPC = '/rest/v1/rpc/store_menu_options';
export const PICKS_TABLE = '/rest/v1/picks';

// Read-only RPCs the registration path may call. Anything else that is not a GET
// is aborted before it reaches Production and recorded; the run then fails.
const READ_RPCS = new Set([
  'store_menu_options', 'current_user_is_admin', 'search_store_catalog', 'search_store_catalog_page',
  'search_online_sellers', 'category_uses_place_catalog', 'notification_unread_count',
  'home_pick_feed_page', 'item_brands', 'search_items', 'item_review_page', 'food_item_recent_ranking',
  'home_editorial_items',
]);
// Client telemetry. Blocked (not a product failure), never counted as a QA write.
const TELEMETRY_RPCS = new Set(['capture_product_event', 'capture_client_error']);

/**
 * Decide what the Playwright route does with a request. Default-deny: the only
 * requests that leave the browser are reads (GET/HEAD/OPTIONS) outside Supabase
 * Functions/Storage, the read-only RPC allowlist, and the one auth call a
 * persisted session needs (refresh_token grant). Everything else is aborted.
 *
 * - 'block-write'     Supabase table/RPC/auth change or any non-read to the site origin → run fails
 * - 'block-function'  Supabase Edge Function, any method (paid AI) → run fails
 * - 'block-storage'   Supabase Storage, any method → run fails
 * - 'block-external'  non-read request to a third-party origin (beacons, embeds) → blocked, reported, not a Production write
 * - 'block-telemetry' capture_* RPCs → blocked, reported
 * @returns {'allow'|'block-telemetry'|'block-write'|'block-function'|'block-storage'|'block-external'}
 */
export function classifyRequest(url, method) {
  let u;
  try { u = new URL(url); } catch { return 'block-write'; }
  const verb = String(method || 'GET').toUpperCase();
  const isRead = verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS';
  if (u.origin === API) {
    // Paths checked before the method: a GET to an Edge Function still runs it.
    if (u.pathname.startsWith('/functions/v1/')) return 'block-function';
    if (u.pathname.startsWith('/storage/v1/')) return 'block-storage';
    if (u.pathname.startsWith('/auth/v1/')) {
      if (isRead) return 'allow'; // /auth/v1/user
      if (verb === 'POST' && u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') return 'allow';
      return 'block-write'; // signup, password grant, user update, logout: the browser never needs these here
    }
    if (isRead) return 'allow';
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const rpc = u.pathname.slice('/rest/v1/rpc/'.length);
      if (TELEMETRY_RPCS.has(rpc)) return 'block-telemetry';
      if (verb === 'POST' && READ_RPCS.has(rpc)) return 'allow';
      return 'block-write';
    }
    return 'block-write'; // table insert/update/delete
  }
  if (isRead) return 'allow'; // site assets, fonts, third-party images
  if (u.origin === SITE) return 'block-write'; // no same-site non-read is expected
  return 'block-external';
}

export function isMenuOptionsRequest(url) {
  try { const u = new URL(url); return u.origin === API && u.pathname === MENU_OPTIONS_RPC; } catch { return false; }
}

export function isCurrentPickSlotRead(url, method = 'GET') {
  try {
    const u = new URL(url);
    return u.origin === API && u.pathname === PICKS_TABLE && String(method).toUpperCase() === 'GET'
      && u.searchParams.has('category_id') && u.searchParams.has('user_id');
  } catch { return false; }
}

/**
 * Parse the sessionStorage draft record the web app writes and return the facts
 * this QA asserts. Throws with a closed code when the record is unusable.
 */
export function readDraftFacts(rawRecord, userId) {
  if (typeof rawRecord !== 'string' || !rawRecord) throw new Error('DRAFT_MISSING');
  let record;
  try { record = JSON.parse(rawRecord); } catch { throw new Error('DRAFT_INVALID'); }
  if (!record || record.v !== 1 || !record.fields || typeof record.fields !== 'object') throw new Error('DRAFT_INVALID');
  if (record.userId !== userId) throw new Error('DRAFT_OWNER_MISMATCH');
  const f = record.fields;
  return {
    step: f.step,
    review: typeof f.review === 'string' ? f.review : '',
    menuQuery: typeof f.menuQuery === 'string' ? f.menuQuery : '',
    storeName: f.store && typeof f.store === 'object' ? f.store.name ?? null : null,
    storeKind: f.store && typeof f.store === 'object' ? f.store.kind ?? null : null,
    photo: record.photo ?? 'none',
  };
}

/** The draft must still point at the review step with every input intact. */
export function assertReviewDraftKept(facts, { review, menu, store }) {
  if (facts.step !== 5) throw new Error('DRAFT_STEP_LOST');
  if (facts.review !== review) throw new Error('DRAFT_REVIEW_LOST');
  if (facts.menuQuery !== menu) throw new Error('DRAFT_MENU_LOST');
  if (facts.storeName !== store || facts.storeKind !== 'new') throw new Error('DRAFT_STORE_LOST');
  if (facts.photo !== 'stored') throw new Error('DRAFT_PHOTO_LOST');
  return true;
}

export const FAILURE_CODES = new Set([
  'EXECUTION_NOT_AUTHORIZED', 'DEPLOYMENT_NOT_CURRENT', 'PUBLIC_KEY_NOT_FOUND', 'AUTH_FAILED', 'IDENTITY_MISMATCH',
  'GENERAL_USER_REQUIRED', 'DRAFT_MISSING', 'DRAFT_INVALID', 'DRAFT_OWNER_MISMATCH', 'DRAFT_STEP_LOST',
  'DRAFT_REVIEW_LOST', 'DRAFT_MENU_LOST', 'DRAFT_STORE_LOST', 'DRAFT_PHOTO_LOST', 'UNEXPECTED_WRITE_ATTEMPT',
  'PICK_COUNT_CHANGED', 'STEP_NOT_REACHED', 'RESTORE_TOO_EARLY', 'RESTORE_FAILED', 'RETRY_FAILED',
  'LOGOUT_ISOLATION_FAILED',
]);
export function safeFailureCode(error) {
  return FAILURE_CODES.has(error?.message) ? error.message : 'UNCLASSIFIED_FAILURE';
}

export function assertExecution(env) {
  const ok = env.GITHUB_EVENT_NAME === 'workflow_dispatch'
    && env.GITHUB_REF === 'refs/heads/main'
    && env.GITHUB_REPOSITORY === 'orrysheaven-netizen/onepick'
    && env.GITHUB_RUN_ATTEMPT === '1'
    && Boolean(env.ONEPICK_QA_EMAIL) && Boolean(env.ONEPICK_QA_PASSWORD);
  if (!ok) throw new Error('EXECUTION_NOT_AUTHORIZED');
}
