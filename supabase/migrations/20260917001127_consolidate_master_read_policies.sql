drop policy if exists brands_public_read on public.brands;
drop policy if exists brands_admin_read on public.brands;

create policy brands_anon_read
on public.brands for select
to anon
using (is_active = true);

create policy brands_authenticated_read
on public.brands for select
to authenticated
using (
  is_active = true
  or (select private.is_admin((select auth.uid())))
);

drop policy if exists categories_public_read on public.categories;
drop policy if exists categories_admin_read on public.categories;

create policy categories_anon_read
on public.categories for select
to anon
using (
  is_visible = true
  and status = any (array['open'::text, 'paused'::text, 'closed'::text])
);

create policy categories_authenticated_read
on public.categories for select
to authenticated
using (
  (
    is_visible = true
    and status = any (array['open'::text, 'paused'::text, 'closed'::text])
  )
  or (select private.is_admin((select auth.uid())))
);

drop policy if exists products_public_read on public.products;
drop policy if exists products_admin_read on public.products;
drop policy if exists products_submitter_read_own on public.products;

create policy products_anon_read
on public.products for select
to anon
using (status = any (array['active'::text, 'discontinued'::text]));

create policy products_authenticated_read
on public.products for select
to authenticated
using (
  status = any (array['active'::text, 'discontinued'::text])
  or created_by = (select auth.uid())
  or (select private.is_admin((select auth.uid())))
);
