create or replace function public.home_showcase()
returns table(minimum_pick_count integer, items jsonb)
language sql
stable
set search_path to ''
as $function$
  with totals as (
    select
      i.id,
      i.name,
      i.image_path,
      i.thumbnail_path,
      i.image_source_url,
      i.official_url,
      i.market_availability_status,
      c.id as category_id,
      c.name as category_name,
      count(*) as pick_count,
      max(p.started_at) as last_picked_at
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    join public.categories c on c.id = p.category_id
    left join public.categories parent on parent.id = c.parent_id
    where p.status = 'active'
      and not private.user_is_suspended(p.user_id)
      and i.status in ('active', 'discontinued')
      and c.status = 'open' and c.is_visible and c.is_pickable
      and not exists (select 1 from public.categories child where child.parent_id = c.id)
      and (
        c.parent_id is null
        or (
          parent.parent_id is null
          and parent.status = 'open'
          and parent.is_visible
          and not parent.is_pickable
        )
      )
    group by i.id, c.id
  ),
  qualified as (
    select t.*
    from totals t
    where t.pick_count >= (
      select s.minimum_pick_count
      from public.home_settings s
      where s.id
    )
    order by t.last_picked_at desc, t.id
    limit 20
  )
  select
    s.minimum_pick_count,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'item_id', q.id,
          'name', q.name,
          'category_id', q.category_id,
          'category_name', q.category_name,
          'image_path', q.image_path,
          'thumbnail_path', q.thumbnail_path,
          'image_source_url', q.image_source_url,
          'official_url', q.official_url,
          'market_availability_status', q.market_availability_status,
          'pick_count', q.pick_count
        )
        order by q.last_picked_at desc, q.id
      )
      from qualified q
    ), '[]'::jsonb)
  from public.home_settings s
  where s.id;
$function$;

create or replace function public.home_showcase_page(
  p_before_time timestamptz default null,
  p_after_id uuid default null
)
returns table(minimum_pick_count integer, items jsonb)
language sql
stable
set search_path to ''
as $function$
  with totals as (
    select
      i.id,
      i.name,
      i.image_path,
      i.thumbnail_path,
      i.image_source_url,
      i.official_url,
      i.market_availability_status,
      c.id as category_id,
      c.name as category_name,
      count(*) as pick_count,
      max(p.started_at) as last_picked_at
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    join public.categories c on c.id = p.category_id
    left join public.categories parent on parent.id = c.parent_id
    where p.status = 'active'
      and not private.user_is_suspended(p.user_id)
      and i.status in ('active', 'discontinued')
      and c.status = 'open' and c.is_visible and c.is_pickable
      and not exists (select 1 from public.categories child where child.parent_id = c.id)
      and (
        c.parent_id is null
        or (
          parent.parent_id is null
          and parent.status = 'open'
          and parent.is_visible
          and not parent.is_pickable
        )
      )
    group by i.id, c.id
  ),
  qualified as (
    select t.*
    from totals t
    where t.pick_count >= (
      select s.minimum_pick_count
      from public.home_settings s
      where s.id
    )
      and (
        p_before_time is null
        or t.last_picked_at < p_before_time
        or (t.last_picked_at = p_before_time and t.id > p_after_id)
      )
    order by t.last_picked_at desc, t.id
    limit 21
  ),
  decorated as (
    select
      q.*,
      latest.pick_id as latest_pick_id,
      latest.username as latest_picker_username,
      latest.profile_image_url as latest_picker_profile_image_url,
      latest.one_line_review as latest_pick_review
    from qualified q
    left join lateral (
      select
        p.id as pick_id,
        pr.username,
        pr.profile_image_url,
        p.one_line_review
      from public.picks p
      join public.profiles pr on pr.id = p.user_id
      where p.item_id = q.id
        and p.category_id = q.category_id
        and p.status = 'active'
        and not private.user_is_suspended(p.user_id)
      order by p.started_at desc, p.id desc
      limit 1
    ) latest on true
  )
  select
    s.minimum_pick_count,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'item_id', d.id,
          'name', d.name,
          'category_id', d.category_id,
          'category_name', d.category_name,
          'image_path', d.image_path,
          'thumbnail_path', d.thumbnail_path,
          'image_source_url', d.image_source_url,
          'official_url', d.official_url,
          'market_availability_status', d.market_availability_status,
          'pick_count', d.pick_count,
          'last_picked_at', d.last_picked_at,
          'latest_pick_id', d.latest_pick_id,
          'latest_picker_username', d.latest_picker_username,
          'latest_picker_profile_image_url', d.latest_picker_profile_image_url,
          'latest_pick_review', d.latest_pick_review
        )
        order by d.last_picked_at desc, d.id
      )
      from decorated d
    ), '[]'::jsonb)
  from public.home_settings s
  where s.id;
$function$;

create or replace function public.home_pick_feed_page_v2(
  p_before_time timestamptz default null,
  p_before_id uuid default null
)
returns table(
  pick_id uuid,
  user_id uuid,
  username text,
  profile_image_url text,
  item_id uuid,
  item_name text,
  category_id uuid,
  category_name text,
  one_line_review text,
  thumbnail_path text,
  image_path text,
  image_source_url text,
  official_url text,
  market_availability_status text,
  started_at timestamptz
)
language plpgsql
stable
set search_path to ''
as $function$
begin
  if (p_before_time is null) <> (p_before_id is null) then
    raise exception 'INVALID_PAGINATION_CURSOR' using errcode='22023';
  end if;

  return query
  select
    p.id,
    p.user_id,
    pr.username,
    pr.profile_image_url,
    i.id,
    i.name,
    c.id,
    c.name,
    p.one_line_review,
    i.thumbnail_path,
    i.image_path,
    i.image_source_url,
    i.official_url,
    i.market_availability_status,
    p.started_at
  from public.picks p
  join public.profiles pr on pr.id=p.user_id
  join public.items i on i.id=p.item_id and i.category_id=p.category_id
  join public.categories c on c.id=p.category_id
  left join public.categories parent on parent.id=c.parent_id
  where p.status='active'
    and p.user_id is distinct from (select auth.uid())
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active','discontinued')
    and c.status='open'
    and c.is_visible
    and c.is_pickable
    and not exists(
      select 1 from public.categories child where child.parent_id=c.id
    )
    and (
      c.parent_id is null
      or (
        parent.parent_id is null
        and parent.status='open'
        and parent.is_visible
        and not parent.is_pickable
      )
    )
    and (
      p_before_time is null
      or (p.started_at,p.id) < (p_before_time,p_before_id)
    )
  order by p.started_at desc,p.id desc
  limit 21;
end;
$function$;

create or replace function public.category_top_items_v2(p_category_id uuid)
returns table(
  item_id uuid,
  name text,
  thumbnail_path text,
  pick_count bigint,
  rank bigint,
  is_tied boolean,
  image_path text,
  image_source_url text,
  official_url text,
  market_availability_status text
)
language sql
stable
set search_path to ''
as $function$
  with totals as (
    select
      i.id,
      i.name,
      i.thumbnail_path,
      i.image_path,
      i.image_source_url,
      i.official_url,
      i.market_availability_status,
      count(*) as pick_count
    from public.picks p
    join public.items i on i.id=p.item_id and i.category_id=p.category_id
    join public.categories c on c.id=p.category_id
    left join public.categories parent on parent.id=c.parent_id
    where p.category_id=p_category_id
      and p.status='active'
      and not private.user_is_suspended(p.user_id)
      and i.status in ('active','discontinued')
      and c.status='open'
      and c.is_visible
      and c.is_pickable
      and not exists(
        select 1 from public.categories child where child.parent_id=c.id
      )
      and (
        c.parent_id is null
        or (
          parent.parent_id is null
          and parent.status='open'
          and parent.is_visible
          and not parent.is_pickable
        )
      )
    group by i.id
  )
  select
    t.id,
    t.name,
    t.thumbnail_path,
    t.pick_count,
    rank() over(order by t.pick_count desc),
    count(*) over(partition by t.pick_count)>1,
    t.image_path,
    t.image_source_url,
    t.official_url,
    t.market_availability_status
  from totals t
  order by t.pick_count desc,t.name,t.id
  limit 3;
$function$;

revoke all on function public.home_pick_feed_page_v2(timestamptz,uuid) from public;
revoke all on function public.category_top_items_v2(uuid) from public;
grant execute on function public.home_pick_feed_page_v2(timestamptz,uuid) to anon, authenticated;
grant execute on function public.category_top_items_v2(uuid) to anon, authenticated;

