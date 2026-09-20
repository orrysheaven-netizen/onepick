
drop policy if exists item_editorial_features_public_read on public.item_editorial_features;
drop policy if exists item_editorial_features_admin_read on public.item_editorial_features;

create policy item_editorial_features_anon_read
on public.item_editorial_features
for select
to anon
using (
  is_active
  and starts_at <= now()
  and (ends_at is null or ends_at > now())
);

create policy item_editorial_features_authenticated_read
on public.item_editorial_features
for select
to authenticated
using (
  (
    is_active
    and starts_at <= now()
    and (ends_at is null or ends_at > now())
  )
  or (select private.is_admin_mfa())
);
