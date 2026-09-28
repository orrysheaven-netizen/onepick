-- Initial MVP public scope: food + offline only.
--
-- The public Home feed already supports p_channel + p_root_slug server-side.
-- Add the same optional scope to the viewer-bound following feed so hidden
-- online/recipe/non-food rows never consume pagination slots. Defaults stay
-- null to preserve the full internal contract for later rollout.

begin;

drop function if exists public.home_following_feed_page(timestamptz, uuid);

create function public.home_following_feed_page(
  p_before_time timestamptz default null,
  p_before_id uuid default null,
  p_channel text default null,
  p_root_slug text default null
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
    end
  from public.picks p
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join open_leaf_categories c on c.id = p.category_id
  where p.status = 'active'
    and exists (
      select 1 from public.user_follows f
      where f.follower_id = (select auth.uid()) and f.followee_id = p.user_id
    )
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active', 'discontinued')
    and (p_root_slug is null or c.root_slug = p_root_slug)
    and (p_before_time is null or (p.started_at, p.id) < (p_before_time, p_before_id))
    and (
      p_channel is null
      or p.channel = p_channel
      or (
        p.channel is null
        and exists (
          select 1
          from public.item_channels ch
          where ch.item_id = i.id and ch.channel = p_channel
        )
      )
    )
  order by p.started_at desc, p.id desc
  limit 21;
end;
$$;

revoke all on function public.home_following_feed_page(timestamptz, uuid, text, text) from public, anon;
grant execute on function public.home_following_feed_page(timestamptz, uuid, text, text) to authenticated;
comment on function public.home_following_feed_page(timestamptz, uuid, text, text) is
  'Viewer-bound following feed with optional channel/root scope; SECURITY INVOKER, 20 rows + lookahead.';

drop function if exists public.home_editorial_items(integer);

create function public.home_editorial_items(
  p_limit integer default 6,
  p_channel text default null,
  p_root_slug text default null
)
returns table(
  item_id uuid,
  name text,
  category_id uuid,
  category_name text,
  category_path text,
  image_path text,
  thumbnail_path text,
  image_source_url text,
  editorial_note text,
  editorial_priority integer,
  pick_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $editorial$
begin
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
  select
    i.id, i.name, c.id, c.name, public.category_path(c.id),
    i.image_path, i.thumbnail_path, i.image_source_url,
    f.note, f.priority,
    (
      select count(*)
      from public.picks p
      where p.item_id = i.id
        and p.category_id = i.category_id
        and p.status = 'active'
        and not private.user_is_suspended(p.user_id)
        and (
          p_channel is null
          or p.channel = p_channel
          or (
            p.channel is null
            and exists (
              select 1
              from public.item_channels ch
              where ch.item_id = i.id and ch.channel = p_channel
            )
          )
        )
    )
  from public.item_editorial_features f
  join public.items i on i.id = f.item_id
  join open_leaf_categories c on c.id = i.category_id
  where f.is_active
    and f.starts_at <= now()
    and (f.ends_at is null or f.ends_at > now())
    and i.status in ('active','discontinued')
    and (p_root_slug is null or c.root_slug = p_root_slug)
    and (
      p_channel is null
      or exists (
        select 1
        from public.item_channels ch
        where ch.item_id = i.id and ch.channel = p_channel
      )
    )
  order by f.priority asc, f.updated_at desc, i.name, i.id
  limit least(greatest(coalesce(p_limit,6),1),12);
end;
$editorial$;

revoke all on function public.home_editorial_items(integer, text, text) from public;
grant execute on function public.home_editorial_items(integer, text, text) to anon, authenticated, service_role;
comment on function public.home_editorial_items(integer, text, text) is
  'Editorial Home items with optional channel/root scope; defaults preserve the full internal catalogue.';

commit;
