-- Home 매장/온라인 tabs: expose each feed row's sales channels and let the
-- server filter by channel so a tab never paginates into empty client pages.
--
-- Channels come from public.item_channels ('offline' | 'online'). Delivery
-- belongs to the store (offline) channel; 'online' means shipped/online-store
-- sales. Items with no channel row (legacy products) appear only in the
-- unfiltered feed.
--
-- The return type gains a column, so the function is recreated. Existing
-- clients keep working: p_before_time/p_before_id keep their names and
-- positions and p_channel defaults to null (all channels).

begin;

drop function if exists public.home_pick_feed_page(timestamptz, uuid);

create function public.home_pick_feed_page(
  p_before_time timestamptz default null,
  p_before_id uuid default null,
  p_channel text default null
)
returns table(
  pick_id uuid, user_id uuid, username text, profile_image_url text,
  item_id uuid, item_name text, category_id uuid, category_name text,
  one_line_review text, thumbnail_path text, image_path text,
  image_source_url text, started_at timestamptz, channels text[]
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (p_before_time is null) <> (p_before_id is null) then
    raise exception 'INVALID_PAGINATION_CURSOR' using errcode = '22023';
  end if;
  if p_channel is not null and p_channel not in ('offline', 'online') then
    raise exception 'INVALID_CHANNEL' using errcode = '22023';
  end if;

  return query
  with open_leaf_categories as materialized (
    select c.id, c.name
    from public.categories c
    where public.category_is_open_leaf(c.id)
  )
  select p.id, p.user_id, pr.username, pr.profile_image_url,
    i.id, i.name, c.id, c.name, p.one_line_review,
    i.thumbnail_path, i.image_path, i.image_source_url, p.started_at,
    coalesce(
      array(
        select ch.channel
        from public.item_channels ch
        where ch.item_id = i.id
        order by ch.channel
      ),
      array[]::text[]
    )
  from public.picks p
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join open_leaf_categories c on c.id = p.category_id
  where p.status = 'active'
    and p.user_id is distinct from (select auth.uid())
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active', 'discontinued')
    and (
      p_before_time is null
      or (p.started_at, p.id) < (p_before_time, p_before_id)
    )
    and (
      p_channel is null
      or exists (
        select 1
        from public.item_channels ch
        where ch.item_id = i.id
          and ch.channel = p_channel
      )
    )
  order by p.started_at desc, p.id desc
  limit 21;
end;
$$;

revoke all on function public.home_pick_feed_page(timestamptz, uuid, text) from public;
grant execute on function public.home_pick_feed_page(timestamptz, uuid, text) to anon, authenticated, service_role;

commit;
