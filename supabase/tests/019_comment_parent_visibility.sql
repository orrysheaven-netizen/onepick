begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  owner_id uuid := gen_random_uuid(); author_id uuid := gen_random_uuid(); admin_id uuid := gen_random_uuid();
  category_id uuid := gen_random_uuid(); item_id uuid := gen_random_uuid(); pick_id uuid := gen_random_uuid();
  comment_id uuid := gen_random_uuid(); n integer;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[owner_id,author_id,admin_id]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'block_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[owner_id,author_id,admin_id]) id;
  insert into private.admin_users(user_id) values(admin_id);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(category_id,'Block test','block-'||category_id,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status)
    values(item_id,category_id,'Block item','block item','active');
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status)
    values(pick_id,owner_id,category_id,item_id,'원픽','active');
  perform set_config('request.jwt.claim.sub',author_id::text,true);
  set local role authenticated;
  insert into public.comments(id,pick_id,user_id,body) values(comment_id,pick_id,author_id,'새 댓글');
  select count(*) into n from public.comments c where c.id=comment_id;
  assert n=1, 'Author sees own comment on visible pick';
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot) values(author_id,owner_id,'placeholder');
  select count(*) into n from public.comments c where c.id=comment_id;
  assert n=0, 'Own comment must not bypass author blocking pick owner';
  delete from public.user_blocks where blocker_user_id=author_id and blocked_user_id=owner_id;
  reset role;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  assert public.comment_notification_count(owner_id)=1, 'Visible comment notifies pick owner';
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot) values(owner_id,author_id,'placeholder');
  assert public.comment_notification_count(owner_id)=0, 'Blocked comment is hidden in notification count';
  reset role;
  perform set_config('request.jwt.claim.sub',author_id::text,true);
  set local role authenticated;
  select count(*) into n from public.comments c where c.id=comment_id;
  assert n=0, 'Own comment must not bypass pick owner blocking author';
  reset role;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  set local role authenticated;
  select count(*) into n from public.comments c where c.id=comment_id;
  assert n=1, 'Moderators retain access to reported comments';
  reset role;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  delete from public.user_blocks where blocker_user_id=owner_id and blocked_user_id=author_id;
  reset role;
  insert into private.user_moderation(user_id,reason) values(author_id,'Synthetic suspension');
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  assert public.comment_notification_count(owner_id)=0, 'Suspended author comments stay out of notifications';
  reset role;
  perform set_config('request.jwt.claim.sub',author_id::text,true);
  set local role authenticated;
  select count(*) into n from public.comments c where c.id=comment_id;
  assert n=1, 'Suspended author can review own comment on still-visible pick';
  delete from public.comments c where c.id=comment_id;
  get diagnostics n = row_count;
  assert n=1, 'Suspended author can remove own comment';
  reset role;
  select count(*) into n from public.comment_notifications cn where cn.comment_id=comment_id;
  assert n=0, 'Removed comment deletes its notification';
end;
$flow$;
$test$, 'Own comments respect parent Pick block visibility without losing moderation or removal');
select * from finish();
rollback;