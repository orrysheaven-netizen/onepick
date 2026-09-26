-- Isolated fixtures: all accounts, categories and choices are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  v_parent uuid := gen_random_uuid();
  v_category uuid := gen_random_uuid();
  v_slug text := 'rank-' || v_category;
  v_user uuid;
  v_items uuid[] := array[]::uuid[];
  v_result jsonb;
begin
  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (v_parent,'Ranking parent','rankp-'||v_parent,'open',true,false);
  insert into public.categories(id,name,slug,parent_id,status,is_visible,is_pickable)
    values(v_category,'Ranking category',v_slug,v_parent,'open',true,true);
  -- Six public products plus one hidden one, with descending choice counts 6..1.
  for i in 1..7 loop
    v_items := v_items || gen_random_uuid();
    insert into public.items(id,category_id,name,normalized_name,status)
      values(v_items[i],v_category,'Rank '||i,'rank'||i, case when i=7 then 'hidden' else 'active' end);
    for j in 1..(8-i) loop
      v_user := gen_random_uuid();
      insert into auth.users(id,aud,role,created_at,updated_at)
        values(v_user,'authenticated','authenticated',now(),now());
      insert into public.profiles(id,username,onboarding_completed)
        values(v_user,'rk_'||substr(replace(v_user::text,'-',''),1,15),true);
      insert into public.picks(user_id,category_id,item_id,one_line_review,status,started_at)
        values(v_user,v_category,v_items[i],'Ranking fixture','active',now());
    end loop;
  end loop;

  set local role anon;
  select jsonb_agg(to_jsonb(r)) into v_result from public.category_ranking(v_slug) r;
  assert jsonb_array_length(v_result)=6, 'Every public product is ranked, hidden ones are not';
  assert (v_result->0->>'item_id')::uuid=v_items[1] and (v_result->0->>'pick_count')::int=7
    and (v_result->0->>'rank')::int=1, 'Most chosen product ranks first';
  assert (v_result->5->>'rank')::int=6, 'Ranks continue past the Explore TOP 3';
  assert (select count(*)=2 from public.category_ranking(v_slug, 2)), 'Limit is honoured';
  assert (select count(*)=6 from public.category_ranking(v_slug, 500)), 'Limit is capped, not rejected';
  assert (select count(*)=1 from public.category_ranking(v_slug, -3)), 'Limit floors at one row';
  assert (select count(*)=6 from public.category_ranking(upper(v_slug)||'  ')), 'Slug lookup is case and whitespace tolerant';
  assert (select count(*)=0 from public.category_ranking('rankp-'||v_parent)), 'Non-pickable parents have no ranking';
  assert (select count(*)=0 from public.category_ranking('no-such-category')), 'Unknown slug is empty';
  assert (select count(*)=0 from public.category_ranking(null)), 'Null slug is empty';
  assert exists(select 1 from public.ranking_categories() where slug=v_slug and category_path='Ranking parent › Ranking category'),
    'Open leaf appears in the ranking category list with its path';
  assert not exists(select 1 from public.ranking_categories() where category_id=v_parent),
    'Parents are not ranking pages';

  reset role;
  update public.categories set status='paused' where id=v_category;
  set local role anon;
  assert (select count(*)=0 from public.category_ranking(v_slug)), 'Paused categories have no ranking';
  assert not exists(select 1 from public.ranking_categories() where slug=v_slug), 'Paused categories leave the list';
  reset role;
end;
$flow$;
$test$, 'Category ranking: slug lookup, full list, limits, eligibility and category list');

select * from finish();
rollback;
