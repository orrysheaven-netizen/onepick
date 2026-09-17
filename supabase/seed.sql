insert into public.categories (
  id, parent_id, name, slug, status, is_visible, is_pickable,
  ranking_min_sample, sort_order, image_url
) values (
  '10000000-0000-0000-0000-000000000001',
  null,
  '라면',
  'ramen',
  'open',
  true,
  true,
  20,
  10,
  null
)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  status = excluded.status,
  is_visible = excluded.is_visible,
  is_pickable = excluded.is_pickable,
  ranking_min_sample = excluded.ranking_min_sample,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.items (
  id, category_id, brand_id, name, normalized_name, model_code,
  official_url, status, merged_into_item_id, created_by
) values
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    null,
    '신라면',
    '신라면',
    null,
    null,
    'active',
    null,
    null
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    null,
    '짜파게티',
    '짜파게티',
    null,
    null,
    'active',
    null,
    null
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    null,
    '진라면 매운맛',
    '진라면매운맛',
    null,
    null,
    'active',
    null,
    null
  )
on conflict (id) do update set
  category_id = excluded.category_id,
  name = excluded.name,
  normalized_name = excluded.normalized_name,
  status = excluded.status,
  updated_at = now();
