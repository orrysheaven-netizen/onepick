-- #879 featured-pick DB tests. Entire fixture rolls back; no production data changes.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
set local plpgsql.check_asserts = on;

insert into auth.users(id,aud,role,created_at,updated_at) values
  ('fa090000-0000-4000-8000-000000000001','authenticated','authenticated',now(),now()),
  ('fa090000-0000-4000-8000-000000000002','authenticated','authenticated',now(),now()),
  ('fa090000-0000-4000-8000-000000000003','authenticated','authenticated',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
  ('fa090000-0000-4000-8000-000000000001','feature_owner',true),
  ('fa090000-0000-4000-8000-000000000002','feature_other',true),
  ('fa090000-0000-4000-8000-000000000003','feature_pending',true);

insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
select 'fa090000-0000-4000-8000-000000000101',id,'Feature One','featured_879_one','open',true,true
from public.categories where slug='food';
insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
select 'fa090000-0000-4000-8000-000000000102',id,'Feature Two','featured_879_two','open',true,true
from public.categories where slug='food';
insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
select 'fa090000-0000-4000-8000-000000000103',id,'Feature Three','featured_879_three','open',true,true
from public.categories where slug='food';

insert into public.items(id,category_id,name,normalized_name,status,image_source_url) values
('fa090000-0000-4000-8000-000000000201','fa090000-0000-4000-8000-000000000101','One','featured_one','active','https://example.invalid/one.png'),
('fa090000-0000-4000-8000-000000000202','fa090000-0000-4000-8000-000000000102','Two','featured_two','active','https://example.invalid/two.png'),
('fa090000-0000-4000-8000-000000000203','fa090000-0000-4000-8000-000000000103','Pending','featured_pending','active','https://example.invalid/pending.png');
-- The non-food item remains a valid public Pick in the existing catalog, but must
-- not enter the restaurant-only featured selector.
insert into public.items(id,category_id,name,normalized_name,status,image_source_url)
select 'fa090000-0000-4000-8000-000000000204',id,'Feature Movie','featured_movie',
  'active','https://example.invalid/movie.png'
from public.categories where slug='movie';
insert into public.picks(id,user_id,category_id,item_id,channel,one_line_review,status,started_at) values
('fa090000-0000-4000-8000-000000000301','fa090000-0000-4000-8000-000000000001','fa090000-0000-4000-8000-000000000101','fa090000-0000-4000-8000-000000000201','online','Review A','active',now()-interval '3 hours'),
('fa090000-0000-4000-8000-000000000302','fa090000-0000-4000-8000-000000000001','fa090000-0000-4000-8000-000000000102','fa090000-0000-4000-8000-000000000202','online','Review B','active',now()-interval '2 hours'),
('fa090000-0000-4000-8000-000000000303','fa090000-0000-4000-8000-000000000003','fa090000-0000-4000-8000-000000000103','fa090000-0000-4000-8000-000000000203','online','Not public','needs_review',now()-interval '1 hour');
insert into public.picks(id,user_id,category_id,item_id,channel,one_line_review,status,started_at)
select 'fa090000-0000-4000-8000-000000000304',
  'fa090000-0000-4000-8000-000000000001',id,
  'fa090000-0000-4000-8000-000000000204',null,'Movie review','active',
  now()-interval '30 minutes'
from public.categories where slug='movie';

select ok(not has_table_privilege('authenticated','private.profile_featured_picks','SELECT')
      and not has_table_privilege('authenticated','private.profile_featured_picks','INSERT')
      and not has_table_privilege('anon','private.profile_featured_picks','SELECT'),
      'private featured table is inaccessible to app roles');
select ok(has_function_privilege('authenticated','public.set_my_featured_pick(uuid,bigint)','EXECUTE')
      and not has_function_privilege('anon','public.set_my_featured_pick(uuid,bigint)','EXECUTE'),
      'only authenticated members can execute featured setter');
select ok(has_function_privilege('anon','public.get_profile_featured_pick(uuid)','EXECUTE')
      and not has_function_privilege('anon','public.list_my_featured_pick_candidates(timestamptz,uuid,integer)','EXECUTE'),
      'guest may read public featured but cannot list owner candidates');

set local role authenticated;
select set_config('request.jwt.claim.sub','fa090000-0000-4000-8000-000000000001',true);

select is((public.get_profile_featured_pick('fa090000-0000-4000-8000-000000000001')->>'revision')::bigint,
  0::bigint,'unset owner starts with revision zero');
select is((public.list_my_featured_pick_candidates(null,null,30)->'items') @>
  '[{"pick_id":"fa090000-0000-4000-8000-000000000302"}]'::jsonb,
  true,'a public online food candidate is included');
select is((public.list_my_featured_pick_candidates(null,null,30)->'items') @>
  '[{"pick_id":"fa090000-0000-4000-8000-000000000304"}]'::jsonb,
  false,'public non-food Pick is excluded from restaurant candidates');
select throws_ok($q$select public.set_my_featured_pick('fa090000-0000-4000-8000-000000000304',0)$q$,
  'P0001','FEATURED_PICK_INELIGIBLE','public non-food Pick cannot be featured');

select is((public.set_my_featured_pick('fa090000-0000-4000-8000-000000000301',0)->>'revision')::bigint,
  1::bigint,'first featured selection succeeds with revision 1');
select throws_ok($q$select public.set_my_featured_pick('fa090000-0000-4000-8000-000000000302',0)$q$,
  'P0001','FEATURED_PICK_CONFLICT','stale revision cannot overwrite latest featured');
select throws_ok($q$select public.set_my_featured_pick('fa090000-0000-4000-8000-000000000303',1)$q$,
  'P0001','FEATURED_PICK_INELIGIBLE','pending review from other member cannot be selected');
select is((public.set_my_featured_pick('fa090000-0000-4000-8000-000000000302',1)->>'revision')::bigint,
  2::bigint,'second public Pick replaces previous featured');

reset role;
select set_config('request.jwt.claim.sub','',true);
-- A past A update must not erase the later selected B.
update public.picks set status='removed',ended_at=now()
where id='fa090000-0000-4000-8000-000000000301';
select is((select pick_id from private.profile_featured_picks
where user_id='fa090000-0000-4000-8000-000000000001'),
'fa090000-0000-4000-8000-000000000302'::uuid,'ending old A preserves new B');

-- Suspensions hide the card without destroying its reference.
insert into private.user_moderation(user_id,reason) values
('fa090000-0000-4000-8000-000000000001','fixture suspended');
select is(public.get_profile_featured_pick('fa090000-0000-4000-8000-000000000001')->'featured_pick',
  'null'::jsonb,'suspended owner is hidden');
select is((select pick_id from private.profile_featured_picks
where user_id='fa090000-0000-4000-8000-000000000001'),
'fa090000-0000-4000-8000-000000000302'::uuid,'suspension does not clear reference');
delete from private.user_moderation
where user_id='fa090000-0000-4000-8000-000000000001';
select is(public.get_profile_featured_pick('fa090000-0000-4000-8000-000000000001')->'featured_pick'->>'pick_id',
  'fa090000-0000-4000-8000-000000000302','reinstatement restores still-public B');

-- Newly ineligible backing item must automatically clear B, without deleting its Pick.
update public.items set status='hidden'
where id='fa090000-0000-4000-8000-000000000202';
select is((select pick_id from private.profile_featured_picks
  where user_id='fa090000-0000-4000-8000-000000000001'),null::uuid,
  'hiding selected item clears the highlighted reference');
select is((select revision from private.profile_featured_picks
  where user_id='fa090000-0000-4000-8000-000000000001'),3::bigint,
  'automatic clear increments revision');
select is((select status from public.picks where id='fa090000-0000-4000-8000-000000000302'),
  'active'::text,'highlight clear never changes original Pick');
update public.items set status='active'
where id='fa090000-0000-4000-8000-000000000202';
select is((select pick_id from private.profile_featured_picks
  where user_id='fa090000-0000-4000-8000-000000000001'),null::uuid,
  'republicising an item never auto-restores a cleared featured Pick');

-- Owner can select B again; an ordinary review edit does NOT clear the reference.
select set_config('request.jwt.claim.sub','fa090000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((public.set_my_featured_pick('fa090000-0000-4000-8000-000000000302',3)->>'revision')::bigint,
4::bigint,'owner can reselect B at current revision');
reset role;
update public.picks set one_line_review='Updated review',updated_at=now()
where id='fa090000-0000-4000-8000-000000000302';
select is((select pick_id from private.profile_featured_picks
  where user_id='fa090000-0000-4000-8000-000000000001'),
  'fa090000-0000-4000-8000-000000000302'::uuid,'review edit preserves reference');
select is(public.get_profile_featured_pick('fa090000-0000-4000-8000-000000000001')->'featured_pick'->>'one_line_review',
  'Updated review','public featured card gets fresh existing review');

-- Changing category visibility clears selected representative.
update public.categories set is_visible=false
  where id='fa090000-0000-4000-8000-000000000102';
select is((select revision from private.profile_featured_picks
  where user_id='fa090000-0000-4000-8000-000000000001'),
  5::bigint,'hiding a category clears featured and advances revision');

-- Full candidate range: 201+ eligible selections across distinct categories, cursor by timestamp/id.
create temporary table featured_extra_ids (seq integer, category_id uuid, item_id uuid, pick_id uuid) on commit drop;
insert into featured_extra_ids
select i,gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from generate_series(1,205) as i;
insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
select f.category_id, food.id, 'Feature '||f.seq,'featured_879_extra_'||f.seq,'open',true,true
from featured_extra_ids f cross join public.categories food where food.slug='food';
insert into public.items(id,category_id,name,normalized_name,status,image_source_url)
select f.item_id,f.category_id,'Feature Item '||f.seq,'featured_extra_'||f.seq,'active',
  'https://example.invalid/feat-'||f.seq||'.png'
from featured_extra_ids f;
insert into public.picks(id,user_id,category_id,item_id,channel,one_line_review,status,started_at)
select f.pick_id,'fa090000-0000-4000-8000-000000000001',f.category_id,f.item_id,'online',
  'Review '||f.seq,'active',now()-f.seq * interval '1 minute'
from featured_extra_ids f;
-- Include exact equal-timestamp keyset boundaries across multiple pages.
update public.picks set started_at=now()-interval '5 seconds'
where id in (select pick_id from featured_extra_ids where seq in (1,2,3));

-- Use the actual app role for the full 205-candidate traversal, not only a
-- JWT sub claim with elevated SQL privileges.
set local role authenticated;
select set_config('request.jwt.claim.sub','fa090000-0000-4000-8000-000000000001',true);
select lives_ok($test$
do $do$
declare
  v_cursor_time timestamptz := null;
  v_cursor_id uuid := null;
  v_page jsonb;
  v_entry jsonb;
  v_seen uuid[] := array[]::uuid[];
  v_count integer := 0;
begin
  perform set_config('request.jwt.claim.sub','fa090000-0000-4000-8000-000000000001',true);
  loop
    v_page := public.list_my_featured_pick_candidates(v_cursor_time,v_cursor_id,50);
    for v_entry in select value from jsonb_array_elements(v_page->'items') loop
      assert not ((v_entry->>'pick_id')::uuid=any(v_seen)), 'repeated candidate across pages';
      v_seen := array_append(v_seen,(v_entry->>'pick_id')::uuid);
      v_count := v_count+1;
    end loop;
    exit when v_page->'next_cursor' = 'null'::jsonb;
    v_cursor_time := (v_page->'next_cursor'->>'started_at')::timestamptz;
    v_cursor_id := (v_page->'next_cursor'->>'id')::uuid;
    assert v_count <= 215, 'paging loop never finished';
  end loop;
  assert v_count=205, 'all 205 eligible candidates returned once';
end
$do$;
$test$,'authenticated role paginates all 205 food Picks without duplicates');
reset role;

-- A public Pick transferred to another owner must stop representing the old owner.
update public.categories set is_visible=true
  where id='fa090000-0000-4000-8000-000000000102';
select set_config('request.jwt.claim.sub','fa090000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((public.set_my_featured_pick('fa090000-0000-4000-8000-000000000302',5)->>'revision')::bigint,
  6::bigint,'owner reselects B after category is restored');
reset role;
update public.picks set user_id='fa090000-0000-4000-8000-000000000002'
where id='fa090000-0000-4000-8000-000000000302';
select is((select pick_id from private.profile_featured_picks
  where user_id='fa090000-0000-4000-8000-000000000001'),null::uuid,
  'ownership transfer clears old owner highlight');
select is((select revision from private.profile_featured_picks
  where user_id='fa090000-0000-4000-8000-000000000001'),7::bigint,
  'ownership transfer advances revision');

-- A second owner selects the transferred B, then hard-deletes the source.
-- The BEFORE DELETE cleanup and FK SET NULL must produce one revision increment.
select set_config('request.jwt.claim.sub','fa090000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((public.set_my_featured_pick('fa090000-0000-4000-8000-000000000302',0)->>'revision')::bigint,
  1::bigint,'new owner can highlight transferred B');
reset role;
delete from public.picks where id='fa090000-0000-4000-8000-000000000302';
select is((select pick_id from private.profile_featured_picks
  where user_id='fa090000-0000-4000-8000-000000000002'),null::uuid,
  'hard delete clears featured FK');
select is((select revision from private.profile_featured_picks
  where user_id='fa090000-0000-4000-8000-000000000002'),2::bigint,
  'hard delete advances revision exactly once');

-- Suspension preserves the reference, but the source becoming private while
-- suspended must permanently clear it; reinstatement does not resurrect it.
-- Set the fixture id while privileged; ordinary app role cannot read this temp table.
select set_config('test.featured.extra_pick', (select pick_id::text from featured_extra_ids where seq=1), true);
select set_config('request.jwt.claim.sub','fa090000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((public.set_my_featured_pick(current_setting('test.featured.extra_pick')::uuid,7)->>'revision')::bigint,
  8::bigint,'owner can highlight a 201st+ candidate');
reset role;
insert into private.user_moderation(user_id,reason)
values ('fa090000-0000-4000-8000-000000000001','fixture suspended again');
update public.items set status='hidden'
where id=(select item_id from featured_extra_ids where seq=1);
select is((select revision from private.profile_featured_picks
  where user_id='fa090000-0000-4000-8000-000000000001'),9::bigint,
  'source ineligibility while suspended advances revision');
delete from private.user_moderation
where user_id='fa090000-0000-4000-8000-000000000001';
update public.items set status='active'
where id=(select item_id from featured_extra_ids where seq=1);
select is((select pick_id from private.profile_featured_picks
  where user_id='fa090000-0000-4000-8000-000000000001'),null::uuid,
  'reinstatement and republication do not restore invalidated highlight');

-- Leaving the food tree removes MVP eligibility without touching the Pick itself.
select set_config('request.jwt.claim.sub','fa090000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((public.set_my_featured_pick((select p.id from public.picks p
  join public.items i on i.id=p.item_id
  where p.user_id='fa090000-0000-4000-8000-000000000001'
    and i.name='Feature Item 2'),9)->>'revision')::bigint,
  10::bigint,'owner can select another valid food Pick');
reset role;
update public.categories set parent_id=(select id from public.categories where slug='content')
where id=(select category_id from featured_extra_ids where seq=2);
select is((select pick_id from private.profile_featured_picks
  where user_id='fa090000-0000-4000-8000-000000000001'),null::uuid,
  'moving a category outside food clears its featured reference');
select is((select revision from private.profile_featured_picks
  where user_id='fa090000-0000-4000-8000-000000000001'),11::bigint,
  'moving category outside food increments version');
update public.categories set parent_id=(select id from public.categories where slug='food')
where id=(select category_id from featured_extra_ids where seq=2);
select is((select pick_id from private.profile_featured_picks
  where user_id='fa090000-0000-4000-8000-000000000001'),null::uuid,
  're-entering food does not restore the previously removed featured reference');

-- Public API has a strictly allowlisted response; the revision is owner-only.
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select ok(not (public.get_profile_featured_pick('fa090000-0000-4000-8000-000000000001') ? 'revision'),
  'guest cannot inspect owner revision');
reset role;

select * from finish();
rollback;
