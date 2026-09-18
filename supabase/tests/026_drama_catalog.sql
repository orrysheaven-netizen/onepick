begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts=on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  drama uuid; movie uuid; member uuid:=gen_random_uuid();
  film uuid:=gen_random_uuid(); tv uuid:=gen_random_uuid(); tv_other uuid:=gen_random_uuid();
  first_pick uuid; n integer;
begin
  select id into drama from public.categories where slug='drama' and status='open' and is_visible and is_pickable;
  select id into movie from public.categories where slug='movie';
  assert drama is not null and drama<>movie, 'Separate drama category exists';
  assert exists(select 1 from public.categories c join public.categories p on p.id=c.parent_id where c.id=drama and p.slug='content'), 'Drama reuses content parent';
  insert into auth.users(id,aud,role,created_at,updated_at) values(member,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed) values(member,'drama_'||substr(replace(member::text,'-',''),1,12),true);
  insert into public.items(id,category_id,name,normalized_name,status,external_source,external_id,original_name,release_year,image_source_url) values
    (film,movie,'미디어 동일 제목','미디어동일제목','active','tmdb','912345670001','Film fixture',2020,null),
    (tv,drama,'미디어 동일 제목','미디어동일제목','active','tmdb_tv','912345670001','Series fixture',2021,'https://image.tmdb.org/t/p/w342/series.jpg'),
    (tv_other,drama,'미디어 동일 제목','미디어동일제목','active','tmdb_tv','912345670002','Another series',2024,null);
  begin
    insert into public.items(category_id,name,normalized_name,status,external_source,external_id)
      values(drama,'중복 테스트','중복테스트','active','tmdb_tv','912345670001');
    raise exception 'Duplicate TV identity should fail';
  exception when unique_violation then null;
  end;
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select count(*) into n from public.search_items('미디어 동일 제목',array[drama],20) i where i.id in (film,tv,tv_other);
  assert n=2, 'Same-title different series remain distinct and movie is not in drama search';
  assert exists(select 1 from public.search_items('미디어 동일 제목',array[drama],20) i where i.id=tv and i.release_year=2021 and i.original_name='Series fixture' and i.image_source_url is not null), 'First-air year, original title and poster survive local search';
  reset role;
  select count(*) into n from public.picks where user_id=member;
  assert n=0, 'Catalog accumulation does not automatically select a Pick';
  perform set_config('request.jwt.claim.sub',member::text,true);
  set local role authenticated;
  perform public.change_pick(movie,film,'영화 원픽');
  perform public.change_pick(drama,tv,'드라마 원픽');
  select count(*) into n from public.picks where user_id=member and status='active';
  assert n=2, 'Movie and drama selections coexist';
  select id into first_pick from public.picks where user_id=member and category_id=drama and status='active';
  perform public.change_pick(drama,tv,'드라마 한줄평 수정');
  assert exists(select 1 from public.picks where id=first_pick and one_line_review='드라마 한줄평 수정'), 'Repeat choice reuses existing Pick';
  perform public.change_pick(drama,tv_other,'다른 드라마 선택');
  select count(*) into n from public.picks where user_id=member and category_id=drama and status='active';
  assert n=1, 'Exactly one current drama Pick';
  assert exists(select 1 from public.picks where user_id=member and item_id=film and status='active'), 'Changing drama does not replace movie Pick';
  reset role;
  update public.categories set is_visible=false where id=drama;
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select count(*) into n from public.search_items('미디어 동일 제목',array[drama],20);
  assert n=0, 'Admin hiding drama removes its catalog search results';
  reset role;
end;
$flow$;
$test$,'Drama: category, TV/movie identity, selected-only accumulation, metadata, independent choices and visibility');
select * from finish();
rollback;
