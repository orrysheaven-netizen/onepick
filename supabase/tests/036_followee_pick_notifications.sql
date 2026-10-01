begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  viewer uuid := gen_random_uuid(); friend uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  cat uuid := gen_random_uuid(); cat2 uuid := gen_random_uuid();
  product uuid := gen_random_uuid(); product2 uuid := gen_random_uuid(); product3 uuid := gen_random_uuid();
  pick1 uuid := gen_random_uuid(); pick2 uuid := gen_random_uuid(); pick3 uuid := gen_random_uuid();
  pick4 uuid := gen_random_uuid(); own_pick uuid := gen_random_uuid(); comment_id uuid := gen_random_uuid();
  n integer; kinds text[]; first_body text;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[viewer,friend,other]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'notif_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[viewer,friend,other]) id;
  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (cat,'Notify feed','notify-'||cat,'open',true,true),
    (cat2,'Notify feed 2','notify-'||cat2,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (product,cat,'First product','first product','active'),
    (product2,cat,'Second product','second product','active'),
    (product3,cat2,'Third product','third product','active');

  assert not has_function_privilege('anon','public.notification_page(timestamptz,uuid)','execute'), 'Guests cannot read the inbox';
  assert not has_function_privilege('anon','public.notification_count()','execute'), 'Guests cannot count the inbox';
  assert not (select prosecdef from pg_proc where oid='public.notification_page(timestamptz,uuid)'::regprocedure), 'Inbox runs under caller RLS';

  -- viewer follows friend.
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  insert into public.user_follows(follower_id,followee_id) values(viewer,friend);
  reset role;

  -- A pick written on the author's behalf (no session) does not notify.
  perform set_config('request.jwt.claim.sub','',true);
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at)
    values(pick1,friend,cat2,product3,'Seeded reason','active',now());
  select count(*) into n from public.pick_change_notifications;
  assert n=0, 'Seeded or admin-written picks do not notify followers';

  -- The author picks: every follower with the preference on gets one row.
  perform set_config('request.jwt.claim.sub',friend::text,true);
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at)
    values(pick2,friend,cat,product,'Friend reason','active',now());
  select count(*) into n from public.pick_change_notifications where pick_id=pick2 and recipient_id=viewer;
  assert n=1, 'Follower is notified when the author picks';
  select count(*) into n from public.pick_change_notifications where recipient_id=friend;
  assert n=0, 'The author never notifies themselves';

  -- Editing only the one-line review keeps status: no new notification, live text.
  perform set_config('request.jwt.claim.sub',friend::text,true);
  update public.picks set one_line_review='Edited reason', status='active' where id=pick2;
  select count(*) into n from public.pick_change_notifications where recipient_id=viewer;
  assert n=1, 'Review edits do not notify again';

  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  select count(*) into n from public.notification_count();
  assert (select public.notification_count())=1, 'Unread count includes pick changes';
  select body into first_body from public.notification_page() limit 1;
  assert first_body='Edited reason', 'Inbox reads the current review text, not a copy';
  assert (select kind from public.notification_page() limit 1)='pick_change', 'Kind identifies the row';
  reset role;

  -- A comment on the viewer's own pick lands in the same inbox, newest first.
  -- Age the earlier pick-change notification past the 15-minute dedupe window so
  -- the later real replacement is eligible to notify again.
  update public.pick_change_notifications set created_at=now()-interval '16 minutes' where pick_id=pick2;
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at)
    values(own_pick,viewer,cat,product,'Own reason','active',now());
  perform set_config('request.jwt.claim.sub',other::text,true);
  insert into public.comments(id,pick_id,user_id,body) values(comment_id,own_pick,other,'Nice pick');
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  select array_agg(kind order by created_at desc,id desc) into kinds from public.notification_page();
  assert kinds=array['comment','pick_change'], 'Both kinds interleave by time: '||array_to_string(kinds,',');
  assert (select public.notification_count())=2, 'Unread count spans both kinds';

  -- Mark the pick change read: count drops, row stays.
  update public.pick_change_notifications set read_at=now() where pick_id=pick2 and recipient_id=viewer;
  assert (select public.notification_count())=1, 'Read rows leave the unread count';
  select count(*) into n from public.notification_page() where read_at is not null;
  assert n=1, 'Read rows stay listed';

  -- Preference off: the next pick change is not delivered.
  insert into public.notification_preferences(user_id,followee_pick_change) values(viewer,false);
  reset role;
  perform set_config('request.jwt.claim.sub',friend::text,true);
  -- Ended over a day ago so re-picking the same item is past the 24-hour cooldown.
  update public.picks set status='replaced', started_at=now()-interval '26 hours', ended_at=now()-interval '25 hours' where id=pick1;
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at)
    values(pick3,friend,cat2,product3,'Switched reason','active',now());
  select count(*) into n from public.pick_change_notifications where pick_id=pick3;
  assert n=0, 'Opted-out followers receive nothing';

  -- Preference back on, then the author replaces the pick: the replaced row is hidden, the new one is shown.
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  update public.notification_preferences set followee_pick_change=true where user_id=viewer;
  reset role;
  perform set_config('request.jwt.claim.sub',friend::text,true);
  update public.picks set status='replaced', ended_at=now() where id=pick2;
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at)
    values(pick4,friend,cat,product2,'Replacement reason','active',now());
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  select count(*) into n from public.notification_page() where kind='pick_change' and pick_id=pick2;
  assert n=0, 'Notifications for a replaced pick disappear';
  select count(*) into n from public.notification_page() where kind='pick_change' and pick_id=pick4;
  assert n=1, 'The replacement pick notifies';
  reset role;

  -- Pending item approved later: status flips to active and followers hear about it then.
  perform set_config('request.jwt.claim.sub',friend::text,true);
  update public.picks set status='needs_review' where id=pick3;
  perform set_config('request.jwt.claim.sub','',true);
  update public.picks set status='active' where id=pick3;
  select count(*) into n from public.pick_change_notifications where pick_id=pick3 and recipient_id=viewer;
  assert n=1, 'Approval into active notifies without an author session';

  -- Other people cannot see the viewer's inbox rows.
  perform set_config('request.jwt.claim.sub',other::text,true);
  set local role authenticated;
  select count(*) into n from public.pick_change_notifications;
  assert n=0, 'Inbox rows are private to the recipient';
  reset role;

  -- Block: existing rows are hidden and the follow is gone, so nothing new arrives.
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot) values(viewer,friend,'x');
  select count(*) into n from public.notification_page() where kind='pick_change';
  assert n=0, 'Blocking hides every pick-change notification from that person';
  assert (select public.notification_count())=1, 'Only the comment remains unread';
  reset role;
end;
$flow$;
$test$, 'Followee pick-change notifications: fan-out rules, preference, unified inbox and visibility');
select * from finish();
rollback;
