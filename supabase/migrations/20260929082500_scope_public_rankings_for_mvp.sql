-- Initial MVP ranking scope: food + offline only at public callers.
--
-- Keep every existing aggregate available internally by adding optional filters
-- with null defaults. This lets later rollout expose online/recipe or other roots
-- without another schema redesign.

begin;

drop function if exists public.category_top_items(uuid);

create function public.category_top_items(
  p_category_id uuid,
  p_channel text default null
)
returns table(
  item_id uuid, name text, thumbnail_path text, pick_count bigint,
  rank bigint, is_tied boolean, image_path text, image_source_url text
)
language plpgsql
stable
security invoker
set search_path = ''
as $top$
begin
  if p_channel is not null and p_channel not in ('offline','online','recipe') then
    raise exception 'INVALID_CHANNEL' using errcode='22023';
  end if;

  return query
  with totals as (
    select i.id, i.name, i.thumbnail_path, i.image_path, i.image_source_url, count(*) as pick_count
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    where p.category_id = p_category_id
      and p.status = 'active'
      and not private.user_is_suspended(p.user_id)
      and i.status in ('active','discontinued')
      and public.category_is_open_leaf(p.category_id)
      and (
        p_channel is null
        or p.channel = p_channel
        or (
          p.channel is null
          and exists (
            select 1 from public.item_channels ch
            where ch.item_id = i.id and ch.channel = p_channel
          )
        )
      )
    group by i.id
  )
  select t.id, t.name, t.thumbnail_path, t.pick_count,
    rank() over (order by t.pick_count desc),
    count(*) over (partition by t.pick_count) > 1,
    t.image_path, t.image_source_url
  from totals t
  order by t.pick_count desc, t.name, t.id
  limit 3;
end;
$top$;

revoke all on function public.category_top_items(uuid, text) from public;
grant execute on function public.category_top_items(uuid, text) to anon, authenticated, service_role;

drop function if exists public.category_ranking(text, integer);

create function public.category_ranking(
  p_slug text,
  p_limit integer default 20,
  p_channel text default null,
  p_root_slug text default null
)
returns table(
  item_id uuid, name text, thumbnail_path text, image_path text, image_source_url text,
  pick_count bigint, rank bigint, is_tied boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $ranking$
begin
  if p_channel is not null and p_channel not in ('offline','online','recipe') then
    raise exception 'INVALID_CHANNEL' using errcode='22023';
  end if;

  return query
  with target as (
    select c.id
    from public.categories c
    left join public.categories parent on parent.id = c.parent_id
    left join public.categories gp on gp.id = parent.parent_id
    where c.slug = lower(trim(coalesce(p_slug,'')))
      and public.category_is_open_leaf(c.id)
      and (p_root_slug is null or coalesce(gp.slug,parent.slug,c.slug) = p_root_slug)
    limit 1
  ),
  totals as (
    select i.id, i.name, i.thumbnail_path, i.image_path, i.image_source_url, count(*) as pick_count
    from target t
    join public.picks p on p.category_id = t.id
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    where p.status = 'active'
      and not private.user_is_suspended(p.user_id)
      and i.status in ('active','discontinued')
      and (
        p_channel is null
        or p.channel = p_channel
        or (
          p.channel is null
          and exists (
            select 1 from public.item_channels ch
            where ch.item_id = i.id and ch.channel = p_channel
          )
        )
      )
    group by i.id
  )
  select t.id, t.name, t.thumbnail_path, t.image_path, t.image_source_url, t.pick_count,
    rank() over (order by t.pick_count desc),
    count(*) over (partition by t.pick_count) > 1
  from totals t
  order by t.pick_count desc, t.name, t.id
  limit least(greatest(coalesce(p_limit,20),1),50);
end;
$ranking$;

revoke all on function public.category_ranking(text, integer, text, text) from public;
grant execute on function public.category_ranking(text, integer, text, text) to anon, authenticated;

drop function if exists public.ranking_categories();

create function public.ranking_categories(
  p_root_slug text default null
)
returns table(category_id uuid, slug text, name text, category_path text, sort_order integer)
language sql
stable
security invoker
set search_path = ''
as $categories$
  select c.id, c.slug, c.name, public.category_path(c.id), c.sort_order
  from public.categories c
  left join public.categories parent on parent.id = c.parent_id
  left join public.categories gp on gp.id = parent.parent_id
  where public.category_is_open_leaf(c.id)
    and (p_root_slug is null or coalesce(gp.slug,parent.slug,c.slug) = p_root_slug)
  order by c.sort_order, c.name, c.id;
$categories$;

revoke all on function public.ranking_categories(text) from public;
grant execute on function public.ranking_categories(text) to anon, authenticated;

commit;
