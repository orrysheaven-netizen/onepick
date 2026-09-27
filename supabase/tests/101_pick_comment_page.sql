begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  viewer uuid := gen_random_uuid(); owner_u uuid := gen_random_uuid(); cur_u uuid := gen_random_uuid();
  rem_u uuid := gen_random_uuid(); store_u uuid := gen_random_uuid(); susp_u uuid := gen_random_uuid();
  blk_u uuid := gen_random_uuid(); hid_u uuid := gen_random_uuid();
  food_group uuid := gen_random_uuid(); menu uuid := gen_random_uuid();
  item_x uuid := gen_random_uuid(); item_y uuid := gen_random_uuid();
  ended_pick uuid := gen_random_uuid(); owner_now uuid := gen_random_uuid(); cur_pick uuid := gen_random_uuid();
  rem_pick uuid := gen_random_uuid(); store_pick uuid := gen_random_uuid(); susp_pick uuid := gen_random_uuid();
  blk_pick uuid := gen_random_uuid(); hid_pick uuid := gen_random_uuid();
  c_cur uuid := gen_random_uuid(); c_rem uuid := gen_random_uuid(); c_store uuid := gen_random_uuid();
  c_owner uuid := gen_random_uuid(); c_susp uuid := gen_random_uuid(); c_blk uuid := gen_random_uuid(); c_hid uuid := gen_random_uuid();
  base timestamptz := now() - interval '1 day';
  got uuid[]; badges boolean[]; n integer; cursor_time timestamptz;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[viewer,owner_u,cur_u,rem_u,store_u,susp_u,blk_u,hid_u]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'pcp_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[viewer,owner_u,cur_u,rem_u,store_u,susp_u,blk_u,hid_u]) id;
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    select food_group, food.id, 'PCP 그룹', 'pcp-group', 'open', true, false, 900
    from public.categories food where food.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    values(menu, food_group, 'PCP 국', 'pcp-soup', 'open', true, true, 900);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (item_x,menu,'PCP 국집 X','pcp x','active'),
    (item_y,menu,'PCP 국집 Y','pcp y','active');

  -- owner_u's online Pick of X ended (replaced by Y). The thread under it stays.
  insert into public.picks(id,user_id,category_id,item_id,channel,one_line_review,status,started_at,ended_at) values
    (ended_pick, owner_u, menu, item_x, 'online', 'ended review',  'replaced', base - interval '3 days', base),
    (owner_now,  owner_u, menu, item_y, 'online', 'moved to Y',    'active',   base, null),
    (cur_pick,   cur_u,   menu, item_x, 'online', 'X online now',  'active',   base, null),
    (rem_pick,   rem_u,   menu, item_x, 'online', 'X gone',        'removed',  base - interval '2 days', base),
    (store_pick, store_u, menu, item_x, 'offline','X in store',    'active',   base, null),
    (susp_pick,  susp_u,  menu, item_x, 'online', 'suspended',     'active',   base, null),
    (blk_pick,   blk_u,   menu, item_x, 'online', 'blocked',       'active',   base, null),
    (hid_pick,   hid_u,   menu, item_x, 'online', 'hidden review', 'hidden',   base - interval '2 days', base);
  update public.picks set replaced_by_pick_id = owner_now where id = ended_pick;
  insert into private.user_moderation(user_id,reason,suspended_at) values(susp_u,'PCP fixture',now());
  insert into public.comments(id,pick_id,user_id,body,created_at) values
    (c_cur,   ended_pick, cur_u,   'same item, same channel',      base + interval '1 minute'),
    (c_rem,   ended_pick, rem_u,   'used to pick it',              base + interval '2 minutes'),
    (c_store, ended_pick, store_u, 'same item, other channel',     base + interval '3 minutes'),
    (c_owner, ended_pick, owner_u, 'author, now on Y',             base + interval '4 minutes'),
    (c_susp,  ended_pick, susp_u,  'suspended commenter',          base + interval '5 minutes'),
    (c_blk,   ended_pick, blk_u,   'blocked by the viewer',        base + interval '6 minutes'),
    (c_hid,   hid_pick,   cur_u,   'under a hidden review',        base + interval '7 minutes');

  -- Guests read the ended thread through the RPC, never through the table.
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select count(*) into n from public.comments where pick_id=ended_pick;
  assert n=0, 'Direct comment reads on an ended Pick stay closed to guests';
  select array_agg((r->>'id')::uuid order by ord), array_agg((r->>'author_current_pick_matches_item')::boolean order by ord)
    into got, badges
    from public.pick_comment_page(ended_pick) with ordinality as t(r, ord);
  assert got=array[c_cur,c_rem,c_store,c_owner,c_blk], 'Guests see every visible comment oldest first; suspended commenters are out: '||coalesce(got::text,'null');
  assert badges=array[true,false,false,false,true],
    'The badge is true only for commenters whose active Pick is this item in this channel (other channel, ended and moved-away Picks are false): '||coalesce(badges::text,'null');
  assert (select r->'author'->>'username' from public.pick_comment_page(ended_pick) r where r->>'id'=c_cur::text) like 'pcp_%',
    'Rows carry the embedded author like the PostgREST select';

  -- Cursor: rows strictly after (created_at, id), oldest first.
  select (r->>'created_at')::timestamptz into cursor_time from public.pick_comment_page(ended_pick) r where r->>'id'=c_rem::text;
  select array_agg((r->>'id')::uuid order by ord) into got
    from public.pick_comment_page(ended_pick, cursor_time, c_rem) with ordinality as t(r, ord);
  assert got=array[c_store,c_owner,c_blk], 'The cursor continues after the given comment: '||coalesce(got::text,'null');
  select count(*) into n from public.pick_comment_page(ended_pick, null, null, 2);
  assert n=2, 'p_limit is applied';
  begin
    perform public.pick_comment_page(ended_pick, null, c_rem);
    raise exception 'Half a cursor must be rejected';
  exception when sqlstate '22023' then null;
  end;

  -- Threads the item page would not show return nothing, without revealing whether they exist.
  select count(*) into n from public.pick_comment_page(hid_pick);
  assert n=0, 'Comments under a hidden review are not returned';
  select count(*) into n from public.pick_comment_page(gen_random_uuid());
  assert n=0, 'Unknown Picks return an empty page';
  reset role;

  -- A viewer who blocked blk_u does not see their comment; the badge logic is unchanged.
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    select viewer, blk_u, username from public.profiles where id=blk_u;
  select array_agg((r->>'id')::uuid order by ord) into got
    from public.pick_comment_page(ended_pick) with ordinality as t(r, ord);
  assert got=array[c_cur,c_rem,c_store,c_owner], 'Blocked commenters are left out for the viewer who blocked them: '||coalesce(got::text,'null');
  -- New comments are still limited to active Picks (decision A).
  begin
    insert into public.comments(pick_id,user_id,body) values(ended_pick, viewer, 'late comment');
    raise exception 'Commenting on an ended Pick must be rejected';
  exception when others then
    assert sqlerrm like '%row-level security%', 'Ended threads are read-only: '||sqlerrm;
  end;
  reset role;

  -- The suspended commenter still reads their own comment; nobody else does.
  perform set_config('request.jwt.claim.sub',susp_u::text,true);
  set local role authenticated;
  select count(*) into n from public.pick_comment_page(ended_pick) r where r->>'id'=c_susp::text;
  assert n=1, 'A member always sees their own comment';
  reset role;

  assert (select prosecdef from pg_proc where oid='public.pick_comment_page(uuid,timestamptz,uuid,integer)'::regprocedure), 'The reader is security definer (RLS stays closed)';
  assert has_function_privilege('anon','public.pick_comment_page(uuid,timestamptz,uuid,integer)','execute'), 'Guests may read comment threads';
end;
$flow$;
$test$, 'pick_comment_page: ended threads readable per item, badge = active Pick on same item+channel, hidden/suspended/blocked excluded, cursor, RLS unchanged');
select * from finish();
rollback;
