create index product_analytics_events_pick_idx
  on public.product_analytics_events(pick_id, created_at desc)
  where pick_id is not null;

create index product_analytics_events_item_idx
  on public.product_analytics_events(item_id, created_at desc)
  where item_id is not null;

create index product_analytics_events_category_idx
  on public.product_analytics_events(category_id, created_at desc)
  where category_id is not null;
