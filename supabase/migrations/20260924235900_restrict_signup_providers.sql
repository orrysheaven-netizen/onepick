-- Only Kakao and Apple may create OnePick accounts.
--
-- Wired up as the Supabase Auth "Before User Created" hook. Hiding the other
-- buttons in the app is not enough: anyone holding the public anon key can call
-- /auth/v1/signup (email/phone) or sign in anonymously directly. Existing users
-- are unaffected; the hook only runs when a new auth.users row would be created.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user jsonb := coalesce(event -> 'user', '{}'::jsonb);
  v_provider text := v_user -> 'app_metadata' ->> 'provider';
begin
  if coalesce((v_user ->> 'is_anonymous')::boolean, true) = false
     and v_provider in ('kakao', 'apple') then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', '카카오 또는 Apple 로그인으로만 가입할 수 있어요.'
    )
  );
end;
$$;

revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
