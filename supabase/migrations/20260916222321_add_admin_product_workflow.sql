create table if not exists private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

revoke all on table private.admin_users from public, anon, authenticated;

insert into private.admin_users (user_id)
select id from public.profiles where username = 'onepick_qa'
on conflict (user_id) do nothing;

create or replace function private.is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (
      select 1
      from private.admin_users au
      where au.user_id = p_user_id
    );
$$;

revoke all on function private.is_admin(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_admin(uuid) to authenticated;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_admin((select auth.uid()));
$$;

revoke all on function public.current_user_is_admin() from public, anon;
grant execute on function public.current_user_is_admin() to authenticated;

create policy categories_admin_read
on public.categories for select
to authenticated
using ((select private.is_admin((select auth.uid()))));

create policy categories_admin_insert
on public.categories for insert
to authenticated
with check ((select private.is_admin((select auth.uid()))));

create policy categories_admin_update
on public.categories for update
to authenticated
using ((select private.is_admin((select auth.uid()))))
with check ((select private.is_admin((select auth.uid()))));

create policy brands_admin_read
on public.brands for select
to authenticated
using ((select private.is_admin((select auth.uid()))));

create policy brands_admin_insert
on public.brands for insert
to authenticated
with check ((select private.is_admin((select auth.uid()))));

create policy brands_admin_update
on public.brands for update
to authenticated
using ((select private.is_admin((select auth.uid()))))
with check ((select private.is_admin((select auth.uid()))));

create policy products_admin_read
on public.products for select
to authenticated
using ((select private.is_admin((select auth.uid()))));

create policy products_admin_insert
on public.products for insert
to authenticated
with check ((select private.is_admin((select auth.uid()))));

create policy products_admin_update
on public.products for update
to authenticated
using ((select private.is_admin((select auth.uid()))))
with check ((select private.is_admin((select auth.uid()))));

create policy products_submitter_read_own
on public.products for select
to authenticated
using (created_by = (select auth.uid()));

create policy products_user_submit_pending
on public.products for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and status = 'pending'
  and merged_into_product_id is null
  and exists (
    select 1
    from public.categories c
    where c.id = category_id
      and c.status = 'open'
      and c.is_visible = true
      and c.is_pickable = true
  )
  and (image_path is null or split_part(image_path, '/', 1) = (select auth.uid())::text)
  and (thumbnail_path is null or split_part(thumbnail_path, '/', 1) = (select auth.uid())::text)
);

grant insert, update on table public.categories to authenticated;
grant insert, update on table public.brands to authenticated;
grant insert, update on table public.products to authenticated;
