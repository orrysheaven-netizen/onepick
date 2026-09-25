begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('f9a00000-0000-4000-8000-000000000001','authenticated','authenticated','quota-suspended@example.invalid','',now(),now()),
  ('f9a00000-0000-4000-8000-000000000002','authenticated','authenticated','quota-active@example.invalid','',now(),now());

insert into public.profiles(id,username,onboarding_completed) values
  ('f9a00000-0000-4000-8000-000000000001','quota_suspended',true),
  ('f9a00000-0000-4000-8000-000000000002','quota_active',true);

insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
  ('f9a10000-0000-4000-8000-000000000001','보안 QA 분류 대상','security-qa-classify','open',true,true);
insert into public.category_catalog_sources(category_id,mode,is_enabled,notes) values
  ('f9a10000-0000-4000-8000-000000000001','internal',true,'Security QA classify fixture');

-- Pending items created before the suspension takes effect.
insert into public.items(id,category_id,name,normalized_name,status,created_by)
select v.id, c.id, v.name, v.normalized_name, 'pending', v.created_by
from public.categories c
cross join (values
  ('f9a20000-0000-4000-8000-000000000001'::uuid,'정지 전 요청','정지전요청','f9a00000-0000-4000-8000-000000000001'::uuid),
  ('f9a20000-0000-4000-8000-000000000002'::uuid,'정상 요청','정상요청','f9a00000-0000-4000-8000-000000000002'::uuid)
) as v(id,name,normalized_name,created_by)
where c.slug='pending-product';

insert into private.user_moderation(user_id,reason,suspended_at)
values('f9a00000-0000-4000-8000-000000000001','Security QA suspended quota fixture',now());

-- Suspended caller: item requests and quota reservations are refused.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','f9a00000-0000-4000-8000-000000000001',
    'role','authenticated',
    'aal','aal1'
  )::text,
  true
);
select set_config('request.jwt.claim.sub','f9a00000-0000-4000-8000-000000000001',true);

select throws_ok(
  $$select public.submit_unclassified_item('정지 사용자 신규 요청')$$,
  '42501','USER_SUSPENDED',
  'suspended user cannot request an unclassified item'
);

select throws_ok(
  $$select public.set_pending_item_category_hint(
    'f9a20000-0000-4000-8000-000000000001',
    '텀블러'
  )$$,
  '42501','USER_SUSPENDED',
  'suspended user cannot edit a pending item category hint'
);

select throws_ok(
  $$select public.classify_pending_item(
    'f9a20000-0000-4000-8000-000000000001',
    'f9a10000-0000-4000-8000-000000000001'
  )$$,
  '42501','USER_SUSPENDED',
  'suspended user cannot classify a pending item'
);

select throws_ok(
  $$select public.consume_image_import()$$,
  '42501','USER_SUSPENDED',
  'suspended user cannot reserve an image import'
);

reset role;
set local role service_role;

select throws_ok(
  $$select public.reserve_profile_ai_generation('f9a00000-0000-4000-8000-000000000001')$$,
  '42501','USER_SUSPENDED',
  'profile AI generation is not reserved for a suspended user'
);

select throws_ok(
  $$select public.reserve_item_category_ai_generation('f9a00000-0000-4000-8000-000000000001')$$,
  '42501','USER_SUSPENDED',
  'item category AI generation is not reserved for a suspended user'
);

select ok(
  public.reserve_profile_ai_generation('f9a00000-0000-4000-8000-000000000002'),
  'profile AI generation is still reserved for an active user'
);

select ok(
  public.reserve_item_category_ai_generation('f9a00000-0000-4000-8000-000000000002'),
  'item category AI generation is still reserved for an active user'
);

reset role;

-- Active caller: the same paths keep working.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub','f9a00000-0000-4000-8000-000000000002',
    'role','authenticated',
    'aal','aal1'
  )::text,
  true
);
select set_config('request.jwt.claim.sub','f9a00000-0000-4000-8000-000000000002',true);

select lives_ok(
  $$select public.submit_unclassified_item('정상 사용자 신규 요청')$$,
  'active user can still request an unclassified item'
);

select lives_ok(
  $$select public.set_pending_item_category_hint(
    'f9a20000-0000-4000-8000-000000000002',
    '텀블러'
  )$$,
  'active user can still edit a pending item category hint'
);

select lives_ok(
  $$select public.classify_pending_item(
    'f9a20000-0000-4000-8000-000000000002',
    'f9a10000-0000-4000-8000-000000000001'
  )$$,
  'active user can still classify a pending item'
);

select lives_ok(
  $$select public.consume_image_import()$$,
  'active user can still reserve an image import'
);

reset role;

select * from finish();
rollback;
