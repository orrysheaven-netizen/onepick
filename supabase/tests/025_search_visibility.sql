begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  viewer uuid := gen_random_uuid();
  good_cat uuid := gen_random_uuid(); closed_cat uuid := gen_random_uuid(); hidden_cat uuid := gen_random_uuid();
  unpickable_cat uuid := gen_random_uuid(); parent_cat uuid := gen_random_uuid(); child_cat uuid := gen_random_uuid();
  target uuid := gen_random_uuid(); discontinued uuid := gen_random_uuid(); parent_target uuid := gen_random_uuid();
  other_cat uuid := gen_random_uuid(); other_target uuid := gen_random_uuid();
  token text := 'searchspeed'||replace(gen_random_uuid()::text,'-','');
  aliases text; found_id uuid; n integer;
begin
  insert into auth.users(id,aud,role,created_at,updated_at) values(viewer,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed) values(viewer,'search_'||substr(replace(viewer::text,'-',''),1,10),true);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (good_cat,'Search visible','search-'||good_cat,'open',true,true),
    (closed_cat,'Search closed','search-'||closed_cat,'open',true,true),
    (hidden_cat,'Search hidden','search-'||hidden_cat,'open',true,true),
    (unpickable_cat,'Search unpickable','search-'||unpickable_cat,'open',true,true),
    (parent_cat,'Search parent','search-'||parent_cat,'open',true,false),
    (other_cat,'Search other','search-'||other_cat,'open',true,true);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable,parent_id)
    values(child_cat,'Search child','search-'||child_cat,'open',true,true,parent_cat);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (target,good_cat,token||'라면',token||'라면','active'),
    (discontinued,good_cat,token||'단종',token||'단종','discontinued'),
    (parent_target,child_cat,token||'하위',token||'하위','active'),
    (other_target,other_cat,token||'다른분야',token||'다른분야','active');
  -- Unavailable items have a better exact-name match. They must be excluded
  -- before LIMIT, not after the first result reaches the client.
  insert into public.items(category_id,name,normalized_name,status) values
    (closed_cat,token,token,'active'), (hidden_cat,token,token,'active'),
    (unpickable_cat,token,token,'active'), (good_cat,token,token,'hidden'),
    (good_cat,token||'승인대기',token||'승인대기','pending');
  aliases := token||'별칭';
  insert into public.item_aliases(item_id,alias,normalized_alias) values(target,aliases,aliases);
  update public.categories set status='closed' where id=closed_cat;
  update public.categories set is_visible=false where id in (hidden_cat,parent_cat);
  update public.categories set is_pickable=false where id=unpickable_cat;

  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select count(*) into n from public.search_items(token,null,50);
  assert n=3, 'Unscoped RPC alone returns only two visible items and the other visible category';
  select count(*) into n from public.search_items(token,array[good_cat],50);
  assert n=2, 'Category-scoped RPC includes active and discontinued items';
  select id into found_id from public.search_items(token,null,1);
  assert found_id in (target,discontinued,other_target), 'Visibility applies before the first ranked result, without category preflight';
  select count(*) into n from public.search_items(token,array[closed_cat,hidden_cat,unpickable_cat,child_cat],50);
  assert n=0, 'Caller-supplied category IDs cannot reveal closed, hidden, unpickable or hidden-parent categories';
  select count(*) into n from public.search_items(token,array[gen_random_uuid()],20);
  assert n=0, 'Unknown category is empty without an extra categories request';
  select count(*) into n from public.search_items(token,array[]::uuid[],20);
  assert n=0, 'Empty category scope remains empty';
  select count(*) into n from public.search_items(' ',null,20);
  assert n=0, 'Blank search does not enumerate the catalog';
  select id into found_id from public.search_items(aliases,array[good_cat],1);
  assert found_id=target, 'Alias ranking still points to the canonical item';
  reset role;

  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  select count(*) into n from public.search_items(token,null,50);
  assert n=3, 'Ordinary signed-in callers keep the same public search eligibility';
  reset role;
  update public.categories set is_visible=true,status='closed' where id=parent_cat;
  set local role authenticated;
  select count(*) into n from public.search_items(token,array[child_cat],20);
  assert n=0, 'Closed parent is checked even when the child itself is open and visible';
  reset role;
  update public.categories set status='open' where id=parent_cat;
  set local role authenticated;
  select count(*) into n from public.search_items(token,array[child_cat],20);
  assert n=1, 'Reopened hierarchy becomes searchable without a separate category-cache refresh';
  reset role;
  assert not (select prosecdef from pg_proc where oid='public.search_items(text,uuid[],integer)'::regprocedure), 'Existing search remains SECURITY INVOKER';
end;
$flow$;
$test$, 'Single-request search keeps category hierarchy, item eligibility, aliases, ranking and caller RLS');
select * from finish();
rollback;
