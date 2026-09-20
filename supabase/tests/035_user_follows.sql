begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  viewer uuid := gen_random_uuid(); stranger uuid := gen_random_uuid(); suspended uuid := gen_random_uuid();
  friends uuid[] := array(select gen_random_uuid() from generate_series(1,22));
  friend_picks uuid[] := array(select gen_random_uuid() from generate_series(1,22));
  cat uuid := gen_random_uuid(); product uuid := gen_random_uuid();
  stranger_pick uuid := gen_random_uuid(); own_pick uuid := gen_random_uuid();
  stamp timestamptz := now() + interval '1 day';
  expected uuid[]; first_page uuid[]; second_page uuid[]; cursor_id uuid; cursor_time timestamptz;
  n integer; following_n bigint; follower_n bigint;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(friends || array[viewer,stranger,suspended]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'follow_'||substr(replace(id::text,'-',''),1,12),true from unnest(friends || array[viewer,stranger,suspended]) id;
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(cat,'Follow feed','follow-'||cat,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status)
    values(product,cat,'Followed product','followed product','active');
  -- Equal timestamps on purpose: ordering must fall back to pick id like the people feed.
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at)
    select friend_picks[i],friends[i],cat,product,'Friend reason '||i,'active',stamp
    from generate_series(1,22) i;
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at) values
    (stranger_pick,stranger,cat,product,'Stranger reason','active',stamp + interval '1 second'),
    (own_pick,viewer,cat,product,'Own reason','active',stamp + interval '1 second');
  select array_agg(id order by id desc) into expected from unnest(friend_picks) id;

  -- Guests: no execute on the feed or counts, and the feed never bypasses RLS.
  perform set_config('request.jwt.claim.sub','',true);
  assert not has_function_privilege('anon','public.home_following_feed_page(timestamptz,uuid)','execute'), 'Guests cannot call the following feed';
  assert not has_function_privilege('anon','public.follow_counts()','execute'), 'Guests cannot read counts';
  assert not (select prosecdef from pg_proc where oid='public.home_following_feed_page(timestamptz,uuid)'::regprocedure), 'Feed runs under caller RLS';

  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  select count(*) into n from public.home_following_feed_page();
  assert n=0, 'Nothing followed means an empty feed, not the public feed';

  begin
    insert into public.user_follows(follower_id,followee_id) values(viewer,viewer);
    raise exception 'Self follow must be rejected';
  exception when others then
    assert sqlerrm like '%FOLLOW_SELF%' or sqlerrm like '%user_follows_not_self%', 'Self follow rejected: '||sqlerrm;
  end;
  begin
    insert into public.user_follows(follower_id,followee_id) values(stranger,viewer);
    raise exception 'Following on behalf of another user must be rejected';
  exception when others then
    assert sqlerrm like '%FORBIDDEN%' or sqlerrm like '%row-level security%', 'Foreign follower_id rejected: '||sqlerrm;
  end;
  begin
    insert into public.user_follows(follower_id,followee_id) values(viewer,gen_random_uuid());
    raise exception 'Unknown profile must be rejected';
  exception when others then
    assert sqlerrm like '%PROFILE_NOT_FOUND%' or sqlerrm like '%foreign key%', 'Unknown followee rejected: '||sqlerrm;
  end;

  -- Follow one friend and the stranger first: only their current picks appear.
  insert into public.user_follows(follower_id,followee_id) values(viewer,friends[1]),(viewer,stranger);
  select count(*) into n from public.user_follows;
  assert n=2, 'Follower reads only their own rows';
  select array_agg(f.pick_id order by f.started_at desc,f.pick_id desc) into first_page
    from public.home_following_feed_page() f;
  assert first_page=array[stranger_pick,friend_picks[1]], 'Only current picks of followed people, newest first';
  select count(*) into n from public.home_following_feed_page() f where f.user_id=viewer;
  assert n=0, 'Own pick is never in the following feed';

  -- Unfollow removes the person; the public feed is untouched.
  delete from public.user_follows where follower_id=viewer and followee_id=stranger;
  select count(*) into n from public.home_following_feed_page() f where f.user_id=stranger;
  assert n=0, 'Unfollowed person leaves the following feed';
  select count(*) into n from public.home_pick_feed_page() f where f.user_id=stranger;
  assert n=1, 'Public feed does not depend on follows';

  -- Counts: own only, both directions.
  select following_count,follower_count into following_n,follower_n from public.follow_counts();
  assert following_n=1 and follower_n=0, 'Own counts reflect follows in both directions';
  reset role;
  perform set_config('request.jwt.claim.sub',friends[1]::text,true);
  set local role authenticated;
  insert into public.user_follows(follower_id,followee_id) values(friends[1],viewer);
  select count(*) into n from public.user_follows;
  assert n=1, 'The followee cannot see who follows them through the table';
  select following_count,follower_count into following_n,follower_n from public.follow_counts();
  assert following_n=1 and follower_n=1, 'Mutual follows count once on each side';

  -- Cursor: follow everyone so the feed spans more than one page.
  reset role;
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  insert into public.user_follows(follower_id,followee_id) select viewer,id from unnest(friends[2:22]) id;
  select array_agg(f.pick_id order by f.started_at desc,f.pick_id desc) into first_page
    from public.home_following_feed_page() f;
  assert first_page=expected[1:21], 'Page is 20 rows plus one lookahead in people-feed order';
  select f.pick_id,f.started_at into cursor_id,cursor_time from public.home_following_feed_page() f
    order by f.started_at desc,f.pick_id desc offset 19 limit 1;
  select array_agg(f.pick_id order by f.started_at desc,f.pick_id desc) into second_page
    from public.home_following_feed_page(cursor_time,cursor_id) f;
  assert second_page=expected[21:22], 'Cursor continues from the last displayed row through equal timestamps';
  begin
    perform public.home_following_feed_page(null,cursor_id);
    raise exception 'Half cursor must be rejected';
  exception when sqlstate '22023' then null;
  end;

  -- Block: both directions of the relationship disappear and cannot be recreated.
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot) values(viewer,friends[1],'x');
  select count(*) into n from public.user_follows where followee_id=friends[1];
  assert n=0, 'Blocking removes the outgoing follow';
  select following_count,follower_count into following_n,follower_n from public.follow_counts();
  assert following_n=21 and follower_n=0, 'Blocking removes the incoming follow too';
  select count(*) into n from public.home_following_feed_page() f where f.user_id=friends[1];
  assert n=0, 'Blocked person is out of the following feed';
  begin
    insert into public.user_follows(follower_id,followee_id) values(viewer,friends[1]);
    raise exception 'Following across a block must be rejected';
  exception when others then
    assert sqlerrm like '%FOLLOW_BLOCKED%', 'Follow across block rejected: '||sqlerrm;
  end;
  delete from public.user_blocks where blocker_user_id=viewer and blocked_user_id=friends[1];
  select count(*) into n from public.user_follows where followee_id=friends[1];
  assert n=0, 'Unblocking does not restore the follow';

  -- Suspension: existing follows stop feeding, and new ones are refused.
  insert into public.user_follows(follower_id,followee_id) values(viewer,stranger);
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  insert into private.user_moderation(user_id,reason)
    select id,'Synthetic follow test' from unnest(array[stranger,suspended]) id;
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  select count(*) into n from public.home_following_feed_page() f where f.user_id=stranger;
  assert n=0, 'Suspended followee is hidden from the following feed';
  begin
    insert into public.user_follows(follower_id,followee_id) values(viewer,suspended);
    raise exception 'Following a suspended account must be rejected';
  exception when others then
    assert sqlerrm like '%PROFILE_NOT_FOUND%', 'Suspended followee rejected: '||sqlerrm;
  end;
  reset role;
end;
$flow$;
$test$, 'Follow relationship, following feed, own counts, block and suspension rules');
select * from finish();
rollback;
