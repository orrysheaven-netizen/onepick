begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id,aud,role,email,encrypted_password,created_at,updated_at)
values
  ('f9920000-0000-4000-8000-000000000001','authenticated','authenticated','comment-owner-sec@example.invalid','',now(),now()),
  ('f9920000-0000-4000-8000-000000000002','authenticated','authenticated','comment-author-sec@example.invalid','',now(),now()),
  ('f9920000-0000-4000-8000-000000000003','authenticated','authenticated','comment-other-sec@example.invalid','',now(),now());

insert into public.profiles(id,username,onboarding_completed) values
  ('f9920000-0000-4000-8000-000000000001','comment_owner_sec',true),
  ('f9920000-0000-4000-8000-000000000002','comment_author_sec',true),
  ('f9920000-0000-4000-8000-000000000003','comment_other_sec',true);

insert into public.categories(id,name,slug,status,is_visible,is_pickable)
values('f9930000-0000-4000-8000-000000000001','댓글 권한 테스트','comment-update-sec','open',true,true);

insert into public.items(id,category_id,name,normalized_name,status) values
  ('f9940000-0000-4000-8000-000000000001','f9930000-0000-4000-8000-000000000001','댓글 제품 A','댓글제품a','active'),
  ('f9940000-0000-4000-8000-000000000002','f9930000-0000-4000-8000-000000000001','댓글 제품 B','댓글제품b','active');

set local role authenticated;
select set_config('request.jwt.claim.sub','f9920000-0000-4000-8000-000000000001',true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub','f9920000-0000-4000-8000-000000000001','role','authenticated','aal','aal1')::text,
  true
);
select public.change_pick(
  'f9930000-0000-4000-8000-000000000001',
  'f9940000-0000-4000-8000-000000000001',
  '댓글 권한 원픽'
);

create temporary table comment_update_pick_a as
select id as pick_id
from public.picks
where user_id='f9920000-0000-4000-8000-000000000001'
  and status='active';

select set_config('request.jwt.claim.sub','f9920000-0000-4000-8000-000000000003',true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub','f9920000-0000-4000-8000-000000000003','role','authenticated','aal','aal1')::text,
  true
);
select public.change_pick(
  'f9930000-0000-4000-8000-000000000001',
  'f9940000-0000-4000-8000-000000000002',
  '다른 원픽'
);

create temporary table comment_update_pick_b as
select id as pick_id
from public.picks
where user_id='f9920000-0000-4000-8000-000000000003'
  and status='active';

select set_config('request.jwt.claim.sub','f9920000-0000-4000-8000-000000000002',true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub','f9920000-0000-4000-8000-000000000002','role','authenticated','aal','aal1')::text,
  true
);

select public.change_pick(
  'f9930000-0000-4000-8000-000000000001',
  'f9940000-0000-4000-8000-000000000001',
  '같은 제품 원픽'
);

insert into public.comments(id,pick_id,user_id,body)
select
  'f9950000-0000-4000-8000-000000000001',
  pick_id,
  'f9920000-0000-4000-8000-000000000002',
  '원래 댓글'
from comment_update_pick_a;

select ok(
  has_column_privilege('authenticated','public.comments','body','update'),
  'authenticated may update comment body'
);
select ok(
  not has_column_privilege('authenticated','public.comments','user_id','update'),
  'authenticated cannot rewrite comment author'
);
select ok(
  not has_column_privilege('authenticated','public.comments','pick_id','update'),
  'authenticated cannot move a comment to another pick'
);
select ok(
  not has_column_privilege('authenticated','public.comments','created_at','update'),
  'authenticated cannot rewrite comment creation time'
);
select ok(
  not has_column_privilege('authenticated','public.comments','updated_at','update'),
  'authenticated cannot directly rewrite comment updated_at'
);
select ok(
  not has_column_privilege('authenticated','public.comments','id','update'),
  'authenticated cannot rewrite comment id'
);

select lives_ok(
  $$update public.comments
    set body='수정된 댓글'
    where id='f9950000-0000-4000-8000-000000000001'$$,
  'comment author can still edit body'
);

select is(
  (
    select body
    from public.comments
    where id='f9950000-0000-4000-8000-000000000001'
  ),
  '수정된 댓글',
  'body edit is persisted'
);

select throws_ok(
  $$update public.comments
    set user_id='f9920000-0000-4000-8000-000000000003'
    where id='f9950000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'comment author cannot change ownership'
);

select throws_ok(
  $$update public.comments
    set pick_id=(select pick_id from comment_update_pick_b)
    where id='f9950000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'comment author cannot move comment to another pick'
);

select throws_ok(
  $$update public.comments
    set created_at='2000-01-01T00:00:00Z'
    where id='f9950000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'comment author cannot rewrite created_at'
);

select throws_ok(
  $$update public.comments
    set updated_at='2000-01-01T00:00:00Z'
    where id='f9950000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'comment author cannot directly rewrite updated_at'
);

reset role;

select * from finish();
rollback;
