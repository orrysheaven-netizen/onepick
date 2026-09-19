import { getAdminAccessToken } from '@/lib/admin/adminSession';

export type UserModerationStatus = 'active' | 'suspended';

export type ModeratedAdminUser = {
  id: string;
  username: string;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
  moderation_status: UserModerationStatus;
  suspension_reason: string | null;
  suspended_at: string | null;
  is_admin: boolean;
};

export type UserModeration = {
  user_id: string;
  status: UserModerationStatus;
  reason: string | null;
  suspended_at: string | null;
  is_admin: boolean;
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function config() {
  if (!supabaseUrl || !publishableKey) {
    throw new Error('Supabase 환경변수가 없습니다.');
  }
  return { supabaseUrl, publishableKey };
}

async function adminRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const current = config();
  // getAdminAccessToken() reads the shared `supabase` client's session (see
  // lib/admin/adminSession.ts), the same session admin-security.tsx steps up
  // to AAL2. This used to keep its own OAuth tokens in a separate localStorage
  // key that nothing ever populated, so every call here failed immediately
  // with "로그인이 필요합니다." regardless of the admin's real session state.
  const token = await getAdminAccessToken();
  const response = await fetch(`${current.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: current.publishableKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = typeof data?.message === 'string' ? data.message : '사용자 제재 요청에 실패했습니다.';
    throw new Error(errorMessage(raw));
  }
  return data as T;
}

function errorMessage(raw: string) {
  if (raw.includes('ADMIN_CANNOT_BE_SUSPENDED')) return '관리자 계정은 정지할 수 없습니다.';
  if (raw.includes('SUSPENSION_REASON_REQUIRED')) return '정지 사유를 입력해 주세요. (최대 500자)';
  if (raw.includes('USER_NOT_FOUND')) return '사용자를 찾을 수 없습니다.';
  if (raw.includes('ADMIN_REQUIRED')) return '관리자 권한이 필요합니다.';
  return raw;
}

export function getModeratedUsers(query = '') {
  return adminRpc<ModeratedAdminUser[]>('admin_users', { p_query: query });
}

export function getUserModeration(userId: string) {
  return adminRpc<UserModeration>('admin_user_moderation', { p_user_id: userId });
}

export function setUserSuspension(userId: string, suspended: boolean, reason?: string) {
  return adminRpc<UserModeration>('admin_set_user_suspension', {
    p_user_id: userId,
    p_suspended: suspended,
    p_reason: suspended ? reason?.trim() || null : null,
  });
}
