begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  viewer uuid := gen_random_uuid(); friend uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  blocked_u uuid := gen_random_uuid(); late uuid := gen_random_uuid(); admin uuid := gen_random_uuid();
  cat uuid := gen_random_uuid(); item_x uuid := gen_random_uuid(); item_y uuid := gen_random_uuid();
  req_fix uuid := gen_random_uuid(); req_ok uuid := gen_random_uuid();
  viewer_pick uuid; friend_pick uuid; c_friend uuid; c_other uuid; c_viewer uuid; r_friend uuid;
  groups jsonb[]; g jsonb; kinds text[]; ids text[]; n integer; marked integer; raised boolean;
  review_group text; snapshot timestamptz;
begin
  assert not has_function_privilege('anon','public.notification_group_page(timestamptz,text,integer)','execute'), 'Guests have no inbox';
  assert not has_function_privilege('anon','public.notification_unread_count()','execute'), 'Guests have no badge';
  assert not has_function_privilege('anon','public.mark_notification_group_read(text,timestamptz)','execute'), 'Guests mark nothing';

  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[viewer,friend,other,blocked_u,late,admin]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'gni_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[viewer,friend,other,blocked_u,late,admin]) id;
  insert into private.admin_users(user_id) values(admin);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(cat,'그룹 알림','gni-'||substr(replace(cat::text,'-',''),1,8),'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (item_x,cat,'그룹 제품 X','그룹제품x','active'),
    (item_y,cat,'그룹 제품 Y','그룹제품y','active');
  insert into public.items(id,category_id,name,normalized_name,status,created_by) values
    (req_fix,cat,'고칠 요청','고칠요청','pending',viewer),
    (req_ok,cat,'통과 요청','통과요청','pending',viewer);

  -- viewer follows friend, blocks blocked_u, and holds X.
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  insert into public.user_follows(follower_id,followee_id) values(viewer,friend);
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    select viewer, blocked_u, username from public.profiles where id=blocked_u;
  viewer_pick := (public.change_pick(cat, item_x, 'X가 최고')).id;
  reset role;

  -- friend, other and blocked_u also pick X: two 내 원픽 새 한줄평 events for the viewer
  -- (the blocked member's never lands), and friend's Pick is also 팔로잉 원픽.
  perform set_config('request.jwt.claim.sub',friend::text,true);
  set local role authenticated;
  friend_pick := (public.change_pick(cat, item_x, '나도 X')).id;
  reset role;
  perform set_config('request.jwt.claim.sub',other::text,true);
  set local role authenticated;
  perform public.change_pick(cat, item_x, '저도 X');
  reset role;
  perform set_config('request.jwt.claim.sub',blocked_u::text,true);
  set local role authenticated;
  perform public.change_pick(cat, item_x, '차단된 사람');
  reset role;
  assert (select count(*) from public.pick_review_notifications where recipient_id=viewer) = 2, 'Two holders of X notified the viewer; the blocked one did not';
  assert (select count(*) from public.pick_review_notifications where recipient_id=friend) = 2, 'friend hears about other and blocked_u (no block between them)';

  -- Comments on the viewer's review by friend and other; a reply to the viewer's
  -- own comment under friend's review.
  perform set_config('request.jwt.claim.sub',friend::text,true);
  set local role authenticated;
  insert into public.comments(pick_id,user_id,body) values(viewer_pick, friend, '동의') returning id into c_friend;
  reset role;
  perform set_config('request.jwt.claim.sub',other::text,true);
  set local role authenticated;
  insert into public.comments(pick_id,user_id,body) values(viewer_pick, other, '저도요') returning id into c_other;
  reset role;
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  insert into public.comments(pick_id,user_id,body) values(friend_pick, viewer, '반가워요') returning id into c_viewer;
  reset role;
  perform set_config('request.jwt.claim.sub',friend::text,true);
  set local role authenticated;
  insert into public.comments(pick_id,user_id,body,parent_comment_id) values(friend_pick, friend, '저도요!', c_viewer) returning id into r_friend;
  reset role;

  -- One request rejected (수정 필요), one approved (never an event).
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  perform public.admin_review_pending_item(req_fix,'rejected',null,'지도 링크가 필요해요');
  perform public.admin_review_pending_item(req_ok,'active');
  reset role;
  assert (select outcome from public.item_review_notifications where item_id=req_ok and recipient_id=viewer) = 'approved', 'The approval row exists but is not an event';

  -- ------------------------------------------------------------ the viewer's grouped inbox
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  assert (select public.notification_unread_count()) = 7,
    'Badge: 2 pick_review + 2 comment + 1 reply + 1 followee_pick + 1 fix_needed, no approval: '||(select public.notification_unread_count());
  select array_agg(r) into groups from public.notification_group_page() r;
  assert array_length(groups,1) = 5, 'Five groups: '||array_length(groups,1);
  select array_agg(r->>'kind' order by r->>'kind') into kinds from public.notification_group_page() r;
  assert kinds = array['comment','fix_needed','followee_pick','pick_review','reply'], 'One group per kind here: '||kinds::text;

  select r into g from public.notification_group_page() r where r->>'kind' = 'pick_review';
  review_group := g->>'group_id';
  assert review_group = 'review:'||item_x::text||':' and (g->>'actor_count')::int = 2 and (g->>'unread_count')::int = 2
    and (g->>'total_count')::int = 2 and (g->'target'->>'item_id')::uuid = item_x and g->'target'->>'item_name' = '그룹 제품 X'
    and g->'actor'->>'user_id' in (friend::text, other::text) and g->>'snapshot' = g->>'latest_at',
    'The product group: two people, both unread, the latest actor and the product: '||g::text;
  select r into g from public.notification_group_page() r where r->>'kind' = 'comment';
  assert g->>'group_id' = 'comment:'||viewer_pick::text and (g->>'actor_count')::int = 2 and (g->'target'->>'pick_id')::uuid = viewer_pick,
    'Comments on my review group by the review: '||g::text;
  select r into g from public.notification_group_page() r where r->>'kind' = 'reply';
  assert g->>'group_id' = 'reply:'||c_viewer::text and (g->'target'->>'root_comment_id')::uuid = c_viewer
    and (g->'target'->>'comment_id')::uuid = r_friend and (g->'target'->>'pick_id')::uuid = friend_pick,
    'Replies group by my comment and point at the reply: '||g::text;
  select r into g from public.notification_group_page() r where r->>'kind' = 'followee_pick';
  assert g->>'group_id' = 'follow:'||friend::text||':'||cat::text||':' and (g->'target'->>'user_id')::uuid = friend
    and (g->'target'->>'pick_id')::uuid = friend_pick and (g->'target'->>'category_id')::uuid = cat,
    'Followee Picks group by person + menu + channel: '||g::text;
  select r into g from public.notification_group_page() r where r->>'kind' = 'fix_needed';
  assert g->>'group_id' = 'fix:'||req_fix::text and g->>'reason' = '지도 링크가 필요해요' and g->'actor' = 'null'::jsonb
    and (g->'target'->>'item_id')::uuid = req_fix,
    'Fix-needed groups by the request and carries the reason: '||g::text;
  assert not exists (select 1 from public.notification_group_page() r where r->>'group_id' like 'fix:'||req_ok::text), 'Approved requests are not listed';

  -- Paging: two pages of three cover all five groups once.
  select array_agg(r->>'group_id' order by ord) into ids from public.notification_group_page(p_limit => 3) with ordinality as t(r, ord);
  select r into g from public.notification_group_page(p_limit => 3) with ordinality as t(r, ord) where ord = 3;
  select ids || array_agg(r->>'group_id' order by ord) into ids
    from public.notification_group_page((g->>'latest_at')::timestamptz, g->>'group_id', 3) with ordinality as t(r, ord);
  assert array_length(ids,1) = 5 and (select count(distinct x) from unnest(ids) x) = 5, 'Keyset paging walks every group once: '||ids::text;
  raised := false;
  begin
    perform public.notification_group_page(now(), null);
  exception when sqlstate '22023' then raised := true; end;
  assert raised, 'Half a cursor is rejected';

  -- Reading: only up to the snapshot. A newer event in the same group stays unread.
  select (r->>'snapshot')::timestamptz into snapshot from public.notification_group_page() r where r->>'group_id' = review_group;
  reset role;
  perform set_config('request.jwt.claim.sub',late::text,true);
  set local role authenticated;
  perform public.change_pick(cat, item_x, '늦게 X');
  reset role;
  update public.pick_review_notifications set created_at = snapshot + interval '1 minute'
    where recipient_id = viewer and pick_id = (select id from public.picks where user_id = late and status = 'active');
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  marked := public.mark_notification_group_read(review_group, snapshot);
  assert marked = 2, 'The two events up to the snapshot are read: '||marked;
  select r into g from public.notification_group_page() r where r->>'group_id' = review_group;
  assert (g->>'unread_count')::int = 1 and (g->>'total_count')::int = 3 and (g->>'actor_count')::int = 3
    and g->'actor'->>'user_id' = late::text,
    'The later arrival stays unread and leads the group: '||g::text;
  assert (select public.notification_unread_count()) = 6, 'Badge drops by the two read events and counts the new one: '||(select public.notification_unread_count());
  assert public.mark_notification_group_read(review_group, snapshot) = 0, 'Marking again with the old snapshot changes nothing';
  assert public.mark_notification_group_read('fix:'||req_fix::text, now()) = 1, 'A fix-needed group is read the same way';
  -- Marking is per member: another member's call never touches my rows.
  reset role;
  perform set_config('request.jwt.claim.sub',other::text,true);
  set local role authenticated;
  perform public.mark_notification_group_read(review_group, now() + interval '1 day');
  reset role;
  assert (select count(*) from public.pick_review_notifications where recipient_id = viewer and read_at is null) = 1,
    'Another member''s mark leaves my unread event alone';

  -- Blocking friend afterwards removes their events everywhere.
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    select viewer, friend, username from public.profiles where id=friend;
  assert not exists (select 1 from public.notification_group_page() r where r->>'kind' in ('followee_pick','reply')), 'A blocked member''s Pick change and reply leave the inbox';
  select r into g from public.notification_group_page() r where r->>'kind' = 'comment';
  assert (g->>'actor_count')::int = 1 and g->'actor'->>'user_id' = other::text, 'The comment group keeps only the unblocked commenter: '||g::text;
  select count(*) into n from public.notification_group_page() r where r->>'group_id' = review_group;
  assert n = 1 and (select (r->>'actor_count')::int from public.notification_group_page() r where r->>'group_id' = review_group) = 2,
    'The product group drops the blocked holder';
  reset role;
end;
$flow$;
$test$, 'grouped inbox: five kinds grouped by their target with actor and unread counts, approvals excluded from list and badge, keyset paging, read up to a snapshot only, blocks respected');
select * from finish();
rollback;
