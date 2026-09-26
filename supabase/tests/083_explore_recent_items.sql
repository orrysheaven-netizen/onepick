begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  u uuid[] := array(select gen_random_uuid() from generate_series(1,10));
  cat_a uuid := gen_random_uuid(); cat_b uuid := gen_random_uuid(); hidden_cat uuid := gen_random_uuid();
  i1 uuid := gen_random_uuid(); i2 uuid := gen_random_uuid(); i3 uuid := gen_random_uuid();
  i4 uuid := gen_random_uuid(); hidden_item uuid := gen_random_uuid(); hidden_cat_item uuid := gen_random_uuid();
  mine uuid[];
  -- pgTAP runs in one transaction, so now() is constant: age rows explicitly.
  stamp timestamptz := now() + interval '1 day';
  got uuid[]; tie uuid[];
  cursor_id uuid; cursor_time timestamptz; n integer;
begin
  mine := array[i1,i2,i3,i4,hidden_item,hidden_cat_item];
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(u) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'explore_'||substr(replace(id::text,'-',''),1,12),true from unnest(u) id;
  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (cat_a,'Explore A','explore-'||cat_a,'open',true,true),
    (cat_b,'Explore B','explore-'||cat_b,'open',true,true),
    (hidden_cat,'Explore hidden','explore-'||hidden_cat,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (i1,cat_a,'Place one','place one','active'),
    (i2,cat_a,'Place two','place two','active'),
    (i3,cat_a,'Place three','place three','discontinued'),
    (i4,cat_b,'Place four','place four','active'),
    (hidden_item,cat_a,'Hidden place','hidden place','hidden'),
    (hidden_cat_item,hidden_cat,'Hidden category place','hidden category place','active');
  insert into public.picks(user_id,category_id,item_id,one_line_review,status,started_at) values
    (u[1],cat_a,i1,'r','active',stamp),
    (u[2],cat_a,i1,'r','active',stamp+interval '3 seconds'),
    (u[3],cat_a,i2,'r','active',stamp+interval '2 seconds'),
    (u[4],cat_a,i3,'r','active',stamp+interval '2 seconds'),
    (u[5],cat_b,i4,'r','active',stamp+interval '5 seconds'),
    (u[6],cat_a,hidden_item,'r','active',stamp+interval '9 seconds'),
    (u[7],hidden_cat,hidden_cat_item,'r','active',stamp+interval '9 seconds'),
    (u[8],cat_a,i2,'r','needs_review',stamp+interval '9 seconds'),
    (u[9],cat_a,i2,'r','active',stamp+interval '8 seconds'),
    (u[10],cat_a,i3,'r','active',stamp+interval '7 seconds');
  update public.categories set is_visible=false where id=hidden_cat;
  insert into private.user_moderation(user_id,reason) values(u[9],'Synthetic explore test');

  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select array_agg(f.item_id order by f.last_picked_at desc,f.item_id desc) into got
    from public.explore_recent_items_page() f where f.item_id=any(mine);
  assert got=array[i3,i4,i1,i2],
    'One row per item, newest visible Pick first; hidden items/categories, non-active and suspended Picks never count';
  select count(*) into n from public.explore_recent_items_page() f where f.item_id=i1;
  assert n=1, 'Several people picking one place collapse into one row';
  select f.last_picked_at into cursor_time from public.explore_recent_items_page() f where f.item_id=i1;
  assert cursor_time=stamp+interval '3 seconds', 'The row carries the latest Pick time';

  select array_agg(f.item_id order by f.last_picked_at desc,f.item_id desc) into got
    from public.explore_recent_items_page(array[cat_a]) f;
  assert got=array[i3,i1,i2], 'Category scope limits rows to the given leaves';
  select count(*) into n from public.explore_recent_items_page(array[hidden_cat]) f;
  assert n=0, 'A hidden category cannot be browsed by passing its id';

  select array_agg(f.item_id order by f.last_picked_at desc,f.item_id desc) into got
    from public.explore_recent_items_page(array[cat_a,cat_b],stamp+interval '5 seconds',i4) f;
  assert got=array[i1,i2], 'Cursor continues strictly after the last shown item';
  begin
    perform public.explore_recent_items_page(null,null,i1);
    raise exception 'Half cursor must be rejected';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.explore_recent_items_page(array(select gen_random_uuid() from generate_series(1,501)));
    raise exception 'Oversized scope must be rejected';
  exception when sqlstate '22023' then null;
  end;
  reset role;

  -- u[1] blocks u[10]: that Pick no longer bumps i3 for u[1], who now sees the i2/i3 tie.
  perform set_config('request.jwt.claim.sub',u[1]::text,true);
  set local role authenticated;
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    values(u[1],u[10],'explore_test');
  select array_agg(f.item_id order by f.last_picked_at desc,f.item_id desc) into got
    from public.explore_recent_items_page(array[cat_a,cat_b]) f;
  tie := case when i2>i3 then array[i2,i3] else array[i3,i2] end;
  assert got=array[i4,i1]||tie, 'Blocked people''s Picks do not count; equal times order by item id';
  select f.last_picked_at,f.item_id into cursor_time,cursor_id
    from public.explore_recent_items_page(array[cat_a,cat_b]) f
    order by f.last_picked_at desc,f.item_id desc offset 2 limit 1;
  select array_agg(f.item_id) into got
    from public.explore_recent_items_page(array[cat_a,cat_b],cursor_time,cursor_id) f;
  assert got=tie[2:2], 'Equal timestamps page without skipping or repeating';
  reset role;

  assert not (select prosecdef from pg_proc where oid='public.explore_recent_items_page(uuid[],timestamptz,uuid,boolean)'::regprocedure),
    'No security-definer RLS bypass';
  assert has_function_privilege('anon','public.explore_recent_items_page(uuid[],timestamptz,uuid,boolean)','execute'), 'Guests may browse';
  assert has_function_privilege('authenticated','public.explore_recent_items_page(uuid[],timestamptz,uuid,boolean)','execute'), 'Members may browse';
end;
$flow$;
$test$, 'Explore recent items: per-item newest Pick, scope, visibility, blocks and stable pagination');
select * from finish();
rollback;
