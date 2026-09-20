create or replace function public.profile_taste_composition(p_profile_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with visible_picks as (
    select
      p.id as pick_id,
      p.category_id,
      c.name as category_name,
      c.slug as category_slug
    from public.picks p
    join public.categories c on c.id = p.category_id
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    where p.user_id = p_profile_id
      and p.status = 'active'
      and i.status in ('active','discontinued')
      and c.status = 'open'
      and c.is_visible = true
      and c.is_pickable = true
  ),
  mapped as (
    select
      vp.pick_id,
      vp.category_id,
      vp.category_name,
      vp.category_slug,
      td.dimension_code,
      td.weight,
      d.name as dimension_name,
      d.display_order
    from visible_picks vp
    join public.category_taste_dimensions td
      on td.category_id = vp.category_id
     and td.is_primary = true
    join public.taste_dimensions d
      on d.code = td.dimension_code
  ),
  dimension_totals as (
    select
      m.dimension_code,
      m.dimension_name,
      min(m.display_order) as display_order,
      count(*)::int as pick_count,
      count(distinct m.category_id)::int as category_count,
      sum(m.weight)::int as weighted_score
    from mapped m
    group by m.dimension_code, m.dimension_name
  ),
  category_totals as (
    select
      m.dimension_code,
      m.category_id,
      m.category_name,
      m.category_slug,
      count(*)::int as pick_count
    from mapped m
    group by
      m.dimension_code,
      m.category_id,
      m.category_name,
      m.category_slug
  ),
  denominator as (
    select
      coalesce(sum(weighted_score),0)::numeric as total_weighted_score
    from dimension_totals
  )
  select jsonb_build_object(
    'profile_id', p_profile_id,
    'total_pick_count', (select count(*)::int from visible_picks),
    'mapped_pick_count', (select count(*)::int from mapped),
    'unmapped_pick_count',
      (select count(*)::int from visible_picks)
      - (select count(*)::int from mapped),
    'dimensions',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'code', dt.dimension_code,
          'name', dt.dimension_name,
          'pick_count', dt.pick_count,
          'category_count', dt.category_count,
          'weighted_score', dt.weighted_score,
          'percentage',
            case
              when den.total_weighted_score <= 0 then 0
              else round((dt.weighted_score::numeric / den.total_weighted_score) * 100, 1)
            end,
          'categories',
            coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'category_id', ct.category_id,
                  'category_name', ct.category_name,
                  'category_slug', ct.category_slug,
                  'pick_count', ct.pick_count
                )
                order by ct.pick_count desc, ct.category_name, ct.category_id
              )
              from category_totals ct
              where ct.dimension_code = dt.dimension_code
            ), '[]'::jsonb)
        )
        order by dt.pick_count desc, dt.display_order, dt.dimension_code
      )
      from dimension_totals dt
      cross join denominator den
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.profile_taste_composition(uuid) from public;
grant execute on function public.profile_taste_composition(uuid) to anon, authenticated;

