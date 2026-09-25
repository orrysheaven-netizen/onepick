begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('f9800000-0000-4000-8000-000000000001','authenticated','authenticated','suspended@example.invalid','',now(),now()),
  ('f9800000-0000-4000-8000-000000000002','authenticated','authenticated','active@example.invalid','',now(),now()),
  ('f9800000-0000-4000-8000-000000000003','authenticated','authenticated','target-a@example.invalid','',now(),now()),
  ('f9800000-0000-4000-8000-000000000004','authenticated','authenticated','target-b@example.invalid','',now(),now()),
  ('f9800000-0000-4000-8000-000000000005','authenticated','authenticated','target-c@example.invalid','',now(),now());

insert into public.profiles(id,username,onboarding_completed) values
  ('f9800000-0000-4000-8000-000000000001','suspended_qa',true),
  ('f9800000-0000-4000-8000-000000000002','active_qa',true),
  ('f9800000-0000-4000-8000-000000000003','target_qa_a',true),
  ('f9800000-0000-4000-8000-000000000004','target_qa_b',true),
  ('f9800000-0000-4000-8000-000000000005','target_qa_c',true);

insert into private.user_moderation(user_id,reason,suspended_at)
values('f9800000-0000-4000-8000-000000000001','Security QA suspended actor fixture',now());

insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
  ('f9810000-0000-4000-8000-000000000001','보안 QA 상품','security-qa-item','open',true,true),
  ('f9810000-0000-4000-8000-000000000002','보안 QA 장소','security-qa-place','open',true,true);

insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes) values
  ('f9810000-0000-4000-8000-000000000002','internal',true,true,'Security QA place fixture');

insert into public.place_catalog(
  id,place_provider,provider_place_id,name,normalized_name,road_address,
  region_1,region_2,business_status,source_updated_at
) values (
  'f9820000-0000-4000-8000-000000000001','securityqa','place-1',
  '보안테스트식당','보안테스트식당','서울 테스트구 원픽로 1',
  '서울','테스트구','open',now()
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.submit_item_impl(uuid,text,text,text,text)',
    'execute'
  ),
  'authenticated cannot bypass the public suspended-user guard for item submission'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.select_place_catalog_item_impl(uuid,uuid)',
    'execute'
  ),
  'authenticated cannot bypass the public suspended-user guard for place selection'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','f9800000-0000-4000-8000-000000000001',
    'role','authenticated',
    'aal','aal1'
  )::text,
  true
);
select set_config('request.jwt.claim.sub','f9800000-0000-4000-8000-000000000001',true);

select throws_ok(
  $$select public.submit_item(
    'f9810000-0000-4000-8000-000000000001',
    '정지 사용자 상품'
  )$$,
  '42501','USER_SUSPENDED',
  'suspended user cannot submit an item'
);

select throws_ok(
  $$select public.select_place_catalog_item(
    'f9810000-0000-4000-8000-000000000002',
    'f9820000-0000-4000-8000-000000000001'
  )$$,
  '42501','USER_SUSPENDED',
  'suspended user cannot select a place catalog item'
);

select throws_ok(
  $$insert into public.user_follows(follower_id,followee_id)
    values(
      'f9800000-0000-4000-8000-000000000001',
      'f9800000-0000-4000-8000-000000000003'
    )$$,
  '42501','USER_SUSPENDED',
  'suspended user cannot follow'
);

select throws_ok(
  $$insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    values(
      'f9800000-0000-4000-8000-000000000001',
      'f9800000-0000-4000-8000-000000000004',
      'ignored'
    )$$,
  '42501','USER_SUSPENDED',
  'suspended user cannot block'
);

select throws_ok(
  $$insert into public.content_reports(
      reporter_user_id,target_type,target_id,reason
    ) values(
      'f9800000-0000-4000-8000-000000000001',
      'profile',
      'f9800000-0000-4000-8000-000000000005',
      'spam'
    )$$,
  '42501','USER_SUSPENDED',
  'suspended user cannot report content'
);

select throws_ok(
  $$update public.profiles
    set bio='정지 중 수정'
    where id='f9800000-0000-4000-8000-000000000001'$$,
  '42501','USER_SUSPENDED',
  'suspended user cannot update their profile'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','f9800000-0000-4000-8000-000000000002',
    'role','authenticated',
    'aal','aal1'
  )::text,
  true
);
select set_config('request.jwt.claim.sub','f9800000-0000-4000-8000-000000000002',true);

select lives_ok(
  $$select public.submit_item(
    'f9810000-0000-4000-8000-000000000001',
    '정상 사용자 상품'
  )$$,
  'active user can still submit an item'
);

select lives_ok(
  $$select public.select_place_catalog_item(
    'f9810000-0000-4000-8000-000000000002',
    'f9820000-0000-4000-8000-000000000001'
  )$$,
  'active user can still select a place catalog item'
);

select lives_ok(
  $$insert into public.user_follows(follower_id,followee_id)
    values(
      'f9800000-0000-4000-8000-000000000002',
      'f9800000-0000-4000-8000-000000000003'
    )$$,
  'active user can still follow'
);

select lives_ok(
  $$insert into public.content_reports(
      reporter_user_id,target_type,target_id,reason
    ) values(
      'f9800000-0000-4000-8000-000000000002',
      'profile',
      'f9800000-0000-4000-8000-000000000004',
      'spam'
    )$$,
  'active user can still report content'
);

select lives_ok(
  $$insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    values(
      'f9800000-0000-4000-8000-000000000002',
      'f9800000-0000-4000-8000-000000000005',
      'ignored'
    )$$,
  'active user can still block'
);

select lives_ok(
  $$update public.profiles
    set bio='정상 사용자 수정'
    where id='f9800000-0000-4000-8000-000000000002'$$,
  'active user can still update their profile'
);

reset role;

select * from finish();
rollback;
