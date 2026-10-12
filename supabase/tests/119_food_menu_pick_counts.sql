begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  u4 uuid := gen_random_uuid(); bad uuid := gen_random_uuid(); admin uuid := gen_random_uuid();
  grp uuid := gen_random_uuid(); soup uuid := gen_random_uuid(); noodle uuid := gen_random_uuid();
  hidden uuid := gen_random_uuid(); movie uuid;
  soup_a uuid := gen_random_uuid(); soup_b uuid := gen_random_uuid(); noodle_a uuid := gen_random_uuid();
  hidden_a uuid := gen_random_uuid(); gone uuid := gen_random_uuid();
  n bigint; rows integer;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[u1,u2,u3,u4,bad,admin]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'fpc_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[u1,u2,u3,u4,bad,admin]) id;
  insert into private.admin_users(user_id) values(admin);

  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
    select grp,c.id,'FPC 그룹','fpc-grp-'||substr(replace(grp::text,'-',''),1,8),'open',true,false
    from public.categories c where c.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable) values
    (soup,grp,'FPC 국','fpc-soup-'||substr(replace(soup::text,'-',''),1,8),'open',true,true),
    (noodle,grp,'FPC 면','fpc-noodle-'||substr(replace(noodle::text,'-',''),1,8),'open',true,true),
    (hidden,grp,'FPC 닫힌 메뉴','fpc-hidden-'||substr(replace(hidden::text,'-',''),1,8),'open',true,true);

  insert into public.items(id,category_id,name,normalized_name,status) values
    (soup_a,soup,'국집 A','국집a','active'),
    (soup_b,soup,'국집 B','국집b','discontinued'),
    (noodle_a,noodle,'면집 A','면집a','active'),
    (hidden_a,hidden,'닫힌집','닫힌집','active'),
    (gone,soup,'반려된 집','반려된집','rejected');

  -- soup: u1 + u2 on A, u3 on B (discontinued still counts) → 3 people.
  --       u4 replaced (not current), bad is suspended, rejected item ignored.
  -- noodle: u1 offline + u2 online → 2 people without a channel, 1 offline.
  -- hidden: closed later → absent.
  insert into public.picks(user_id,category_id,item_id,channel,one_line_review,status,started_at,ended_at) values
    (u1,soup,soup_a,'offline','fpc','active',now()-interval '40 days',null),
    (u2,soup,soup_a,'offline','fpc','active',now()-interval '1 day',null),
    (u3,soup,soup_b,'offline','fpc','active',now()-interval '1 day',null),
    (u4,soup,soup_a,'offline','fpc','replaced',now()-interval '3 days',now()-interval '1 day'),
    (bad,soup,soup_a,'offline','fpc','active',now()-interval '1 day',null),
    (u1,noodle,noodle_a,'offline','fpc','active',now()-interval '1 day',null),
    (u2,noodle,noodle_a,'online','fpc','active',now()-interval '1 day',null),
    (u3,hidden,hidden_a,'offline','fpc','active',now()-interval '1 day',null);
  update public.categories set status='closed' where id=hidden;
  -- Suspend after the fixture Picks exist (suspension blocks new writes).
  insert into private.user_moderation(user_id,reason,suspended_by) values(bad,'counts fixture',admin);

  assert has_function_privilege('anon','public.food_menu_pick_counts(text)','execute'), 'Guests can read the public counts';

  set local role anon;
  select pick_count into n from public.food_menu_pick_counts('offline') where category_id=soup;
  assert n=3, 'Current public store Picks per menu, older than 7 days included, suspended and replaced excluded';
  select pick_count into n from public.food_menu_pick_counts('offline') where category_id=noodle;
  assert n=1, 'The channel filter applies';
  select pick_count into n from public.food_menu_pick_counts(null) where category_id=noodle;
  assert n=2, 'Without a channel every current Pick counts once per person';
  select count(*) into rows from public.food_menu_pick_counts(null) where category_id=hidden;
  assert rows=0, 'Closed menus are not listed';
  select count(*) into rows from public.food_menu_pick_counts(null) c
    join public.categories cat on cat.id=c.category_id where cat.slug in ('recipe','pending-product');
  assert rows=0, 'Recipe and staging categories are never counted';
  reset role;
end;
$flow$;
$test$, 'food_menu_pick_counts: current public Picks per food menu with channel scope, suspension, closed menus and staging excluded');
select * from finish();
rollback;
