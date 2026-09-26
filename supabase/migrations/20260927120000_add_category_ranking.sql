-- Public category ranking pages (/ranking/<slug>).
--
-- category_top_items() serves the Explore tab and stops at three rows. The
-- shareable ranking page needs a longer list addressed by the category slug,
-- so search engines and social previews can reach it without an id. Both
-- functions apply the same eligibility rules: current choices from
-- non-suspended accounts on public products in an open, visible, pickable leaf.
--
-- ranking_categories() lists the leaves that have such a page, for the ranking
-- index and the sitemap.

create or replace function public.category_ranking(p_slug text, p_limit integer default 20)
returns table(
  item_id uuid, name text, thumbnail_path text, image_path text, image_source_url text,
  pick_count bigint, rank bigint, is_tied boolean
)
language sql stable security invoker set search_path = ''
as $$
  with target as (
    select c.id
    from public.categories c
    where c.slug = lower(trim(coalesce(p_slug, '')))
      and public.category_is_open_leaf(c.id)
    limit 1
  ),
  totals as (
    select i.id, i.name, i.thumbnail_path, i.image_path, i.image_source_url, count(*) as pick_count
    from target t
    join public.picks p on p.category_id = t.id
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    where p.status = 'active'
      and not private.user_is_suspended(p.user_id)
      and i.status in ('active', 'discontinued')
    group by i.id
  )
  select t.id, t.name, t.thumbnail_path, t.image_path, t.image_source_url, t.pick_count,
    rank() over (order by t.pick_count desc),
    count(*) over (partition by t.pick_count) > 1
  from totals t
  order by t.pick_count desc, t.name, t.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.category_ranking(text, integer) from public;
grant execute on function public.category_ranking(text, integer) to anon, authenticated;

create or replace function public.ranking_categories()
returns table(category_id uuid, slug text, name text, category_path text, sort_order integer)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.slug, c.name, public.category_path(c.id), c.sort_order
  from public.categories c
  where public.category_is_open_leaf(c.id)
  order by c.sort_order, c.name, c.id;
$$;

revoke all on function public.ranking_categories() from public;
grant execute on function public.ranking_categories() to anon, authenticated;
