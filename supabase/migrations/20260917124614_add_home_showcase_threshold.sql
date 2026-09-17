-- One public display setting. Only allowlisted administrators can change it.
create table public.home_settings (
  id boolean primary key default true check (id),
  minimum_pick_count integer not null default 3 check (minimum_pick_count between 1 and 100000),
  updated_at timestamptz not null default now()
);
insert into public.home_settings (id) values (true);
alter table public.home_settings enable row level security;
revoke all on public.home_settings from anon, authenticated;
grant select on public.home_settings to anon, authenticated;
grant update (minimum_pick_count) on public.home_settings to authenticated;
create policy home_settings_read on public.home_settings for select to anon, authenticated using (true);
create policy home_settings_admin_update on public.home_settings for update to authenticated
  using ((select private.is_admin((select auth.uid()))))
  with check ((select private.is_admin((select auth.uid()))));
create trigger home_settings_updated_at before update on public.home_settings
  for each row execute function private.set_updated_at();

-- The threshold and qualified products come from the same database snapshot.
-- Current-pick uniqueness ensures each person counts once per category.
create function public.home_showcase()
returns table (minimum_pick_count integer, items jsonb)
language sql stable security invoker set search_path = ''
as $$
  with totals as (
    select i.id, i.name, i.image_path, i.thumbnail_path,
      c.id as category_id, c.name as category_name,
      count(*) as pick_count, max(p.started_at) as last_picked_at
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    join public.categories c on c.id = p.category_id
    left join public.categories parent on parent.id = c.parent_id
    where p.status = 'active' and i.status in ('active', 'discontinued')
      and c.status = 'open' and c.is_visible and c.is_pickable
      and not exists (select 1 from public.categories child where child.parent_id = c.id)
      and (c.parent_id is null or (parent.parent_id is null and parent.status = 'open'
        and parent.is_visible and not parent.is_pickable))
    group by i.id, c.id
  ), qualified as (
    select t.* from totals t
    where t.pick_count >= (select s.minimum_pick_count from public.home_settings s where s.id)
    order by t.last_picked_at desc, t.id
    limit 20
  )
  select s.minimum_pick_count, coalesce((
    select jsonb_agg(jsonb_build_object(
      'item_id', q.id, 'name', q.name, 'category_id', q.category_id,
      'category_name', q.category_name, 'image_path', q.image_path,
      'thumbnail_path', q.thumbnail_path, 'pick_count', q.pick_count
    ) order by q.last_picked_at desc, q.id)
    from qualified q
  ), '[]'::jsonb)
  from public.home_settings s where s.id;
$$;
revoke all on function public.home_showcase() from public;
grant execute on function public.home_showcase() to anon, authenticated;
