import { supabase } from '@/lib/supabase/client';

// The single source for the admin panel's access token. admin-api.ts and
// admin-moderation-api.ts previously each defined their own copy of this
// function; keeping only one means no future admin module can drift onto a
// second, un-elevated session the way admin-moderation-api.ts once did by
// reading a localStorage key nothing populated.
export async function getAdminAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('관리자 로그인이 필요합니다.');
  return data.session.access_token;
}
