// Fixed, visibly synthetic fixture. No real business or member data is edited.
export const SITE = 'https://onepick-5cl.pages.dev';
export const API = 'https://ygoipwzakzdnkaaxyrgb.supabase.co';
export const STORE = '원픽 QA 등록 검증 전용 매장';
export const MAP = `https://map.naver.com/p/search/${encodeURIComponent(STORE)}`;
export const MENU = '도가니탕';
export const REVIEW = 'QA 테스트 등록이에요. 실제 방문 후기가 아니에요.';
export const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
export function requireCondition(ok, code) { if (!ok) throw new Error(code); }

// The job is capped at 10 minutes. Keep another 5 minutes clear of the client's
// refresh window; do not broaden the network guard to admit token refreshes.
export function assertSessionBudget(session, nowSeconds = Date.now() / 1000) {
  let exp;
  try { exp = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString()).exp; }
  catch { throw new Error('SESSION_EXPIRY_INVALID'); }
  requireCondition(Number.isFinite(exp) && Number.isFinite(session.expires_at)
    && Number.isFinite(nowSeconds)
    && Math.min(exp, session.expires_at) - nowSeconds >= 15 * 60, 'SESSION_BUDGET_INSUFFICIENT');
}

export function assertExecution(env) {
  const mode = env.QA_REGISTRATION_MODE ?? 'register';
  requireCondition(['register', 'verify_existing'].includes(mode), 'EXECUTION_NOT_AUTHORIZED');
  requireCondition(env.GITHUB_EVENT_NAME === 'workflow_dispatch'
    && env.GITHUB_REF === 'refs/heads/main'
    && env.GITHUB_REPOSITORY === 'orrysheaven-netizen/onepick'
    && (mode === 'verify_existing' || env.CONFIRM_QA_REGISTRATION === 'true')
    && env.GITHUB_RUN_ATTEMPT === '1'
    && env.ONEPICK_QA_EMAIL && env.ONEPICK_QA_PASSWORD, 'EXECUTION_NOT_AUTHORIZED');
}

// Only two write RPCs and one full/thumbnail pair are admitted. A failed or
// ambiguous response is never retried automatically. Unknown writes fail closed.
export function createWriteGuard(userId, categoryId, { readOnly = false, existingItemId = null } = {}) {
  requireCondition(uuid(userId) && uuid(categoryId)
    && (existingItemId === null || (readOnly && uuid(existingItemId))), 'INVALID_ID');
  let staged = null, stageAttempted = false, registerAttempted = false, armed = false;
  let uploadStem = null;
  const uploads = new Set();
  const successfulUploads = new Set();
  // Re-review this allowlist whenever a listed database function gains side effects.
  const readRpcs = new Set(['search_store_catalog_page', 'current_user_is_admin',
    'home_pick_feed_page', 'item_review_page', 'notification_unread_count',
    'item_brands', 'search_items', 'store_menu_options']);
  const only = (body, keys) => body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every(key => keys.includes(key));
  return {
    arm() { requireCondition(!readOnly, 'READ_ONLY_MODE'); armed = true; },
    get staged() { return staged; },
    get uploads() { return [...successfulUploads]; },
    admit({ url, method, body, headers = {}, bytes = 0 }) {
      const u = new URL(url);
      requireCondition(u.origin === API || u.origin === SITE, 'UNEXPECTED_ORIGIN');
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return 'read';
      requireCondition(u.origin === API, 'UNEXPECTED_WRITE');
      const rpc = u.pathname.replace('/rest/v1/rpc/', '');
      if (method === 'POST' && readRpcs.has(rpc)) return 'read';
      // SQL SELECT, stable/security invoker (20260918115546); the app requests
      // attribution on detail load. Limit this exception to the verified fixture
      // or this run's staged item, never arbitrary items or extra RPC arguments.
      if (method === 'POST' && u.pathname === '/rest/v1/rpc/item_photo_credit') {
        const target = readOnly ? existingItemId : staged?.id;
        requireCondition(uuid(target) && only(body, ['p_item_id'])
          && body.p_item_id === target, 'PHOTO_CREDIT_NOT_ALLOWED');
        return 'read';
      }
      // App cleanup is best-effort. Suppress it rather than remove older QA files
      // or this run's evidence. Never fabricate a successful deletion response.
      if (u.pathname.startsWith('/storage/v1/object/') &&
          (method === 'DELETE' || u.pathname === '/storage/v1/object/list/item-photos')) return 'block-cleanup';
      requireCondition(armed && method === 'POST', 'UNEXPECTED_WRITE');
      if (u.pathname === '/rest/v1/rpc/stage_user_place_item') {
        requireCondition(!stageAttempted && only(body, ['p_category_id', 'p_name', 'p_road_address', 'p_map_url', 'p_branch_name'])
          && body.p_category_id === categoryId && body.p_name === STORE
          && body.p_map_url === MAP && body.p_road_address === '' && !body.p_branch_name, 'STAGE_NOT_ALLOWED');
        stageAttempted = true;
        return 'stage';
      }
      const prefix = `/storage/v1/object/item-photos/${userId}/`;
      if (u.pathname.startsWith(prefix)) {
        const file = u.pathname.slice(prefix.length);
        const match = file.match(/^([a-z0-9-]+?)(-thumb)?\.jpg$/);
        requireCondition(staged && match && uploads.size < 2 && !uploads.has(file)
          && (!uploadStem || uploadStem === match[1]) && bytes > 0 && bytes <= 2_000_000
          && headers['content-type'] === 'image/jpeg' && headers['x-upsert'] !== 'true', 'UPLOAD_NOT_ALLOWED');
        uploadStem = match[1]; uploads.add(file);
        return 'upload';
      }
      if (u.pathname === '/rest/v1/rpc/register_item_pick') {
        requireCondition(staged && !registerAttempted && successfulUploads.size === 2
          && only(body, ['p_category_id', 'p_channel', 'p_one_line_review', 'p_item_id',
            'p_image_path', 'p_thumbnail_path', 'p_expected_previous_pick_id', 'p_request_id'])
          && body.p_category_id === categoryId && body.p_channel === 'offline'
          && body.p_one_line_review === REVIEW && body.p_item_id === staged.id
          && body.p_expected_previous_pick_id === null && uuid(body.p_request_id)
          && body.p_image_path === `${userId}/${uploadStem}.jpg`
          && body.p_thumbnail_path === `${userId}/${uploadStem}-thumb.jpg`, 'REGISTER_NOT_ALLOWED');
        registerAttempted = true;
        return 'register';
      }
      throw new Error('UNEXPECTED_WRITE');
    },
    acceptStage(row) {
      requireCondition(stageAttempted && row && uuid(row.id) && row.created_by === userId
        && row.category_id === categoryId && row.name === STORE && row.status === 'pending'
        && !row.image_path && !row.thumbnail_path, 'STAGE_RESPONSE_INVALID');
      staged = row;
    },
    acceptUpload(url) {
      const file = new URL(url).pathname.split('/').at(-1);
      requireCondition(uploads.has(file), 'UPLOAD_RESPONSE_INVALID');
      successfulUploads.add(file);
    },
    acceptRegistration(row) {
      requireCondition(registerAttempted && row && row.item_id === staged.id && uuid(row.pick_id)
        && row.published === false && row.retried === false && row.replaced_pick_id == null,
      'REGISTER_RESPONSE_INVALID');
      return row;
    },
  };
}

export async function enterRegistration(page, imageBuffer, beforeSubmit, timeout = 30_000) {
  page.setDefaultTimeout(timeout);
  await page.goto(`${SITE}/pick/new`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'URL 없음', exact: true }).click();
  await page.getByRole('button', { name: '찾는 매장이 없어요.', exact: true }).click();
  await page.getByRole('textbox', { name: '등록 요청 이름', exact: true }).fill(STORE);
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('textbox', { name: '네이버 지도 링크', exact: true }).fill(MAP);
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('textbox', { name: '메뉴 이름', exact: true }).fill(MENU);
  await page.getByText('메뉴를 확인했어요. 다음으로 넘어가주세요.', { exact: true }).waitFor();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByText(/^3 \/ 4/).waitFor();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '사진 고르기', exact: true }).click();
  await (await chooser).setFiles({ name: 'onepick-qa-test.png', mimeType: 'image/png', buffer: imageBuffer });
  await page.getByRole('img', { name: '선택한 대표 이미지 미리보기', exact: true }).waitFor();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('textbox', { name: '원픽 한줄평', exact: true }).fill(REVIEW);
  await beforeSubmit();
  await page.getByRole('button', { name: '원픽 등록하기', exact: true }).click();
}

// Raw picks rows use status + ended_at; isCurrent is an application projection.
export const PICK_COLUMNS = 'id,item_id,category_id,channel,one_line_review,ended_at,status';
export function assertStoredFixture(rows, items, userId, categoryId, expected = null) {
  requireCondition(Array.isArray(rows) && rows.length === 1, 'PICK_COUNT_MISMATCH');
  const pick = rows[0];
  requireCondition(uuid(pick.id) && uuid(pick.item_id) && pick.category_id === categoryId
    && pick.channel === 'offline' && pick.one_line_review === REVIEW
    && pick.ended_at === null && pick.status === 'needs_review'
    && (!expected || (pick.id === expected.pick_id && pick.item_id === expected.item_id)),
  'PICK_PERSISTENCE_FAILED');
  requireCondition(Array.isArray(items) && items.length === 1, 'ITEM_COUNT_MISMATCH');
  const item = items[0];
  requireCondition(item.id === pick.item_id && item.name === STORE && item.created_by === userId
    && item.status === 'pending', 'ITEM_PERSISTENCE_FAILED');
  const prefix = `${userId}/`;
  const image = item.image_path?.startsWith(prefix) ? item.image_path.slice(prefix.length) : '';
  const match = image.match(/^([a-z0-9-]+)\.jpg$/);
  requireCondition(match && item.thumbnail_path === `${prefix}${match[1]}-thumb.jpg`, 'PHOTO_PERSISTENCE_FAILED');
  return { pick_id: pick.id, item_id: item.id, image_path: item.image_path, thumbnail_path: item.thumbnail_path };
}

// Enumerated codes only: never print arbitrary exception messages or responses.
export function safeFailureCode(error) {
  const codes = new Set(['EXECUTION_NOT_AUTHORIZED', 'SESSION_EXPIRY_INVALID', 'SESSION_BUDGET_INSUFFICIENT',
    'API_REQUEST_FAILED', 'DEPLOYMENT_NOT_CURRENT', 'PUBLIC_KEY_NOT_FOUND', 'AUTH_FAILED',
    'IDENTITY_MISMATCH', 'GENERAL_USER_REQUIRED', 'QA_ACCOUNT_ALREADY_HAS_PICKS', 'CATEGORY_AMBIGUOUS',
    'READ_PREFLIGHT_FAILED', 'REGISTRATION_NOT_VERIFIED', 'PICK_COUNT_MISMATCH', 'ITEM_COUNT_MISMATCH',
    'PICK_PERSISTENCE_FAILED', 'ITEM_PERSISTENCE_FAILED', 'PHOTO_PERSISTENCE_FAILED', 'UNEXPECTED_REQUEST',
    'READ_ONLY_MODE', 'INVALID_ID', 'WRITE_REQUEST_FAILED', 'UNEXPECTED_ORIGIN', 'UNEXPECTED_WRITE',
    'PHOTO_CREDIT_NOT_ALLOWED']);
  return codes.has(error?.message) ? error.message : 'UNCLASSIFIED_FAILURE';
}

// Closed diagnostic vocabulary. Never return any part of the supplied URL.
export function safeRequestKind(url) {
  let u;
  try { u = new URL(url); } catch { return 'INVALID_URL'; }
  if (u.origin === SITE) return 'SITE_REQUEST';
  if (u.origin !== API) return 'OUTSIDE_ORIGIN';
  if (u.pathname === '/rest/v1/rpc/item_photo_credit') return 'PHOTO_CREDIT_RPC';
  if (u.pathname.startsWith('/rest/v1/rpc/')) return 'OTHER_RPC';
  if (u.pathname.startsWith('/auth/v1/')) return 'AUTH_REQUEST';
  if (u.pathname.startsWith('/storage/v1/')) return 'STORAGE_REQUEST';
  if (u.pathname.startsWith('/rest/v1/')) return 'TABLE_REQUEST';
  return 'OTHER_API_REQUEST';
}

