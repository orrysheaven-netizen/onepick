begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  v_root uuid := gen_random_uuid();
  v_middle uuid := gen_random_uuid();
  v_leaf uuid := gen_random_uuid();
  v_fourth uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_depth4_rejected boolean := false;
  v_editorial_count integer;
  v_showcase_count integer;
begin
  insert into public.categories(id,name,slug,status,is_visible,is_pickable,ranking_min_sample)
  values(v_root,'Hierarchy Root','hierarchy-root-'||replace(v_root::text,'-',''),'open',true,false,1);

  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,ranking_min_sample)
  values(v_middle,v_root,'Hierarchy Middle','hierarchy-middle-'||replace(v_middle::text,'-',''),'open',true,false,1);

  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,ranking_min_sample)
  values(v_leaf,v_middle,'Hierarchy Leaf','hierarchy-leaf-'||replace(v_leaf::text,'-',''),'open',true,true,1);

  assert public.category_is_open_leaf(v_leaf), 'Third-level leaf is selectable';
  assert public.category_path(v_leaf)='Hierarchy Root › Hierarchy Middle › Hierarchy Leaf',
    'Category path includes all three levels';

  insert into public.items(id,category_id,name,normalized_name,status)
  values(v_item,v_leaf,'Editorial Fixture','editorialfixture','active');

  insert into public.item_editorial_features(item_id,priority,note,is_active)
  values(v_item,10,'A separate editorial reason',true);

  set local role anon;
  select count(*) into v_editorial_count
  from public.home_editorial_items(6)
  where item_id=v_item and editorial_priority=10 and pick_count=0;

  select count(*) into v_showcase_count
  from public.home_showcase_page(null,null) h,
       jsonb_array_elements(h.items) item
  where (item->>'item_id')::uuid=v_item;

  assert v_editorial_count=1, 'Editorial item is publicly readable through the dedicated RPC';
  assert v_showcase_count=0, 'Editorial emphasis does not fabricate user popularity';
  reset role;

  update public.categories set is_pickable=false where id=v_leaf;
  begin
    insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,ranking_min_sample)
    values(v_fourth,v_leaf,'Hierarchy Fourth','hierarchy-fourth-'||replace(v_fourth::text,'-',''),'open',true,true,1);
  exception when sqlstate 'P0001' then
    v_depth4_rejected := true;
  end;
  assert v_depth4_rejected, 'Fourth category level is rejected';

  assert not (select prosecdef from pg_proc where oid='public.category_is_open_leaf(uuid)'::regprocedure),
    'Hierarchy helper remains SECURITY INVOKER';
  assert not (select prosecdef from pg_proc where oid='public.home_editorial_items(integer)'::regprocedure),
    'Editorial home RPC remains SECURITY INVOKER';
  assert (select relrowsecurity from pg_class where oid='public.item_editorial_features'::regclass),
    'Editorial feature table has RLS enabled';
end;
$flow$;
$test$, 'Three-level categories and editorial recommendations stay isolated from user popularity');

select * from finish();
rollback;
