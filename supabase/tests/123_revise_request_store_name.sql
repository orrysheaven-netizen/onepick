begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  dave uuid := gen_random_uuid(); erin uuid := gen_random_uuid();
  grp uuid := gen_random_uuid(); menu uuid := gen_random_uuid();
  u_item uuid; e_item uuid; u_place uuid;
  v_item public.items%rowtype; raised boolean;
begin
  assert not has_function_privilege('anon','public.revise_item_request(uuid,text,text,text,text,boolean,text)','execute'),
    'Guests cannot revise requests';
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[dave,erin]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'rsn_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[dave,erin]) id;
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
    select grp,c.id,'이름수정 국','rsn-soup-'||substr(replace(grp::text,'-',''),1,8),'open',true,false
    from public.categories c where c.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable) values
    (menu,grp,'이름수정 미역국','rsn-miyeok-'||substr(replace(menu::text,'-',''),1,8),'open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes) values
    (menu,'internal',true,true,'revise store name fixture');

  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  perform set_config('request.jwt.claim.sub',erin::text,true);
  set local role authenticated;
  e_item := (public.stage_user_place_item(menu,'서울집 강남점','','https://naver.me/rsn-same')).id;
  reset role;

  perform set_config('request.jwt.claim.sub',dave::text,true);
  set local role authenticated;
  u_item := (public.stage_user_place_item(menu,'서울짐 강남점','','https://naver.me/rsn-same')).id;

  -- Figma 22: 상호명 and 매장 링크 are fixed together and the request goes back to review.
  v_item := public.revise_item_request(u_item, p_link_url => 'https://naver.me/rsn-dave', p_name => '  서울집   강남점 ');
  assert v_item.name = '서울집 강남점' and v_item.normalized_name = '서울집강남점' and v_item.status = 'pending',
    'The request is renamed (spaces collapsed) and stays in review';
  reset role;
  select ip.place_id into u_place from public.item_places ip where ip.item_id = u_item;
  assert (select name = '서울집 강남점' and map_url = 'https://naver.me/rsn-dave' from public.places where id = u_place),
    'The member store follows the new name and link';
  assert (select pc.name = '서울집 강남점' from public.place_catalog pc join public.places p
          on p.place_provider = pc.place_provider and p.provider_place_id = pc.provider_place_id where p.id = u_place),
    'The pending catalog row follows the new name';

  perform set_config('request.jwt.claim.sub',dave::text,true);
  set local role authenticated;
  -- Same name + same link as another member store is a duplicate, never a merge.
  raised := false;
  begin perform public.revise_item_request(u_item, p_link_url => 'https://naver.me/rsn-same');
  exception when others then raised := sqlerrm = 'PLACE_ALREADY_REGISTERED'; end;
  assert raised, 'Renaming/relinking onto another member store is rejected';

  raised := false;
  begin perform public.revise_item_request(u_item, p_name => repeat('가', 101));
  exception when others then raised := sqlerrm = 'PLACE_NAME_INVALID'; end;
  assert raised, 'Names over 100 characters are rejected';

  raised := false;
  begin perform public.revise_item_request(e_item, p_name => '남의 가게');
  exception when others then raised := sqlerrm = 'ITEM_NOT_FOUND'; end;
  assert raised, 'Another member''s request cannot be renamed';

  -- Unchanged name: link-only callers keep working.
  v_item := public.revise_item_request(u_item, p_link_url => 'https://naver.me/rsn-dave2');
  assert v_item.name = '서울집 강남점', 'Link-only revisions keep the name';
  reset role;
end;
$flow$;
$test$, 'revise_item_request renames only my own member-submitted store request');
select * from finish();
rollback;
