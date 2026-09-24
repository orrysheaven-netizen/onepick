begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select ok(
  to_regclass('public.picks_active_started_id_idx') is not null,
  'Active home-feed ordering index exists'
);

select like(
  pg_get_indexdef('public.picks_active_started_id_idx'::regclass),
  '%(started_at DESC, id DESC)%WHERE (status = ''active''::text)%',
  'Home-feed index matches active status and cursor order'
);

select like(
  pg_get_functiondef('public.home_pick_feed_page(timestamptz,uuid)'::regprocedure),
  '%open_leaf_categories AS MATERIALIZED%',
  'Home feed materializes open leaf categories once'
);

select like(
  pg_get_functiondef('public.home_pick_feed_page_v2(timestamptz,uuid)'::regprocedure),
  '%open_leaf_categories AS MATERIALIZED%',
  'Home feed v2 materializes open leaf categories once'
);

select * from finish();
rollback;
