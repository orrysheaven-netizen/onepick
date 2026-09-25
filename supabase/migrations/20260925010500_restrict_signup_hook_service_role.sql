-- Keep the Before User Created hook callable only by Supabase Auth.
-- service_role receives EXECUTE on new public functions from this project's
-- default privileges, so revoke it explicitly for this auth hook.
revoke execute on function public.hook_before_user_created(jsonb) from service_role;

-- Preserve the intended Auth hook access explicitly.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
