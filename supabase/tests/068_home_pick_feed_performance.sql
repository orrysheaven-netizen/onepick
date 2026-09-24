begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

select lives_ok($test$
do $flow$
declare
  v_def text;
begin
  assert exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'picks'
      and indexname = 'picks_home_feed_active_started_idx'
      and indexdef like '%(started_at DESC, id DESC)%'
      and indexdef like '%WHERE (status = ''active''::text)%'
  ), 'Home feed partial ordering index must exist';

  select pg_get_functiondef('public.home_pick_feed_page(timestamptz,uuid)'::regprocedure)
    into v_def;
  assert v_def like '%open_categories AS MATERIALIZED%'
      or v_def like '%open_categories as materialized%',
    'Home feed must precompute open leaf categories once per query';
  assert position('category_is_open_leaf' in v_def) = 0,
    'Home feed must not call category_is_open_leaf once per candidate Pick';
  assert not (
    select prosecdef
    from pg_proc
    where oid = 'public.home_pick_feed_page(timestamptz,uuid)'::regprocedure
  ), 'Home feed must keep caller RLS';
end;
$flow$;
$test$, 'Home feed uses indexed ordering and query-scoped category eligibility without bypassing RLS');

select * from finish();
rollback;
