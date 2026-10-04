begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  owner_u uuid := gen_random_uuid();
  other_u uuid := gen_random_uuid();
  food_group uuid := gen_random_uuid();
  menu uuid := gen_random_uuid();
  item_x uuid := gen_random_uuid();
  owner_pick uuid := gen_random_uuid();
  other_pick uuid := gen_random_uuid();
  other_root uuid := gen_random_uuid();
  owner_legacy_root uuid := gen_random_uuid();
  raised boolean;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
  values
    (owner_u,'authenticated','authenticated',now(),now()),
    (other_u,'authenticated','authenticated',now(),now());

  insert into public.profiles(id,username,onboarding_completed)
  values
    (owner_u,'reply_only_owner',true),
    (other_u,'reply_only_other',true);

  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    select food_group, food.id, '작성자 답글 테스트', 'review-owner-reply-only-group', 'open', true, false, 990
    from public.categories food where food.slug='food';

  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
  values(menu, food_group, '작성자 답글 테스트 메뉴', 'review-owner-reply-only-menu', 'open', true, true, 990);

  insert into public.items(id,category_id,name,normalized_name,status,image_source_url)
  values(item_x, menu, '작성자 답글 테스트 매장', '작성자 답글 테스트 매장', 'active',
         'https://example.test/review-owner-reply-only.png');

  insert into public.picks(id,user_id,category_id,item_id,channel,one_line_review,status,started_at)
  values
    (owner_pick, owner_u, menu, item_x, 'offline', '내 한줄평', 'active', now() - interval '2 minutes'),
    (other_pick, other_u, menu, item_x, 'offline', '다른 사람 한줄평', 'active', now() - interval '1 minute');

  -- Review author: a new top-level comment is no longer allowed.
  perform set_config('request.jwt.claim.sub', owner_u::text, true);
  set local role authenticated;
  raised := false;
  begin
    insert into public.comments(pick_id,user_id,body)
    values(owner_pick, owner_u, '내 한줄평에 최상위 댓글');
  exception when others then
    raised := sqlerrm like '%row-level security%';
  end;
  assert raised, 'The review author cannot create a top-level comment on their own review';
  reset role;

  -- Another eligible member keeps the existing top-level write behavior.
  perform set_config('request.jwt.claim.sub', other_u::text, true);
  set local role authenticated;
  insert into public.comments(id,pick_id,user_id,body)
  values(other_root, owner_pick, other_u, '다른 사람의 최상위 댓글');

  -- Non-authors also keep the existing ability to reply to their own root comment.
  insert into public.comments(pick_id,user_id,body,parent_comment_id)
  values(owner_pick, other_u, '내 댓글에 답글', other_root);
  reset role;

  -- The review author may reply to the other member's live root comment.
  perform set_config('request.jwt.claim.sub', owner_u::text, true);
  set local role authenticated;
  insert into public.comments(pick_id,user_id,body,parent_comment_id)
  values(owner_pick, owner_u, '다른 사람 댓글에 답글', other_root);
  reset role;

  -- Simulate a pre-migration owner root comment (seeded without RLS; the
  -- write-limit trigger still needs the author as auth.uid()). The author
  -- still must not be able to reply to their own root after the new rule.
  perform set_config('request.jwt.claim.sub', owner_u::text, true);
  insert into public.comments(id,pick_id,user_id,body)
  values(owner_legacy_root, owner_pick, owner_u, '기존 작성자 최상위 댓글');

  perform set_config('request.jwt.claim.sub', owner_u::text, true);
  set local role authenticated;
  raised := false;
  begin
    insert into public.comments(pick_id,user_id,body,parent_comment_id)
    values(owner_pick, owner_u, '내 댓글에 답글', owner_legacy_root);
  exception when others then
    raised := sqlerrm like '%row-level security%';
  end;
  assert raised, 'The review author cannot reply to their own top-level comment';
  reset role;

  assert not has_function_privilege(
    'anon',
    'private.comment_insert_allowed(uuid,uuid,uuid)',
    'execute'
  ), 'Guests cannot execute the policy helper';
end;
$flow$;
$test$, 'review author is reply-only on own review while non-author comment behavior stays unchanged');

select * from finish();
rollback;
