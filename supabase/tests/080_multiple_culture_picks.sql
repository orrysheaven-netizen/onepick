begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Users: A holds several culture picks, B is a second picker, F follows A.
insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('f8000000-0000-4000-8000-00000000000a','authenticated','authenticated','multi-pick-a@example.invalid','',now(),now()),
  ('f8000000-0000-4000-8000-00000000000b','authenticated','authenticated','multi-pick-b@example.invalid','',now(),now()),
  ('f8000000-0000-4000-8000-00000000000f','authenticated','authenticated','multi-pick-f@example.invalid','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
  ('f8000000-0000-4000-8000-00000000000a','multi_pick_a',true),
  ('f8000000-0000-4000-8000-00000000000b','multi_pick_b',true),
  ('f8000000-0000-4000-8000-00000000000f','multi_pick_f',true);

-- M allows five picks, S keeps the classic single pick.
insert into public.categories(id,name,slug,status,is_visible,is_pickable,max_picks) values
  ('f8100000-0000-4000-8000-00000000000d','Multi pick test','multi-pick-test','open',true,true,5),
  ('f8100000-0000-4000-8000-00000000000e','Single pick test','single-pick-test','open',true,true,default);
insert into public.category_taste_dimensions(category_id,dimension_code,is_primary) values
  ('f8100000-0000-4000-8000-00000000000d','culture',true),
  ('f8100000-0000-4000-8000-00000000000e','tech',true);

insert into public.items(id,category_id,name,normalized_name,status)
select ('f8200000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
  'f8100000-0000-4000-8000-00000000000d','Multi item '||i,'multiitem'||i,'active'
from generate_series(1,7) i;
insert into public.items(id,category_id,name,normalized_name,status)
select ('f8300000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
  'f8100000-0000-4000-8000-00000000000e','Single item '||i,'singleitem'||i,'active'
from generate_series(1,2) i;

select is(
  (select max_picks::int from public.categories where id='f8100000-0000-4000-8000-00000000000e'),
  1,
  'categories default to one pick'
);
select ok(
  not exists(select 1 from public.categories where slug in ('movie','drama','music','game','book','youtube') and max_picks<>5),
  'culture categories allow five picks'
);
select ok(
  has_column_privilege('anon','public.picks','position','select')
  and has_column_privilege('anon','public.categories','max_picks','select'),
  'clients can read pick positions and category limits'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-00000000000f',true);
insert into public.user_follows(follower_id,followee_id)
values('f8000000-0000-4000-8000-00000000000f','f8000000-0000-4000-8000-00000000000a');

select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-00000000000a',true);

select lives_ok(
  $sql$
  do $block$
  declare i integer;
  begin
    for i in 1..5 loop
      perform public.change_pick(
        'f8100000-0000-4000-8000-00000000000d',
        ('f8200000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
        'Review '||i
      );
    end loop;
  end
  $block$
  $sql$,
  'a multi-pick category accepts five picks'
);

select results_eq(
  $$select position::int from public.picks
    where user_id='f8000000-0000-4000-8000-00000000000a'
      and category_id='f8100000-0000-4000-8000-00000000000d'
      and status='active'
    order by item_id$$,
  array[1,2,3,4,5],
  'added picks take the next free positions'
);

select throws_ok(
  $$select public.change_pick('f8100000-0000-4000-8000-00000000000d','f8200000-0000-4000-8000-000000000006','Sixth')$$,
  'P0001','PICK_LIMIT_REACHED',
  'a sixth pick is rejected instead of silently replacing one'
);

select is(
  (public.change_pick('f8100000-0000-4000-8000-00000000000d','f8200000-0000-4000-8000-000000000003','Edited third')).position::int,
  3,
  'picking a held item again edits that pick in place'
);

reset role;
select is(
  (select count(*)::int from private.community_write_limits
   where user_id='f8000000-0000-4000-8000-00000000000a' and action='pick'),
  0,
  'filling free slots does not consume replacement quota'
);
select is(
  (select count(*)::int from public.pick_change_notifications
   where recipient_id='f8000000-0000-4000-8000-00000000000f'),
  1,
  'rapid additions in one category notify a follower once'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-00000000000a',true);

create temporary table held as
select item_id, id as pick_id
from public.picks
where user_id='f8000000-0000-4000-8000-00000000000a'
  and category_id='f8100000-0000-4000-8000-00000000000d'
  and status='active';
grant select on held to authenticated;

select is(
  (public.change_pick('f8100000-0000-4000-8000-00000000000d','f8200000-0000-4000-8000-000000000006','Replaces second',null,null,
     (select pick_id from held where item_id='f8200000-0000-4000-8000-000000000002'))).position::int,
  2,
  'replacing a chosen pick keeps its position'
);

reset role;
select is(
  (select status||':'||(replaced_by_pick_id is not null)::text from public.picks
   where id=(select pick_id from held where item_id='f8200000-0000-4000-8000-000000000002')),
  'replaced:true',
  'the chosen pick is kept as history'
);
select is(
  (select count(*)::int from private.community_write_limits
   where user_id='f8000000-0000-4000-8000-00000000000a' and action='pick'),
  1,
  'an actual replacement consumes replacement quota'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-00000000000a',true);

select throws_ok(
  $$select public.change_pick('f8100000-0000-4000-8000-00000000000d','f8200000-0000-4000-8000-000000000007','Stale target',null,null,
     (select pick_id from held where item_id='f8200000-0000-4000-8000-000000000002'))$$,
  'P0001','PICK_NOT_FOUND',
  'a pick that is no longer current cannot be replaced'
);

-- Representative: move the pick at position 4 to the front.
select is(
  (public.set_representative_pick((select pick_id from held where item_id='f8200000-0000-4000-8000-000000000004'))).position::int,
  1,
  'set_representative_pick moves the pick to position 1'
);
select results_eq(
  $$select right(item_id::text,1)||'@'||position from public.picks
    where user_id='f8000000-0000-4000-8000-00000000000a'
      and category_id='f8100000-0000-4000-8000-00000000000d'
      and status='active'
    order by position$$,
  array['4@1','1@2','6@3','3@4','5@5'],
  'picks ahead of the new representative shift back by one'
);

reset role;
select is(
  (select count(*)::int from public.pick_change_notifications
   where recipient_id='f8000000-0000-4000-8000-00000000000f'),
  1,
  'reordering never notifies followers'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-00000000000a',true);

select throws_ok(
  $$select public.remove_pick('f8100000-0000-4000-8000-00000000000d')$$,
  'P0001','PICK_ID_REQUIRED',
  'removing by category alone is ambiguous when several picks are held'
);
select ok(
  public.remove_pick('f8100000-0000-4000-8000-00000000000d',
    (select pick_id from held where item_id='f8200000-0000-4000-8000-000000000004')),
  'remove_pick removes the chosen pick'
);
select results_eq(
  $$select right(item_id::text,1)||'@'||position from public.picks
    where user_id='f8000000-0000-4000-8000-00000000000a'
      and category_id='f8100000-0000-4000-8000-00000000000d'
      and status='active'
    order by position$$,
  array['1@1','6@2','3@3','5@4'],
  'remaining picks close the gap and the next one becomes representative'
);
select is(
  (public.change_pick('f8100000-0000-4000-8000-00000000000d','f8200000-0000-4000-8000-000000000007','Fills the gap')).position::int,
  5,
  'a freed slot can be filled again'
);

-- Single-pick categories keep the classic replace behaviour.
select public.change_pick('f8100000-0000-4000-8000-00000000000e','f8300000-0000-4000-8000-000000000001','First single');
select is(
  (public.change_pick('f8100000-0000-4000-8000-00000000000e','f8300000-0000-4000-8000-000000000002','Second single')).position::int,
  1,
  'a single-pick category replaces its one pick'
);
select is(
  (select count(*)::int from public.picks
   where user_id='f8000000-0000-4000-8000-00000000000a'
     and category_id='f8100000-0000-4000-8000-00000000000e'
     and status in ('active','needs_review')),
  1,
  'a single-pick category still holds exactly one current pick'
);

-- B picks item 1 as the representative and item 6 second.
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-00000000000b',true);
select public.change_pick('f8100000-0000-4000-8000-00000000000d','f8200000-0000-4000-8000-000000000006','B first');
select public.change_pick('f8100000-0000-4000-8000-00000000000d','f8200000-0000-4000-8000-000000000001','B second');
select public.set_representative_pick(
  (select id from public.picks where user_id='f8000000-0000-4000-8000-00000000000b'
     and item_id='f8200000-0000-4000-8000-000000000001' and status='active')
);

select throws_ok(
  $$select public.set_representative_pick(
      (select pick_id from held where item_id='f8200000-0000-4000-8000-000000000001'))$$,
  'P0001','PICK_NOT_FOUND',
  'another person''s pick cannot be reordered'
);
reset role;

-- Representatives: A -> item 1, B -> item 1. Item 6 is only ever second.
select results_eq(
  $$select right(item_id::text,1)||'='||pick_count
    from public.category_top_items('f8100000-0000-4000-8000-00000000000d')$$,
  array['1=2'],
  'category rankings count only representative picks'
);
select results_eq(
  $$select right(item_id::text,1)||'='||item_pick_count||'/'||category_pick_count
    from public.profile_ai_pick_popularity(array[
      'f8200000-0000-4000-8000-000000000001',
      'f8200000-0000-4000-8000-000000000006'
    ]::uuid[])
    order by item_id$$,
  array['1=2/2','6=2/2'],
  'AI popularity counts every current pick over distinct pickers in the category'
);

select is(
  (select jsonb_agg(jsonb_build_array(d->>'code', d->>'pick_count', d->>'percentage') order by d->>'code')
   from jsonb_array_elements(public.profile_taste_composition('f8000000-0000-4000-8000-00000000000a')->'dimensions') d),
  '[["culture","5","50.0"],["tech","1","50.0"]]'::jsonb,
  'taste composition weighs each category once however many picks it holds'
);

-- Writes outside the RPCs still respect the category limit and uniqueness.
select throws_ok(
  $$insert into public.picks(user_id,category_id,item_id,one_line_review,position)
    values('f8000000-0000-4000-8000-00000000000b','f8100000-0000-4000-8000-00000000000e',
      'f8300000-0000-4000-8000-000000000001','Too far',2)$$,
  'P0001','PICK_LIMIT_REACHED',
  'a position beyond max_picks is rejected'
);
select throws_ok(
  $$insert into public.picks(user_id,category_id,item_id,one_line_review,position)
    values('f8000000-0000-4000-8000-00000000000b','f8100000-0000-4000-8000-00000000000d',
      'f8200000-0000-4000-8000-000000000007','Same slot',1)$$,
  '23P01',
  null,
  'two current picks cannot share a position'
);
select throws_ok(
  $$insert into public.picks(user_id,category_id,item_id,one_line_review,position)
    values('f8000000-0000-4000-8000-00000000000b','f8100000-0000-4000-8000-00000000000d',
      'f8200000-0000-4000-8000-000000000006','Same item',3)$$,
  '23505',
  null,
  'the same item cannot be a current pick twice'
);

select * from finish();
rollback;
