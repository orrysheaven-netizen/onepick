import { supabase } from '@/lib/supabase/client';
import { canonicalItemName } from '@/lib/items/itemIdentity';
import { getAdminAccessToken } from '@/lib/admin/adminSession';

type BrowserLocationLike = {
  origin: string;
  pathname: string;
  search: string;
  hash: string;
};

type BrowserHistoryLike = {
  replaceState: (data: unknown, unused: string, url?: string | URL | null) => void;
};

export type AdminSessionStatus = 'signed-out' | 'needs-mfa' | 'signed-in';

export type AdminDashboardMetrics = {
  users_total: number;
  categories_total: number;
  categories_open: number;
  items_total: number;
  items_pending: number;
  items_active: number;
  picks_total: number;
  picks_active: number;
  reports_open: number;
};

export type AdminCategory = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  status: 'draft' | 'open' | 'paused' | 'closed';
  is_visible: boolean;
  is_pickable: boolean;
  sort_order: number;
  ranking_min_sample: number;
  image_url: string | null;
};

export type AdminBrand = {
  id: string;
  name: string;
  normalized_name: string;
  slug: string | null;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AdminItemStatus = 'pending' | 'active' | 'discontinued' | 'hidden' | 'merged' | 'rejected';

export type AdminItem = {
  id: string;
  category_id: string;
  name: string;
  model_code: string | null;
  official_url: string | null;
  status: AdminItemStatus;
  created_at: string;
  updated_at: string;
  image_path: string | null;
  thumbnail_path?: string | null;
  image_source_url?: string | null;
  categories: { name: string } | null;
};

export type AdminEditorialFeature = {
  item_id: string;
  priority: number;
  note: string | null;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AdminEditorialFeatureWithItem = AdminEditorialFeature & {
  items: {
    id: string;
    name: string;
    status: AdminItemStatus;
    category_id: string;
    image_path: string | null;
    thumbnail_path: string | null;
    image_source_url: string | null;
    categories: { name: string } | null;
  } | null;
};

export type AdminItemAlias = {
  id: string;
  item_id: string;
  alias: string;
  normalized_alias: string;
  created_at: string;
  updated_at: string;
};

export type PendingItem = {
  id: string;
  category_id: string;
  name: string;
  status: 'pending';
  created_at: string;
  image_path: string | null;
  categories: { name: string } | null;
};

export type AdminReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

export type AdminReport = {
  id: string;
  target_type: 'profile' | 'pick' | 'comment';
  target_id: string;
  target_user_id: string | null;
  reason: 'spam' | 'harassment' | 'inappropriate' | 'misleading' | 'other';
  details: string | null;
  status: AdminReportStatus;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export type AdminAuditLog = {
  id: string;
  entity_type: string;
  action: string;
  summary: Record<string, unknown>;
  created_at: string;
};

export type AdminClientErrorEvent = {
  id: string;
  context: string;
  error_code: string;
  platform: string | null;
  app_version: string | null;
  created_at: string;
};

// Shape of public.admin_onepick_dashboard(). Every user-activity number here
// already excludes demo_* profiles and admin-allowlisted accounts.
export type AdminOnePickDashboardWindow = 7 | 30 | 90;

export type AdminOnePickDashboard = {
  days: number;
  generated_at: string;
  excluded: { demo_users: number; admin_users: number };
  totals: {
    users: number;
    active_picks: number;
    picks_total: number;
    comments: number;
    open_categories: number;
    active_items: number;
  };
  recent: {
    users_7d: number;
    users_30d: number;
    picks_7d: number;
    picks_30d: number;
    comments_7d: number;
    comments_30d: number;
    active_users_7d: number;
    active_users_30d: number;
  };
  queue: { pending_items: number; open_reports: number; suspended_users: number };
  daily: Array<{ day: string; users: number; picks: number; comments: number }>;
  categories: Array<{ id: string; name: string; slug: string; active_picks: number; pickers: number; picks_in_window: number }>;
  top_items: Array<{ id: string; name: string; category_name: string; active_picks: number }>;
  funnel: {
    pick_created: number;
    pick_share_clicked: number;
    pick_link_opened: number;
    item_detail_viewed: number;
    auth_started: number;
    auth_completed: number;
  };
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function config() {
  if (!supabaseUrl || !publishableKey) {
    throw new Error('Supabase 환경변수가 없습니다. EXPO_PUBLIC_SUPABASE_URL과 EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 설정해 주세요.');
  }
  return { supabaseUrl, publishableKey };
}

function browserLocation(): BrowserLocationLike | null {
  const candidate = (globalThis as unknown as { location?: BrowserLocationLike }).location;
  return candidate ?? null;
}

function browserHistory(): BrowserHistoryLike | null {
  const candidate = (globalThis as unknown as { history?: BrowserHistoryLike }).history;
  return candidate ?? null;
}

// The admin panel used to keep its own OAuth tokens in localStorage, separate
// from the shared `supabase` client's session. That split meant a step-up MFA
// check on one session said nothing about the other -- an admin could clear
// AAL2 on the shared client (via admin-security.tsx) while this panel kept
// using an old, never-elevated access token, or vice versa. The shared
// `supabase` client is now the only session: OAuth completion, the allowlist
// check, the AAL check and every admin request all read from it.
async function completeAdminOAuthRedirect() {
  const location = browserLocation();
  if (!location || (!location.hash && !location.search)) return;

  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(location.search.replace(/^\?/, ''));
  const oauthError = hashParams.get('error_description') ?? hashParams.get('error')
    ?? queryParams.get('error_description') ?? queryParams.get('error');
  if (oauthError) {
    browserHistory()?.replaceState(null, '', location.pathname);
    throw new Error(oauthError);
  }

  const code = queryParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    browserHistory()?.replaceState(null, '', location.pathname);
    if (error) throw new Error(error.message || '로그인을 완료하지 못했습니다.');
    return;
  }

  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  if (!accessToken || !refreshToken) return;

  const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  browserHistory()?.replaceState(null, '', location.pathname);
  if (error) throw new Error(error.message || '로그인을 완료하지 못했습니다.');
}

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const current = config();
  const token = await getAdminAccessToken();
  const response = await fetch(`${current.supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: current.publishableKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.message === 'string' ? data.message : typeof data?.hint === 'string' ? data.hint : '관리자 요청에 실패했습니다.';
    throw new Error(message);
  }
  return data as T;
}

export async function beginKakaoAdminSignIn() {
  const location = browserLocation();
  if (!location) throw new Error('카카오 로그인은 웹 브라우저에서 사용할 수 있습니다.');

  const redirectTo = `${location.origin}/admin`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'kakao',
    options: {
      redirectTo,
      // `scopes` adds to Supabase's Kakao defaults; the provider's `scope`
      // parameter replaces them so email and profile photos are not requested.
      queryParams: { scope: 'profile_nickname' },
    },
  });
  if (error) throw new Error(error.message || '카카오 로그인을 시작하지 못했습니다.');
}

export async function signOutAdmin() {
  await supabase.auth.signOut({ scope: 'local' });
}

export async function checkAdminSession(): Promise<AdminSessionStatus> {
  await completeAdminOAuthRedirect();

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return 'signed-out';

  const { data: isAdmin, error: adminError } = await supabase.rpc('current_user_is_admin');
  if (adminError || isAdmin !== true) {
    await signOutAdmin();
    throw new Error(adminError ? '관리자 권한을 확인하지 못했습니다.' : '관리자 권한이 없는 카카오 계정입니다.');
  }

  // Membership alone does not open the dashboard: a stepped-up (AAL2) session
  // is required for real admin data access (see the AAL2 RLS/RPC gate), so an
  // allowlisted admin who has not completed MFA is sent to the challenge
  // screen instead of being signed out -- they need the session alive to get
  // there.
  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw new Error('추가 인증 상태를 확인하지 못했습니다.');

  return assurance.currentLevel === 'aal2' ? 'signed-in' : 'needs-mfa';
}

export function getDashboardMetrics() {
  return adminRequest<AdminDashboardMetrics>('/rest/v1/rpc/admin_dashboard_metrics', {
    method: 'POST',
    body: '{}',
  });
}

export function getOnePickDashboard(days: AdminOnePickDashboardWindow = 30) {
  return adminRequest<AdminOnePickDashboard>('/rest/v1/rpc/admin_onepick_dashboard', {
    method: 'POST',
    body: JSON.stringify({ p_days: days }),
  });
}

export function getAuditLogs(limit = 8, offset = 0) {
  return adminRequest<AdminAuditLog[]>(`/rest/v1/admin_audit_logs?select=id,entity_type,action,summary,created_at&order=created_at.desc&limit=${Math.min(Math.max(limit, 1), 100)}&offset=${offset}`);
}

export function getClientErrorEvents(limit = 30) {
  return adminRequest<AdminClientErrorEvent[]>(`/rest/v1/client_error_events?select=id,context,error_code,platform,app_version,created_at&order=created_at.desc&limit=${Math.min(Math.max(limit, 1), 200)}`);
}

export function getCategories() {
  return adminRequest<AdminCategory[]>('/rest/v1/categories?select=id,parent_id,name,slug,status,is_visible,is_pickable,sort_order,ranking_min_sample,image_url&order=sort_order.asc,name.asc');
}

export function createCategory(input: { name: string; slug: string; parentId?: string | null }) {
  return adminRequest<AdminCategory[]>('/rest/v1/categories?select=id,parent_id,name,slug,status,is_visible,is_pickable,sort_order,ranking_min_sample,image_url', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name: input.name,
      slug: input.slug,
      parent_id: input.parentId ?? null,
      status: 'draft',
      is_visible: false,
      is_pickable: false,
      sort_order: 0,
    }),
  });
}

export function updateCategory(id: string, patch: Partial<Pick<AdminCategory, 'name' | 'parent_id' | 'status' | 'is_visible' | 'is_pickable' | 'sort_order' | 'ranking_min_sample' | 'image_url'>>) {
  return adminRequest<AdminCategory[]>(`/rest/v1/categories?id=eq.${encodeURIComponent(id)}&select=id,parent_id,name,slug,status,is_visible,is_pickable,sort_order,ranking_min_sample,image_url`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
}

export function getBrands() {
  return adminRequest<AdminBrand[]>('/rest/v1/brands?select=id,name,normalized_name,slug,logo_url,is_active,created_at,updated_at&order=name.asc');
}

function cleanName(value: string, max: number) {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > max) throw new Error(`이름을 1자 이상 ${max}자 이하로 입력해 주세요.`);
  return name;
}

export function createBrand(input: { name: string; slug?: string | null }) {
  const name = cleanName(input.name, 80);
  return adminRequest<AdminBrand[]>('/rest/v1/brands?select=id,name,normalized_name,slug,logo_url,is_active,created_at,updated_at', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name,
      normalized_name: name.toLowerCase().replace(/\s+/g, ''),
      slug: input.slug?.trim().toLowerCase() || null,
      is_active: true,
    }),
  });
}

export function updateBrand(id: string, patch: { is_active?: boolean }) {
  return adminRequest<AdminBrand[]>(`/rest/v1/brands?id=eq.${encodeURIComponent(id)}&select=id,name,normalized_name,slug,logo_url,is_active,created_at,updated_at`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
}

export const ADMIN_PAGE_SIZE = 100;

export function getItems(input: { query?: string; status?: AdminItemStatus | 'all'; offset?: number } = {}) {
  const params = new URLSearchParams({
    select: 'id,category_id,name,model_code,official_url,status,created_at,updated_at,image_path,thumbnail_path,image_source_url,categories(name)',
    order: 'updated_at.desc',
    limit: String(ADMIN_PAGE_SIZE),
    offset: String(input.offset ?? 0),
  });
  const query = input.query?.trim();
  if (query) params.set('name', `ilike.*${query}*`);
  if (input.status && input.status !== 'all') params.set('status', `eq.${input.status}`);
  return adminRequest<AdminItem[]>(`/rest/v1/items?${params.toString()}`);
}

export function createItem(input: { categoryId: string; categorySlug: string; name: string; brandId?: string | null; officialUrl?: string | null }) {
  const name = canonicalItemName(cleanName(input.name, 100), input.categorySlug);
  return adminRequest<AdminItem[]>('/rest/v1/items?select=id,category_id,name,model_code,official_url,status,created_at,updated_at,image_path,categories(name)', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      category_id: input.categoryId,
      brand_id: input.brandId ?? null,
      name,
      normalized_name: name.toLowerCase().replace(/\s+/g, ''),
      official_url: input.officialUrl?.trim() || null,
      status: 'active',
    }),
  });
}

export function updateItem(id: string, patch: Partial<Pick<AdminItem, 'status' | 'model_code' | 'official_url'>>) {
  return adminRequest<AdminItem[]>(`/rest/v1/items?id=eq.${encodeURIComponent(id)}&select=id,category_id,name,model_code,official_url,status,created_at,updated_at,image_path,categories(name)`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
}

export function getEditorialFeatures() {
  return adminRequest<AdminEditorialFeatureWithItem[]>(
    '/rest/v1/item_editorial_features?select=item_id,priority,note,starts_at,ends_at,is_active,created_at,updated_at,items(id,name,status,category_id,image_path,thumbnail_path,image_source_url,categories(name))&order=priority.asc,updated_at.desc'
  );
}

export function getEditorialCandidates(query: string) {
  const params = new URLSearchParams({
    select: 'id,category_id,name,model_code,official_url,status,created_at,updated_at,image_path,thumbnail_path,image_source_url,categories(name)',
    or: '(status.eq.active,status.eq.discontinued)',
    order: 'updated_at.desc',
    limit: '20',
  });
  const keyword = query.trim();
  if (keyword) params.set('name', `ilike.*${keyword}*`);
  return adminRequest<AdminItem[]>(`/rest/v1/items?${params.toString()}`);
}

export function getItemEditorialFeature(itemId: string) {
  return adminRequest<AdminEditorialFeature[]>(
    `/rest/v1/item_editorial_features?select=item_id,priority,note,starts_at,ends_at,is_active,created_at,updated_at&item_id=eq.${encodeURIComponent(itemId)}&limit=1`
  );
}

export function setItemEditorialFeature(input: {
  itemId: string;
  isActive: boolean;
  priority: number;
  note?: string | null;
  startsAt?: string;
  endsAt?: string | null;
}) {
  return adminRequest<AdminEditorialFeature>('/rest/v1/rpc/admin_set_item_editorial_feature', {
    method: 'POST',
    body: JSON.stringify({
      p_item_id: input.itemId,
      p_is_active: input.isActive,
      p_priority: input.priority,
      p_note: input.note?.trim() || null,
      ...(input.startsAt ? { p_starts_at: input.startsAt } : {}),
      ...(input.endsAt !== undefined ? { p_ends_at: input.endsAt } : {}),
    }),
  });
}

export function getItemAliases(itemId: string) {
  return adminRequest<AdminItemAlias[]>(`/rest/v1/item_aliases?select=id,item_id,alias,normalized_alias,created_at,updated_at&item_id=eq.${encodeURIComponent(itemId)}&order=alias.asc`);
}

export function createItemAlias(itemId: string, alias: string) {
  return adminRequest<AdminItemAlias[]>('/rest/v1/item_aliases?select=id,item_id,alias,normalized_alias,created_at,updated_at', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ item_id: itemId, alias }),
  });
}

export function updateItemAlias(id: string, alias: string) {
  return adminRequest<AdminItemAlias[]>(`/rest/v1/item_aliases?id=eq.${encodeURIComponent(id)}&select=id,item_id,alias,normalized_alias,created_at,updated_at`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ alias }),
  });
}

export function deleteItemAlias(id: string) {
  return adminRequest(`/rest/v1/item_aliases?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}

export function getPendingItems(offset = 0) {
  return adminRequest<PendingItem[]>(`/rest/v1/items?select=id,category_id,name,status,created_at,image_path,categories(name)&status=eq.pending&order=created_at.asc&limit=${ADMIN_PAGE_SIZE}&offset=${offset}`);
}

export function updatePendingItem(id: string, status: 'active' | 'rejected') {
  return adminRequest(`/rest/v1/items?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status }),
  });
}

export function getMergeCandidates(query: string, categoryId: string) {
  const params = new URLSearchParams({
    select: 'id,category_id,name,model_code,official_url,status,created_at,updated_at,image_path,categories(name)',
    category_id: `eq.${categoryId}`,
    or: '(status.eq.active,status.eq.discontinued)',
    order: 'updated_at.desc',
    limit: '8',
  });
  const keyword = query.trim();
  if (keyword) params.set('name', `ilike.*${keyword}*`);
  return adminRequest<AdminItem[]>(`/rest/v1/items?${params.toString()}`);
}

export function mergePendingItem(sourceItemId: string, targetItemId: string) {
  return adminRequest<AdminItem>('/rest/v1/rpc/admin_merge_pending_item', {
    method: 'POST',
    body: JSON.stringify({ p_source_item_id: sourceItemId, p_target_item_id: targetItemId }),
  });
}

export function getReports(status: AdminReportStatus | 'all' = 'all', offset = 0) {
  const params = new URLSearchParams({
    select: 'id,target_type,target_id,target_user_id,reason,details,status,created_at,updated_at,resolved_at',
    order: 'created_at.desc',
    limit: String(ADMIN_PAGE_SIZE),
    offset: String(offset),
  });
  if (status !== 'all') params.set('status', `eq.${status}`);
  return adminRequest<AdminReport[]>(`/rest/v1/content_reports?${params.toString()}`);
}

export function updateReportStatus(id: string, status: AdminReportStatus) {
  return adminRequest<AdminReport[]>(`/rest/v1/content_reports?id=eq.${encodeURIComponent(id)}&select=id,target_type,target_id,target_user_id,reason,details,status,created_at,updated_at,resolved_at`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status }),
  });
}

