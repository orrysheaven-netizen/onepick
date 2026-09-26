begin;

-- Searching a dish ("미역국") shows it three ways: 오프라인 맛집, 온라인 맛집 and
-- 레시피. The query must name the dish exactly (its name or a search term, spaces
-- ignored); other searches keep the plain item results.
--
-- Rows: one header row per matched dish (channel null) so the dish shows even with
-- nothing picked yet, then up to five items per channel, most picked first. An
-- item belongs to a channel through item_channels or through a current Pick made
-- under that channel. Counts are people with a current Pick in that channel.
-- Security invoker: Picks and items follow the caller's read policies.
create or replace function public.dish_channel_overview(p_query text)
returns table(
  category_id uuid, category_name text, channel text,
  item_id uuid, item_name text, thumbnail_path text, image_path text, image_source_url text,
  pick_count bigint, rank integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select regexp_replace(lower(btrim(coalesce(p_query, ''))), '[[:space:]]', '', 'g') as v
  ),
  food_leaves as (
    select c.id, c.name, c.sort_order
    from public.categories c
    left join public.categories parent on parent.id = c.parent_id
    left join public.categories gp on gp.id = parent.parent_id
    where public.category_is_open_leaf(c.id)
      and 'food' in (c.slug, parent.slug, gp.slug)
      and c.slug not in ('recipe', 'pending-product')
  ),
  dish as (
    select f.id, f.name
    from food_leaves f, q
    where char_length(q.v) >= 2
      and (
        regexp_replace(lower(f.name), '[[:space:]]', '', 'g') = q.v
        or exists (
          select 1 from public.category_search_terms t
          where t.category_id = f.id
            and regexp_replace(lower(t.term), '[[:space:]]', '', 'g') = q.v
        )
      )
    order by (regexp_replace(lower(f.name), '[[:space:]]', '', 'g') = q.v) desc, f.sort_order, f.name
    limit 1
  ),
  candidates as (
    select distinct i.id, i.name, i.thumbnail_path, i.image_path, i.image_source_url, ch.channel
    from dish d
    join public.items i on i.category_id = d.id and i.status in ('active', 'discontinued')
    join lateral (
      select c.channel from public.item_channels c where c.item_id = i.id
      union
      select p.channel from public.picks p
      where p.item_id = i.id and p.status = 'active' and p.channel is not null
    ) ch on true
  ),
  counted as (
    select c.*,
      (select count(distinct p.user_id)
       from public.picks p
       where p.item_id = c.id and p.channel = c.channel and p.status = 'active'
         and not private.user_is_suspended(p.user_id)) as pick_count
    from candidates c
  ),
  ranked as (
    select c.*, (row_number() over (partition by c.channel order by c.pick_count desc, c.name, c.id))::integer as rn
    from counted c
  )
  select d.id, d.name, null::text, null::uuid, null::text, null::text, null::text, null::text, 0::bigint, 0
  from dish d
  union all
  select d.id, d.name, r.channel, r.id, r.name, r.thumbnail_path, r.image_path, r.image_source_url, r.pick_count, r.rn
  from ranked r cross join dish d
  where r.rn <= 5
  order by 3 nulls first, 10;
$$;

revoke all on function public.dish_channel_overview(text) from public;
grant execute on function public.dish_channel_overview(text) to anon, authenticated, service_role;

commit;
