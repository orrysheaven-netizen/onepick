type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

type BrowserLocationLike = {
  origin: string;
  pathname: string;
  search: string;
  hash: string;
  assign: (url: string) => void;
};

type BrowserHistoryLike = {
  replaceState: (data: unknown, unused: string, url?: string | URL | null) => void;
};

type AdminSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

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
  name: string;
  slug: string;
  status: 'draft' | 'open' | 'paused' | 'closed';
  is_visible: boolean;
  is_pickable: boolean;
  sort_order: number;
  ranking_min_sample: number;
  image_url: string | null;
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

export type AdminAuditLog = {
  id: string;
  entity_type: string;
  action: string;
  summary: Record<string, unknown>;
  created_at: string;
};

const SESSION_KEY = 'onepick.admin.session';
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function config() {
  if (!supabaseUrl || !publishableKey) {
    throw new Error('Supabase 환경변수가 없습니다. EXPO_PUBLIC_SUPABASE_URL과 EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 설정해 주세요.');
  }
  return { supabaseUrl, publishableKey };
}

function storage(): StorageLike | null {
  const candidate = (globalThis as unknown as { localStorage?: StorageLike }).localStorage;
  return candidate ?? null;
}

function browserLocation(): BrowserLocationLike | null {
  const candidate = (globalThis as unknown as { location?: BrowserLocationLike }).location;
  return candidate ?? null;
}

function browserHistory(): BrowserHistoryLike | null {
  const candidate = (globalThis as unknown as { history?: BrowserHistoryLike }).history;
  return candidate ?? null;
}

function readSession(): AdminSession | null {
  const value = storage()?.getItem(SESSION_KEY);
  if (!value) return null;
  try {
    return JSON.parse(value) as AdminSession;
  } catch {
    storage()?.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession(payload: { access_token: string; refresh_token: string; expires_in: number }) {
  const session: AdminSession = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
  storage()?.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

function consumeAdminOAuthRedirect() {
  const location = browserLocation();
  if (!location?.hash) return false;

  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const oauthError = params.get('error_description') ?? params.get('error');
  if (oauthError) {
    browserHistory()?.replaceState(null, '', `${location.pathname}${location.search}`);
    throw new Error(oauthError);
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const expiresIn = Number.parseInt(params.get('expires_in') ?? '3600', 10);
  if (!accessToken || !refreshToken) return false;

  saveSession({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: Number.isFinite(expiresIn) ? expiresIn : 3600,
  });
  browserHistory()?.replaceState(null, '', `${location.pathname}${location.search}`);
  return true;
}

async function authRequest(path: string, body: Record<string, unknown>) {
  const current = config();
  const response = await fetch(`${current.supabaseUrl}${path}`, {
    method: 'POST',
    headers: {
      apikey: current.publishableKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.msg === 'string' ? data.msg : typeof data?.message === 'string' ? data.message : '인증 요청에 실패했습니다.';
    throw new Error(message);
  }
  return data as { access_token: string; refresh_token: string; expires_in: number };
}

async function accessToken() {
  let session = readSession();
  if (!session) throw new Error('관리자 로그인이 필요합니다.');
  if (session.expiresAt > Date.now() + 60_000) return session.accessToken;

  const refreshed = await authRequest('/auth/v1/token?grant_type=refresh_token', {
    refresh_token: session.refreshToken,
  });
  session = saveSession(refreshed);
  return session.accessToken;
}

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const current = config();
  const token = await accessToken();
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

export function beginKakaoAdminSignIn() {
  const current = config();
  const location = browserLocation();
  if (!location) throw new Error('카카오 로그인은 웹 브라우저에서 사용할 수 있습니다.');

  const redirectTo = `${location.origin}/admin`;
  const authorizeUrl = new URL(`${current.supabaseUrl}/auth/v1/authorize`);
  authorizeUrl.searchParams.set('provider', 'kakao');
  authorizeUrl.searchParams.set('redirect_to', redirectTo);
  location.assign(authorizeUrl.toString());
}

export function signOutAdmin() {
  storage()?.removeItem(SESSION_KEY);
}

export async function checkAdminSession() {
  consumeAdminOAuthRedirect();
  if (!readSession()) return false;

  try {
    const isAdmin = await adminRequest<boolean>('/rest/v1/rpc/current_user_is_admin', {
      method: 'POST',
      body: '{}',
    });
    if (!isAdmin) {
      signOutAdmin();
      throw new Error('관리자 권한이 없는 카카오 계정입니다.');
    }
    return true;
  } catch (error) {
    signOutAdmin();
    throw error;
  }
}

export function getDashboardMetrics() {
  return adminRequest<AdminDashboardMetrics>('/rest/v1/rpc/admin_dashboard_metrics', {
    method: 'POST',
    body: '{}',
  });
}

export function getAuditLogs(limit = 8) {
  return adminRequest<AdminAuditLog[]>(`/rest/v1/admin_audit_logs?select=id,entity_type,action,summary,created_at&order=created_at.desc&limit=${limit}`);
}

export function getCategories() {
  return adminRequest<AdminCategory[]>('/rest/v1/categories?select=id,name,slug,status,is_visible,is_pickable,sort_order,ranking_min_sample,image_url&order=sort_order.asc,name.asc');
}

export function createCategory(input: { name: string; slug: string }) {
  return adminRequest<AdminCategory[]>('/rest/v1/categories?select=id,name,slug,status,is_visible,is_pickable,sort_order,ranking_min_sample,image_url', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name: input.name,
      slug: input.slug,
      status: 'draft',
      is_visible: false,
      is_pickable: false,
      sort_order: 0,
    }),
  });
}

export function updateCategory(id: string, patch: Partial<Pick<AdminCategory, 'name' | 'status' | 'is_visible' | 'is_pickable' | 'sort_order' | 'ranking_min_sample' | 'image_url'>>) {
  return adminRequest<AdminCategory[]>(`/rest/v1/categories?id=eq.${encodeURIComponent(id)}&select=id,name,slug,status,is_visible,is_pickable,sort_order,ranking_min_sample,image_url`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
}

export function getPendingItems() {
  return adminRequest<PendingItem[]>('/rest/v1/items?select=id,category_id,name,status,created_at,image_path,categories(name)&status=eq.pending&order=created_at.asc');
}

export function updatePendingItem(id: string, status: 'active' | 'rejected') {
  return adminRequest(`/rest/v1/items?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status }),
  });
}
