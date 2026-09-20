begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','authenticated','authenticated','ai-category-a@example.com','',now(),now()),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','authenticated','authenticated','ai-category-b@example.com','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ai_category_a',true),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ai_category_b',true);

insert into public.categories(
  id,parent_id,name,slug,status,is_visible,is_pickable
)
values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  (select id from public.categories where slug='tech'),
  'AI 분류 미연결',
  'ai-classification-unmapped',
  'open',true,true
);

insert into public.items(
  id,category_id,name,normalized_name,status
)
values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  (select id from public.categories where slug='keyboard'),
  'AI 중복 키보드',
  'ai중복키보드',
  'active'
);

select ok(
  not has_function_privilege('anon','public.classify_pending_item(uuid,uuid)','execute'),
  'anonymous users cannot apply a category'
);
select ok(
  has_function_privilege('authenticated','public.classify_pending_item(uuid,uuid)','execute'),
  'signed-in users can call the guarded apply wrapper'
);
select ok(
  not has_table_privilege('authenticated','public.item_category_ai_suggestions','select'),
  'AI category cache is not directly readable by signed-in clients'
);
select ok(
  (select relrowsecurity from pg_class where oid='public.item_category_ai_suggestions'::regclass),
  'AI category cache has RLS enabled'
);
select ok(
  not (select prosecdef from pg_proc where oid='public.classify_pending_item(uuid,uuid)'::regprocedure),
  'public category apply endpoint remains SECURITY INVOKER'
);
select ok(
  not (select prosecdef from pg_proc where oid='public.admin_review_pending_item(uuid,text,uuid)'::regprocedure),
  'public admin review endpoint remains SECURITY INVOKER'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
create temporary table ai_category_first as
select id as item_id
from public.submit_unclassified_item('AI 분류 테스트 키보드');

reset role;
insert into public.item_category_ai_suggestions(
  item_id,user_id,item_name,category_fingerprint,payload,model_name,prompt_version
)
select
  item_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'AI 분류 테스트 키보드',
  'fixture-fingerprint',
  '{"suggestions":[],"needsNewCategory":false}'::jsonb,
  'fixture-model',
  'fixture-prompt'
from ai_category_first;

set local role authenticated;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
select throws_ok(
  $$select public.classify_pending_item(
    (select item_id from ai_category_first),
    (select id from public.categories where slug='keyboard')
  )$$,
  'P0001','ITEM_NOT_FOUND',
  'another user cannot classify someone else''s pending product'
);

select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select throws_ok(
  $$select public.classify_pending_item(
    (select item_id from ai_category_first),
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  )$$,
  'P0001','CATEGORY_NOT_PICKABLE',
  'a pickable category without an enabled internal catalog source is rejected'
);

create temporary table ai_category_first_result as
select public.classify_pending_item(
  (select item_id from ai_category_first),
  (select id from public.categories where slug='keyboard')
) as result;

reset role;
select is(
  (select result->>'type' from ai_category_first_result),
  'classified',
  'explicit user apply assigns the selected existing category'
);
select is(
  (select c.slug from public.items i join public.categories c on c.id=i.category_id
   where i.id=(select item_id from ai_category_first)),
  'keyboard',
  'classified item now points at the user-selected category'
);
select is(
  (select status from public.items where id=(select item_id from ai_category_first)),
  'pending',
  'category selection does not bypass administrator approval'
);
select is(
  (select count(*)::int from public.item_category_ai_suggestions
   where item_id=(select item_id from ai_category_first)),
  0,
  'applying a category clears the cached AI suggestion'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
create temporary table ai_category_duplicate as
select id as item_id
from public.submit_unclassified_item('AI 중복 키보드');

create temporary table ai_category_duplicate_result as
select public.classify_pending_item(
  (select item_id from ai_category_duplicate),
  (select id from public.categories where slug='keyboard')
) as result;

reset role;
select is(
  (select result->>'type' from ai_category_duplicate_result),
  'existing_item',
  'matching approved products resolve to the existing product instead of creating a duplicate'
);
select is(
  (select result->>'itemId' from ai_category_duplicate_result),
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'duplicate classification returns the existing product id'
);
select is(
  (select status from public.items where id=(select item_id from ai_category_duplicate)),
  'merged',
  'the staged duplicate is marked merged'
);
select is(
  (select merged_into_item_id::text from public.items where id=(select item_id from ai_category_duplicate)),
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'the staged duplicate points to the existing product'
);

select * from finish();
rollback;
