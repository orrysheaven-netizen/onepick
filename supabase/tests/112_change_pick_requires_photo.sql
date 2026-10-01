begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  member uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  with_photo uuid := gen_random_uuid();
  without_photo uuid := gen_random_uuid();
  first_pick uuid;
  raised boolean;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
  values(member,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed)
  values(member,'photo_guard_'||substr(replace(member::text,'-',''),1,8),true);

  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
  values(category,'사진 필수 테스트','photo-guard-'||substr(replace(category::text,'-',''),1,8),'open',true,true);

  insert into public.items(id,category_id,name,normalized_name,status,image_source_url) values
    (with_photo,category,'사진 있음','사진있음','active','https://example.invalid/with.jpg'),
    (without_photo,category,'사진 없음','사진없음','active',null);

  perform set_config('request.jwt.claim.sub',member::text,true);
  set local role authenticated;

  first_pick := (public.change_pick(category,with_photo,'첫 원픽')).id;
  assert first_pick is not null, 'photo-backed item can become a Pick';

  -- Simulate a legacy Pick whose item photo disappears later. Updating the same
  -- Pick remains allowed because it does not create a new current Pick.
  reset role;
  update public.items
  set image_source_url=null, image_path=null, thumbnail_path=null
  where id=with_photo;
  set local role authenticated;

  assert (public.change_pick(category,with_photo,'한줄평 수정')).id = first_pick,
    'legacy photo-less current Pick may still update its review';

  raised := false;
  begin
    perform public.change_pick(category,without_photo,'사진 없는 새 원픽');
  exception when others then
    raised := sqlerrm = 'PHOTO_REQUIRED';
  end;
  assert raised, 'a new/replacement Pick without a photo is rejected';

  reset role;
  update public.items
  set image_source_url='https://example.invalid/now-has.jpg'
  where id=without_photo;
  set local role authenticated;

  assert (public.change_pick(category,without_photo,'사진 등록 후 변경')).item_id = without_photo,
    'the replacement succeeds after the item has a photo';

  assert (select prosecdef from pg_proc where oid='private.change_pick_impl(uuid,uuid,text,text,text,text)'::regprocedure),
    'private change_pick implementation remains SECURITY DEFINER';
  assert has_function_privilege('authenticated','public.change_pick(uuid,uuid,text,text,text,text)','execute'),
    'authenticated callers keep change_pick execute privilege';
  assert not has_function_privilege('anon','public.change_pick(uuid,uuid,text,text,text,text)','execute'),
    'anonymous callers still cannot execute change_pick';

  reset role;
end;
$flow$;
$test$, 'change_pick requires a photo for new/replacement Picks while legacy same-item edits remain allowed');

select * from finish();
rollback;
