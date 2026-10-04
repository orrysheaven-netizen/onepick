begin;
-- Photo-required Pick invariant: fixture default, rolled back with this test.
alter table public.items alter column image_source_url
  set default 'https://example.test/onepick-test-item.png';
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  viewer uuid := gen_random_uuid(); friend uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  cat uuid := gen_random_uuid(); item_x uuid := gen_random_uuid();
  viewer_pick uuid; friend_pick uuid; c_friend uuid; c_other uuid; c_viewer uuid; r_friend uuid;
  g jsonb;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[viewer,friend,other]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'ncp_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[viewer,friend,other]) id;
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(cat,'미리보기 알림','ncp-'||substr(replace(cat::text,'-',''),1,8),'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status) values (item_x,cat,'미리보기 제품','미리보기제품','active');

  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  viewer_pick := (public.change_pick(cat, item_x, '내 한줄평')).id;
  reset role;
  perform set_config('request.jwt.claim.sub',friend::text,true);
  set local role authenticated;
  friend_pick := (public.change_pick(cat, item_x, '친구 한줄평')).id;
  insert into public.comments(pick_id,user_id,body) values(viewer_pick, friend, '첫 댓글') returning id into c_friend;
  reset role;
  perform set_config('request.jwt.claim.sub',other::text,true);
  set local role authenticated;
  perform public.change_pick(cat, item_x, '다른 한줄평');
  insert into public.comments(pick_id,user_id,body) values(viewer_pick, other, repeat('가', 150)) returning id into c_other;
  reset role;
  -- The latest comment in the group is other's long one.
  update public.comment_notifications set created_at = now() + interval '1 minute' where comment_id = c_other;
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  insert into public.comments(pick_id,user_id,body) values(friend_pick, viewer, '내 댓글') returning id into c_viewer;
  reset role;
  perform set_config('request.jwt.claim.sub',friend::text,true);
  set local role authenticated;
  insert into public.comments(pick_id,user_id,body,parent_comment_id) values(friend_pick, friend, '답글이에요', c_viewer) returning id into r_friend;
  reset role;

  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  select r into g from public.notification_group_page() r where r->>'kind' = 'comment';
  assert g->>'preview' = repeat('가', 120), 'A comment group previews its latest comment, capped at 120 characters: '||coalesce(g->>'preview','null');
  select r into g from public.notification_group_page() r where r->>'kind' = 'reply';
  assert g->>'preview' = '답글이에요', 'A reply group previews the reply: '||coalesce(g->>'preview','null');
  select r into g from public.notification_group_page() r where r->>'kind' = 'pick_review';
  assert g ? 'preview' and g->'preview' = 'null'::jsonb, 'Other kinds carry no preview';
  reset role;

  -- A deleted latest comment drops out of the events; the group previews the one before it.
  perform set_config('request.jwt.claim.sub',other::text,true);
  update public.comments set deleted_at = now(), body = '' where id = c_other;
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  select r into g from public.notification_group_page() r where r->>'kind' = 'comment';
  assert g->>'preview' = '첫 댓글', 'Deleted comments are never previewed: '||coalesce(g->>'preview','null');
  reset role;
end;
$flow$;
$test$, 'Grouped notifications carry a one-line preview of the latest visible comment/reply');
select * from finish();
rollback;
