begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select ok(
  to_regclass('public.picks_active_started_id_idx') is not null,
  'Active home-feed ordering index exists'
);

select ok(
  position('(started_at DESC, id DESC)' in pg_get_indexdef('public.picks_active_started_id_idx'::regclass)) > 0
  and position('WHERE (status = ''active''::text)' in pg_get_indexdef('public.picks_active_started_id_idx'::regclass)) > 0,
  'Home-feed index matches active status and cursor order'
);

select ok(
  position(
    'open_leaf_categories as materialized'
    in lower(pg_get_functiondef('public.home_pick_feed_page(timestamptz,uuid,text,text,uuid)'::regprocedure))
  ) > 0,
  'Home feed materializes open leaf categories once'
);

select ok(
  position(
    'open_leaf_categories as materialized'
    in lower(pg_get_functiondef('public.home_pick_feed_page_v2(timestamptz,uuid)'::regprocedure))
  ) > 0,
  'Home feed v2 materializes open leaf categories once'
);

select * from finish();
rollback;
