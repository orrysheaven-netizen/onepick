-- Keep these operational/internal tables inaccessible from public clients.
-- Service-role / server-side operations continue to bypass RLS as intended.

revoke all on table private.admin_users from anon, authenticated;
revoke all on table private.community_write_limits from anon, authenticated;
revoke all on table private.image_import_limits from anon, authenticated;
revoke all on table private.user_moderation from anon, authenticated;
revoke all on table public.external_catalog_cache from anon, authenticated;
revoke all on table public.external_catalog_request_limits from anon, authenticated;

drop policy if exists deny_client_access on private.admin_users;
create policy deny_client_access
on private.admin_users
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists deny_client_access on private.community_write_limits;
create policy deny_client_access
on private.community_write_limits
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists deny_client_access on private.image_import_limits;
create policy deny_client_access
on private.image_import_limits
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists deny_client_access on private.user_moderation;
create policy deny_client_access
on private.user_moderation
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists deny_client_access on public.external_catalog_cache;
create policy deny_client_access
on public.external_catalog_cache
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists deny_client_access on public.external_catalog_request_limits;
create policy deny_client_access
on public.external_catalog_request_limits
for all
to anon, authenticated
using (false)
with check (false);

