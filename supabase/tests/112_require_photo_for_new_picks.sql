begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  u_new uuid := gen_random_uuid();
  u_legacy uuid := gen_random_uuid();
  u_register uuid := gen_random_uuid();
  cat uuid := gen_random_uuid();
  no_photo uuid := gen_random_uuid();
  no_photo_2 uuid := gen_random_uuid();
  blank_photo uuid := gen_random_uuid();
  external_photo uuid := gen_random_uuid();
  legacy_pick uuid := gen_random_uuid();
  result public.picks%rowtype;
  raised boolean;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
  select id,'authenticated','authenticated',now(),now()
  from unnest(array[u_new,u_legacy,u_register]) id;

  insert into public.profiles(id,username,onboarding_completed)
  select id,'photo_'||substr(replace(id::text,'-',''),1,12),true
  from unnest(array[u_new,u_legacy,u_register]) id;

  insert into public.categories(id,name,slug,status,is_visible,is_pickable,sort_order)
  values(cat,'Photo guard category','photo-guard-'||substr(replace(cat::text,'-',''),1,12),'open',true,true,1);

  insert into public.items(
    id,category_id,name,normalized_name,status,image_path,thumbnail_path,image_source_url
  ) values
    (no_photo,cat,'No photo','nophoto','active',null,null,null),
    (no_photo_2,cat,'No photo two','nophototwo','active',null,null,null),
    (blank_photo,cat,'Blank photo','blankphoto','active','','','   '),
    (external_photo,cat,'External photo','externalphoto','active',null,null,'https://example.com/item.jpg');

  -- New selection: photo-less item is rejected.
  perform set_config('request.jwt.claim.sub',u_new::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;

  raised := false;
  begin
    perform public.change_pick(cat,no_photo,'사진 없음');
  exception when others then
    raised := sqlerrm='PHOTO_REQUIRED';
  end;
  assert raised, 'change_pick blocks a new photo-less Pick';

  raised := false;
  begin
    perform public.change_pick(cat,blank_photo,'공백 사진 필드');
  exception when others then
    raised := sqlerrm='PHOTO_REQUIRED';
  end;
  assert raised, 'blank image fields do not count as a representative photo';

  -- An external catalog image counts as a representative image.
  result := public.change_pick(cat,external_photo,'외부 이미지 있음');
  assert result.status='active' and result.item_id=external_photo,
    'image_source_url is enough for a new Pick';

  -- Replacement is blocked before the current Pick is replaced.
  raised := false;
  begin
    perform public.change_pick(cat,no_photo_2,'사진 없는 것으로 변경');
  exception when others then
    raised := sqlerrm='PHOTO_REQUIRED';
  end;
  assert raised, 'replacement to a photo-less item is blocked';
  assert exists(
    select 1 from public.picks
    where id=result.id and status='active' and item_id=external_photo
  ), 'failed photo guard preserves the current Pick';
  reset role;

  -- Legacy photo-less current Pick: same-item review edits stay possible.
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at)
  values(legacy_pick,u_legacy,cat,no_photo,'legacy','active',now());

  perform set_config('request.jwt.claim.sub',u_legacy::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  result := public.change_pick(cat,no_photo,'legacy edited');
  assert result.id=legacy_pick and result.one_line_review='legacy edited',
    'same-item review edit remains allowed for a legacy photo-less Pick';
  reset role;

  -- Legacy register_pick route is covered because it delegates to change_pick_impl.
  perform set_config('request.jwt.claim.sub',u_register::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  raised := false;
  begin
    perform public.register_pick(cat,no_photo,'No photo','register route');
  exception when others then
    raised := sqlerrm='PHOTO_REQUIRED';
  end;
  assert raised, 'register_pick cannot create a photo-less Pick';
  reset role;
end;
$flow$;
$test$, 'new and replacement Picks require a photo while legacy same-item review edits remain available');

select ok(
  (select prosecdef from pg_proc where oid='private.change_pick_impl(uuid,uuid,text,text,text,text)'::regprocedure),
  'private change_pick implementation stays SECURITY DEFINER'
);

select ok(
  (select 'search_path=""'=any(proconfig)
   from pg_proc where oid='private.change_pick_impl(uuid,uuid,text,text,text,text)'::regprocedure),
  'private change_pick implementation keeps an empty search_path'
);

select ok(
  has_function_privilege('authenticated','private.change_pick_impl(uuid,uuid,text,text,text,text)','execute'),
  'authenticated keeps execute on the private implementation'
);

select ok(
  not has_function_privilege('anon','private.change_pick_impl(uuid,uuid,text,text,text,text)','execute'),
  'anon cannot execute the private implementation'
);

select ok(
  has_function_privilege('authenticated','public.change_pick(uuid,uuid,text,text,text,text)','execute'),
  'authenticated keeps execute on public change_pick'
);

select ok(
  not has_function_privilege('anon','public.change_pick(uuid,uuid,text,text,text,text)','execute'),
  'anon cannot execute public change_pick'
);

select ok(
  has_function_privilege('service_role','public.change_pick(uuid,uuid,text,text,text,text)','execute'),
  'service_role keeps execute on public change_pick'
);

select * from finish();
rollback;
