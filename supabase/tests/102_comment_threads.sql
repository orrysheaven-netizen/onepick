begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  viewer uuid := gen_random_uuid(); owner_u uuid := gen_random_uuid(); cur_u uuid := gen_random_uuid();
  store_u uuid := gen_random_uuid(); susp_u uuid := gen_random_uuid(); blk_u uuid := gen_random_uuid();
  food_group uuid := gen_random_uuid(); menu uuid := gen_random_uuid();
  item_x uuid := gen_random_uuid(); item_y uuid := gen_random_uuid();
  ended_pick uuid := gen_random_uuid(); owner_now uuid := gen_random_uuid(); cur_pick uuid := gen_random_uuid();
  store_pick uuid := gen_random_uuid(); susp_pick uuid := gen_random_uuid(); blk_pick uuid := gen_random_uuid();
  c_cur uuid := gen_random_uuid(); c_owner uuid := gen_random_uuid(); c_susp uuid := gen_random_uuid();
  r_owner uuid; r_cur uuid; r_susp uuid; c_second uuid; c_solo uuid;
  base timestamptz := now() - interval '1 day';
  got uuid[]; kinds text[]; n integer; row_json jsonb; loc jsonb; outcome text; raised boolean;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[viewer,owner_u,cur_u,store_u,susp_u,blk_u]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'cth_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[viewer,owner_u,cur_u,store_u,susp_u,blk_u]) id;
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    select food_group, food.id, 'CTH 그룹', 'cth-group', 'open', true, false, 900
    from public.categories food where food.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    values(menu, food_group, 'CTH 국', 'cth-soup', 'open', true, true, 900);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (item_x,menu,'CTH 국집 X','cth x','active'),
    (item_y,menu,'CTH 국집 Y','cth y','active');

  -- owner_u's online Pick of X ended (replaced by Y). cur_u holds X online now,
  -- store_u holds X offline, susp_u and blk_u hold X online.
  insert into public.picks(id,user_id,category_id,item_id,channel,one_line_review,status,started_at,ended_at) values
    (ended_pick, owner_u, menu, item_x, 'online', 'ended review', 'replaced', base - interval '3 days', base),
    (owner_now,  owner_u, menu, item_y, 'online', 'moved to Y',   'active',   base, null),
    (cur_pick,   cur_u,   menu, item_x, 'online', 'X online now', 'active',   base, null),
    (store_pick, store_u, menu, item_x, 'offline','X in store',   'active',   base, null),
    (susp_pick,  susp_u,  menu, item_x, 'online', 'suspended',    'active',   base, null),
    (blk_pick,   blk_u,   menu, item_x, 'online', 'blocked',      'active',   base, null);
  update public.picks set replaced_by_pick_id = owner_now where id = ended_pick;

  -- ---------------------------------------------------------------- writing
  -- Same item, same channel: may write under the ended review.
  perform set_config('request.jwt.claim.sub',cur_u::text,true);
  set local role authenticated;
  assert public.can_comment_on_pick(ended_pick), 'A holder of the same item+channel may write under an ended review';
  insert into public.comments(id,pick_id,user_id,body,created_at) values(c_cur, ended_pick, cur_u, 'still my pick too', base + interval '1 minute');
  -- Clients cannot plant tombstones. RETURNING works: own comments on a visible thread are readable.
  insert into public.comments(pick_id,user_id,body,deleted_at,created_at) values(ended_pick, cur_u, 'not deleted', now(), base + interval '2 minutes') returning id into c_solo;
  assert (select deleted_at is null from public.comments where id=c_solo), 'deleted_at is server-owned';
  reset role;

  -- Same item, other channel: refused.
  perform set_config('request.jwt.claim.sub',store_u::text,true);
  set local role authenticated;
  assert not public.can_comment_on_pick(ended_pick), 'Another channel of the same item is not the same product';
  raised := false;
  begin
    insert into public.comments(pick_id,user_id,body) values(ended_pick, store_u, 'other channel');
  exception when others then
    raised := sqlerrm like '%row-level security%';
  end;
  assert raised, 'A holder of another channel cannot write';
  reset role;

  -- Nothing at all: refused. (viewer holds no Pick.)
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  assert not public.can_comment_on_pick(ended_pick), 'A member without the item cannot write';
  reset role;

  -- The author may always join the thread under their own review, current or
  -- not, but only by replying to another member's comment (#731).
  perform set_config('request.jwt.claim.sub',owner_u::text,true);
  set local role authenticated;
  assert public.can_comment_on_pick(ended_pick), 'The review author may write under their own ended review';
  raised := false;
  begin
    insert into public.comments(pick_id,user_id,body) values(ended_pick, owner_u, 'new top-level');
  exception when others then
    raised := sqlerrm like '%row-level security%';
  end;
  assert raised, 'The review author cannot add a top-level comment';
  -- c_owner stands for a top-level comment written before that rule; the
  -- reading, locating and my_comment_page checks below still use it.
  reset role;
  insert into public.comments(id,pick_id,user_id,body,created_at) values(c_owner, ended_pick, owner_u, 'thanks', base + interval '3 minutes');
  set local role authenticated;
  -- Replies: one level, same Pick, live parent.
  insert into public.comments(pick_id,user_id,body,parent_comment_id,created_at) values(ended_pick, owner_u, 'reply to cur', c_cur, base + interval '4 minutes') returning id into r_owner;
  raised := false;
  begin
    insert into public.comments(pick_id,user_id,body,parent_comment_id) values(ended_pick, owner_u, 'reply to reply', r_owner);
  exception when others then raised := sqlerrm = 'COMMENT_PARENT_INVALID';
  end;
  assert raised, 'A reply cannot target a reply';
  raised := false;
  begin
    insert into public.comments(pick_id,user_id,body,parent_comment_id) values(owner_now, owner_u, 'cross thread', c_cur);
  exception when others then raised := sqlerrm = 'COMMENT_PARENT_INVALID';
  end;
  assert raised, 'A reply must sit on the parent''s Pick';
  reset role;

  -- ------------------------------------------------------------ notifications
  -- cur_u's top-level comment told owner_u (the review author) although the
  -- Pick has ended; owner_u's reply told cur_u, and only cur_u.
  perform set_config('request.jwt.claim.sub',owner_u::text,true);
  set local role authenticated;
  select array_agg(kind order by created_at desc, id desc) into kinds from public.notification_page();
  assert kinds = array['comment','comment'], 'The review author is told about comments on their ended review: '||coalesce(kinds::text,'null');
  assert (select public.notification_count()) = 2, 'Two unread for the author: the comments, not their own reply';
  reset role;
  perform set_config('request.jwt.claim.sub',cur_u::text,true);
  set local role authenticated;
  select array_agg(kind order by created_at desc, id desc) into kinds from public.notification_page();
  assert kinds = array['comment'], 'The parent author is told about the reply through the inbox: '||coalesce(kinds::text,'null');
  select r.kind into outcome from public.comment_notifications r where r.comment_id = r_owner;
  assert outcome = 'reply', 'The inbox row is a reply';
  assert (select body from public.notification_page() limit 1) = 'reply to cur', 'The inbox resolves the reply on another member''s ended Pick';
  -- The reply is readable by its addressee through the table too, until they
  -- block its author: a past inbox row never reopens a blocked thread.
  select count(*) into n from public.comments where id = r_owner;
  assert n = 1, 'A comment addressed to me is readable even on an ended Pick';
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    select cur_u, owner_u, username from public.profiles where id=owner_u;
  select count(*) into n from public.comments where id = r_owner;
  assert n = 0, 'After blocking the author, the addressed reply is closed';
  assert (select public.notification_count()) = 0, 'The blocked reply leaves the unread count';
  select count(*) into n from public.notification_page();
  assert n = 0, 'The blocked reply leaves the inbox';
  delete from public.user_blocks where blocker_user_id = cur_u and blocked_user_id = owner_u;
  select count(*) into n from public.comments where id = r_owner;
  assert n = 1, 'Unblocking restores the addressed reply';
  reset role;
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  select count(*) into n from public.comments where pick_id = ended_pick;
  assert n = 0, 'Other members still cannot read ended threads through the table';
  reset role;

  -- ------------------------------------------------------------ reading
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select array_agg((r->>'id')::uuid order by ord) into got
    from public.pick_comment_page(ended_pick) with ordinality as t(r, ord);
  assert got = array[c_cur, c_solo, c_owner], 'Top-level comments only, oldest first: '||coalesce(got::text,'null');
  select r into row_json from public.pick_comment_page(ended_pick) r where r->>'id' = c_cur::text;
  assert jsonb_array_length(row_json->'replies') = 1 and (row_json->>'reply_count')::int = 1
    and (row_json->'replies'->0->>'id')::uuid = r_owner
    and (row_json->'replies'->0->>'parent_comment_id')::uuid = c_cur
    and (row_json->'replies'->0->'author'->>'username') like 'cth_%'
    and (row_json->'replies'->0->>'author_current_pick_matches_item')::boolean = false,
    'Replies are embedded with author and badge (owner moved to Y: false): '||row_json::text;
  assert (row_json->>'author_current_pick_matches_item')::boolean = true, 'cur_u holds X online: badge';
  -- Locate: a reply resolves to its root; the first root has no page cursor.
  loc := public.comment_locate(r_owner);
  assert (loc->>'root_comment_id')::uuid = c_cur and (loc->>'pick_id')::uuid = ended_pick
    and (loc->>'item_id')::uuid = item_x and loc->>'page_after_id' is null
    and (loc->>'review_is_current')::boolean = false and (loc->>'review_is_deleted')::boolean = false,
    'comment_locate points a reply at its root on the first page: '||loc::text;
  loc := public.comment_locate(c_owner);
  assert (loc->>'root_comment_id')::uuid = c_owner and (loc->>'page_after_id')::uuid = c_solo,
    'comment_locate gives the cursor of the previous top-level comment: '||loc::text;
  assert (select array_agg((r->>'id')::uuid order by ord)
          from public.pick_comment_page(ended_pick, (loc->>'page_after_time')::timestamptz, (loc->>'page_after_id')::uuid) with ordinality as t(r, ord))
    = array[c_owner], 'That cursor starts the page at the located comment';
  assert public.comment_locate(gen_random_uuid()) is null, 'Unknown comments locate to null';
  reset role;

  -- ------------------------------------------------------------ deleting
  -- delete_comment: a comment with a live reply becomes a tombstone.
  perform set_config('request.jwt.claim.sub',cur_u::text,true);
  set local role authenticated;
  raised := false;
  begin
    perform public.delete_comment(c_owner);
  exception when others then raised := sqlerrm = 'COMMENT_NOT_FOUND';
  end;
  assert raised, 'Only the author deletes a comment';
  outcome := public.delete_comment(c_cur);
  assert outcome = 'tombstoned', 'A comment with replies is tombstoned: '||outcome;
  outcome := public.delete_comment(c_solo);
  assert outcome = 'removed', 'A comment without replies is removed: '||outcome;
  raised := false;
  begin
    perform public.delete_comment(c_cur);
  exception when others then raised := sqlerrm = 'COMMENT_NOT_FOUND';
  end;
  assert raised, 'A tombstone cannot be deleted again';
  select count(*) into n from public.comments where id = c_cur;
  assert n = 0, 'The table never returns a tombstone, not even to its author';
  -- My comments: the tombstone is gone, the live one on an ended review stays.
  select array_agg((r->'comment'->>'id')::uuid order by ord) into got
    from public.my_comment_page() with ordinality as t(r, ord);
  assert got = '{}'::uuid[] or got is null, 'my_comment_page lists no deleted comments: '||coalesce(got::text,'null');
  reset role;

  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select r into row_json from public.pick_comment_page(ended_pick) r where r->>'id' = c_cur::text;
  assert (row_json->>'is_deleted')::boolean and row_json->>'body' is null and row_json->>'user_id' is null
    and row_json->'author' = 'null'::jsonb and row_json->>'updated_at' is null
    and (row_json->>'author_current_pick_matches_item')::boolean = false
    and jsonb_array_length(row_json->'replies') = 1,
    'The tombstone keeps its place and its replies, without author, text or badge: '||row_json::text;
  assert (select count(*) from public.pick_comment_page(ended_pick)) = 2, 'c_solo is gone, the tombstone and c_owner remain';
  reset role;

  -- The last reply goes: the tombstone goes with it.
  perform set_config('request.jwt.claim.sub',owner_u::text,true);
  set local role authenticated;
  outcome := public.delete_comment(r_owner);
  assert outcome = 'removed', 'A reply is removed: '||outcome;
  select count(*) into n from public.pick_comment_page(ended_pick) r where r->>'id' = c_cur::text;
  assert n = 0, 'A tombstone without replies is pruned';
  select array_agg((r->'comment'->>'id')::uuid order by ord) into got
    from public.my_comment_page() with ordinality as t(r, ord);
  assert got = array[c_owner], 'my_comment_page: the remaining own comment: '||coalesce(got::text,'null');
  select r into row_json from public.my_comment_page() r limit 1;
  assert (row_json->'pick'->>'id')::uuid = ended_pick and (row_json->'pick'->>'is_current')::boolean = false
    and (row_json->'item'->>'id')::uuid = item_x and (row_json->>'thread_visible')::boolean
    and (row_json->'comment'->>'can_delete')::boolean,
    'my_comment_page rows carry the review, item and flags: '||row_json::text;
  reset role;

  -- A direct DELETE (existing clients) gets the same tombstone behaviour, and
  -- a suspended member can still take their own comment down.
  perform set_config('request.jwt.claim.sub',susp_u::text,true);
  set local role authenticated;
  insert into public.comments(id,pick_id,user_id,body,created_at) values(c_susp, ended_pick, susp_u, 'before suspension', base + interval '5 minutes');
  reset role;
  perform set_config('request.jwt.claim.sub',cur_u::text,true);
  set local role authenticated;
  insert into public.comments(pick_id,user_id,body,parent_comment_id,created_at) values(ended_pick, cur_u, 'reply to susp', c_susp, base + interval '6 minutes') returning id into r_cur;
  reset role;
  insert into private.user_moderation(user_id,reason,suspended_at) values(susp_u,'CTH fixture',now());
  perform set_config('request.jwt.claim.sub',susp_u::text,true);
  set local role authenticated;
  select r into row_json from public.pick_comment_page(ended_pick) r where r->>'id' = c_susp::text;
  assert (row_json->>'can_delete')::boolean and (row_json->>'can_edit')::boolean = false,
    'A suspended author may delete but not edit their comment: '||row_json::text;
  delete from public.comments where id = c_susp;
  get diagnostics n = row_count;
  assert n = 0, 'A direct DELETE of a commented comment leaves the tombstone (0 rows deleted)';
  reset role;
  assert (select deleted_at is not null and body = '' from public.comments where id = c_susp), 'The tombstone exists in the table';
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select r into row_json from public.pick_comment_page(ended_pick) r where r->>'id' = c_susp::text;
  assert (row_json->>'is_deleted')::boolean and jsonb_array_length(row_json->'replies') = 1,
    'A suspended author''s tombstone still shows the reply under it';
  reset role;

  -- Editing: own live comment on a visible thread only; tombstones never.
  perform set_config('request.jwt.claim.sub',cur_u::text,true);
  set local role authenticated;
  update public.comments set body = 'edited reply' where id = r_cur;
  get diagnostics n = row_count;
  assert n = 1, 'Own live comment can be edited on an ended thread';
  reset role;

  -- Privileges.
  assert not has_function_privilege('anon','public.delete_comment(uuid)','execute'), 'Guests cannot delete comments';
  assert not has_function_privilege('anon','public.my_comment_page(timestamptz,uuid,integer)','execute'), 'Guests have no comment list';
  assert has_function_privilege('anon','public.comment_locate(uuid)','execute'), 'Guests may resolve comment links';
  assert not has_function_privilege('anon','private.comment_write_allowed(uuid,uuid)','execute'), 'Guests cannot call the eligibility helper';
  assert not has_column_privilege('authenticated','public.comments','deleted_at','update'), 'deleted_at is not client-writable';
end;
$flow$;
$test$, 'comment threads: writing needs the same item+channel or authorship, one-level replies, tombstones with pruning, reply notifications on ended Picks, my_comment_page and comment_locate');
select * from finish();
rollback;
