begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  owner_id uuid := gen_random_uuid();
  author_id uuid := gen_random_uuid();
  third_id uuid := gen_random_uuid();
  category_id uuid := gen_random_uuid();
  item_id uuid := gen_random_uuid();
  pick_id uuid := gen_random_uuid();
  comment_id uuid := gen_random_uuid();
  own_comment_id uuid := gen_random_uuid();
  n integer;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[owner_id,author_id,third_id]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'notif_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[owner_id,author_id,third_id]) id;
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(category_id,'Notification test','notif-'||category_id,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status)
    values(item_id,category_id,'Notification item','notification item','active');
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status)
    values(pick_id,owner_id,category_id,item_id,'원픽','active');
  insert into public.picks(user_id,category_id,item_id,one_line_review,status)
    values(author_id,category_id,item_id,'같은 제품','active');

  perform set_config('request.jwt.claim.sub',author_id::text,true);
  set local role authenticated;
  insert into public.comments(id,pick_id,user_id,body) values(comment_id,pick_id,author_id,'새 댓글');
  assert public.comment_notification_count(author_id)=0, 'No notification to commenter';
  select count(*) into n from public.comment_notifications;
  assert n=0, 'Commenter cannot read recipient inbox';
  begin
    insert into public.comment_notifications(comment_id,recipient_id) values(own_comment_id,author_id);
    raise exception 'Client must not create notifications';
  exception when insufficient_privilege then null;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  assert public.comment_notification_count(owner_id)=1, 'Owner gets exactly one unread notification';
  assert public.comment_notification_count(author_id)=0, 'Explicit user filter prevents account-switch cache leakage';
  select count(*) into n from public.comment_notification_page(owner_id) page where page.body='새 댓글';
  assert n=1, 'Inbox resolves live comment body';
  -- A review author only replies on their own review; their reply still must not notify themselves.
  insert into public.comments(id,pick_id,user_id,body,parent_comment_id) values(own_comment_id,pick_id,owner_id,'내 댓글',comment_id);
  assert public.comment_notification_count(owner_id)=1, 'Self-comments excluded';
  update public.comment_notifications set read_at=now();
  assert public.comment_notification_count(owner_id)=0, 'Reading clears unread count';
  begin
    update public.comment_notifications set recipient_id=author_id;
    raise exception 'Recipient must be immutable';
  exception when insufficient_privilege then null;
  end;
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    values(owner_id,author_id,'placeholder');
  select count(*) into n from public.comment_notification_page(owner_id);
  assert n=0, 'Blocking removes notifications from inbox';
  delete from public.user_blocks where blocker_user_id=owner_id and blocked_user_id=author_id;

  reset role;
  perform set_config('request.jwt.claim.sub',third_id::text,true);
  set local role authenticated;
  select count(*) into n from public.comment_notifications;
  assert n=0, 'Third user cannot see notifications';
  update public.comment_notifications set read_at=null;
  get diagnostics n = row_count;
  assert n=0, 'Third user cannot change read state';

  reset role;
  perform set_config('request.jwt.claim.sub',author_id::text,true);
  set local role authenticated;
  update public.comments set body='수정한 댓글' where id=comment_id;
  reset role;
  select count(*) into n from public.comment_notifications cn where cn.comment_id=comment_id;
  assert n=1, 'Editing does not duplicate notifications';

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  select count(*) into n from public.comment_notification_page(owner_id) page where page.body='수정한 댓글';
  assert n=1, 'Inbox does not retain stale body snapshots';
  -- Remove the owner's reply first so deleting the comment below is a real
  -- delete, not a tombstone kept for its reply.
  delete from public.comments where id=own_comment_id;
  reset role;
  perform set_config('request.jwt.claim.sub',author_id::text,true);
  set local role authenticated;
  delete from public.comments where id=comment_id;
  reset role;
  select count(*) into n from public.comment_notifications cn where cn.comment_id=comment_id;
  assert n=0, 'Deleted comment cascades its notification';
  assert not has_table_privilege('anon','public.comment_notifications','SELECT'), 'No anonymous inbox access';
end;
$flow$;
$test$, 'Comment notifications: recipient isolation, self exclusion, read state, block, edit and deletion');
select * from finish();
rollback;
