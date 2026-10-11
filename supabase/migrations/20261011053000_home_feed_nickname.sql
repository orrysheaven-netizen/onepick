-- #804 / #762 (user decision 2026-10-11): Home "이웃 제안" cards show the author's
-- public nickname (username when unset). home_pick_feed_page returns nickname as a
-- new trailing column. Everything else — arguments, visibility rules, ordering,
-- page size, SECURITY INVOKER, grants — is unchanged from
-- 20260927210000_add_home_feed_category_filter.sql. nickname is read through the
-- existing profiles RLS and column grant (20261009093500_add_public_profile_nickname.sql).
-- The return type changes, so the function is dropped and recreated in one transaction.

begin;

drop function if exists public.home_pick_feed_page(timestamptz, uuid, text, text, uuid);

create function public.home_pick_feed_page(
  p_before_time timestamptz default null,
  p_before_id uuid default null,
  p_channel text default null,
  p_root_slug text default null,
  p_category_id uuid default null
)
returns table(
  pick_id uuid, user_id uuid, username text, profile_image_url text,
  item_id uuid, item_name text, category_id uuid, category_name text,
  one_line_review text, thumbnail_path text, image_path text,
  image_source_url text, started_at timestamptz, channels text[],
  nickname text
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
  if p_channel is not null and p_channel not in ('offline', 'online', 'recipe') then
    raise exception 'INVALID_CHANNEL' using errcode = '22023';
  end if;

  return query
  with open_leaf_categories as materialized (
    select c.id, c.name, coalesce(gp.slug, parent.slug, c.slug) as root_slug
    from public.categories c
    left join public.categories parent on parent.id = c.parent_id
    left join public.categories gp on gp.id = parent.parent_id
    where public.category_is_open_leaf(c.id)
  )
  select p.id, p.user_id, pr.username, pr.profile_image_url,
    i.id, i.name, c.id, c.name, p.one_line_review,
    i.thumbnail_path, i.image_path, i.image_source_url, p.started_at,
    -- A food Pick shows the channel it was picked under; other Picks keep the
    -- item's channels (normally none).
    case
      when p.channel is not null then array[p.channel]
      else coalesce(
        array(
          select ch.channel
          from public.item_channels ch
          where ch.item_id = i.id
          order by ch.channel
        ),
        array[]::text[]
      )
    end,
    pr.nickname
  from public.picks p
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join open_leaf_categories c on c.id = p.category_id
  where p.status = 'active'
    and p.user_id is distinct from (select auth.uid())
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active', 'discontinued')
    and (p_root_slug is null or c.root_slug = p_root_slug)
    and (p_category_id is null or p.category_id = p_category_id)
    and (
      p_before_time is null
      or (p.started_at, p.id) < (p_before_time, p_before_id)
    )
    and (
      p_channel is null
      or p.channel = p_channel
      or (
        p.channel is null
        and exists (
          select 1
          from public.item_channels ch
          where ch.item_id = i.id
            and ch.channel = p_channel
        )
      )
    )
  order by p.started_at desc, p.id desc
  limit 21;
end;
$$;

revoke all on function public.home_pick_feed_page(timestamptz, uuid, text, text, uuid) from public;
grant execute on function public.home_pick_feed_page(timestamptz, uuid, text, text, uuid) to anon, authenticated, service_role;

commit;
