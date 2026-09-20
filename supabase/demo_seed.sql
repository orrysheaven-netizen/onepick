-- Manual MVP demo seed.
-- TEST/DEMO USE ONLY. This file is intentionally NOT part of the normal migration chain
-- or supabase/seed.sql, so production-like environments are not silently populated.
--
-- The demo identities are clearly labeled demo_01 ... demo_05 and have no Auth identity
-- or session rows. They exist only to render realistic public Home/Profile/Pick flows.

begin;

-- Minimal ordinary catalog items used by the demo where an external catalog is not involved.
with ordinary(category_slug, name) as (
  values
    ('ramen','신라면'),
    ('ramen','진라면 매운맛'),
    ('ramen','짜파게티'),
    ('ramen','팔도비빔면'),
    ('ramen','삼양라면'),
    ('snacks','맛동산')
)
insert into public.items(category_id,name,normalized_name,status)
select c.id, o.name, regexp_replace(lower(o.name),'\s+','','g'), 'active'
from ordinary o
join public.categories c on c.slug=o.category_slug
where not exists (
  select 1 from public.items i
  where i.category_id=c.id
    and i.normalized_name=regexp_replace(lower(o.name),'\s+','','g')
    and i.status in ('active','discontinued')
);

-- External catalog items are based on provider IDs already used by OnePick.
with catalog(
  category_slug, external_source, external_id, name, original_name,
  release_year, image_source_url, official_url, creator_name
) as (
  values
    ('movie','tmdb','157336','인터스텔라','Interstellar',2014,
      'https://image.tmdb.org/t/p/w342/gDN2NWtHbs8ZWEBQM8Dh5OVXdb4.jpg',
      'https://www.themoviedb.org/movie/157336',null),
    ('movie','tmdb','129','센과 치히로의 행방불명','千と千尋の神隠し',2001,
      'https://image.tmdb.org/t/p/w342/u1L4qxIu5sC2P082uMHYt7Ifvnj.jpg',
      'https://www.themoviedb.org/movie/129',null),
    ('drama','tmdb_tv','61678','미생','미생',2014,
      'https://image.tmdb.org/t/p/w342/2uljxb5RGofOZQ8novBaYO8YxNN.jpg',
      'https://www.themoviedb.org/tv/61678',null),
    ('drama','tmdb_tv','66434','디어 마이 프렌즈','디어 마이 프렌즈',2016,
      'https://image.tmdb.org/t/p/w342/jl4Gr4m9mI4W0bF0JrZqMq4gVZ5.jpg',
      'https://www.themoviedb.org/tv/66434',null),
    ('music','musicbrainz_recording','cf3b2fd9-e6cc-49bf-abf3-63a3af75a6dc','밤편지 · IU','밤편지',null,
      null,
      'https://musicbrainz.org/recording/cf3b2fd9-e6cc-49bf-abf3-63a3af75a6dc','IU'),
    ('youtube','youtube_channel','UCYNnQhFGE-EP0HrWRxMGUaw','김주환의 내면소통 INZEUM','김주환의 내면소통 INZEUM',null,
      'https://yt3.ggpht.com/XXh8gThNiD4ayS359p4DOZHclLP9ZyLno_a3g4HW0XG7g4_Wq7VWmS8ZUtHdN_X-sHz9VvIn=s800-c-k-c0x00ffffff-no-rj',
      'https://www.youtube.com/channel/UCYNnQhFGE-EP0HrWRxMGUaw',null),
    ('game','igdb_game','135400','Minecraft','Minecraft',2016,
      null,'https://www.igdb.com/games/minecraft--1','Mojang Studios'),
    ('game','igdb_game','133604','KartRider Rush+','KartRider Rush+',2019,
      null,'https://www.igdb.com/games/kartrider-rush-plus','Nexon'),
    ('game','igdb_game','125626','KartRider: Drift','KartRider: Drift',2023,
      null,'https://www.igdb.com/games/kartrider-drift','Nexon America'),
    ('pokemon','pokeapi_species','4','파이리','Charmander',null,
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/4.png',
      null,null),
    ('pokemon','pokeapi_species','1','이상해씨','Bulbasaur',null,
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/1.png',
      null,null),
    ('pokemon','pokeapi_species','25','피카츄','Pikachu',null,
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png',
      null,null)
)
insert into public.items(
  category_id,name,normalized_name,official_url,status,image_source_url,
  external_source,external_id,original_name,release_year,creator_name,external_refreshed_at
)
select
  c.id, s.name, regexp_replace(lower(s.name),'\s+','','g'),
  s.official_url,'active',s.image_source_url,
  s.external_source,s.external_id,s.original_name,s.release_year::smallint,
  s.creator_name,now()
from catalog s
join public.categories c on c.slug=s.category_slug
on conflict (external_source,external_id) do update set
  name=excluded.name,
  normalized_name=excluded.normalized_name,
  official_url=excluded.official_url,
  image_source_url=excluded.image_source_url,
  original_name=excluded.original_name,
  release_year=excluded.release_year,
  creator_name=excluded.creator_name,
  external_refreshed_at=excluded.external_refreshed_at,
  updated_at=now();

-- Login-inert demo Auth rows. No auth.identities or auth.sessions are inserted.
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,
  raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
)
values
  ('00000000-0000-0000-0000-000000000000','d0e00001-1111-4111-8111-111111111111','authenticated','authenticated',null,null,'{"provider":"anonymous","providers":[],"demo":true}'::jsonb,'{"demo":true}'::jsonb,now(),now(),false,true),
  ('00000000-0000-0000-0000-000000000000','d0e00002-2222-4222-8222-222222222222','authenticated','authenticated',null,null,'{"provider":"anonymous","providers":[],"demo":true}'::jsonb,'{"demo":true}'::jsonb,now(),now(),false,true),
  ('00000000-0000-0000-0000-000000000000','d0e00003-3333-4333-8333-333333333333','authenticated','authenticated',null,null,'{"provider":"anonymous","providers":[],"demo":true}'::jsonb,'{"demo":true}'::jsonb,now(),now(),false,true),
  ('00000000-0000-0000-0000-000000000000','d0e00004-4444-4444-8444-444444444444','authenticated','authenticated',null,null,'{"provider":"anonymous","providers":[],"demo":true}'::jsonb,'{"demo":true}'::jsonb,now(),now(),false,true),
  ('00000000-0000-0000-0000-000000000000','d0e00005-5555-4555-8555-555555555555','authenticated','authenticated',null,null,'{"provider":"anonymous","providers":[],"demo":true}'::jsonb,'{"demo":true}'::jsonb,now(),now(),false,true)
on conflict (id) do nothing;

insert into public.profiles(id,username,bio,onboarding_completed)
values
  ('d0e00001-1111-4111-8111-111111111111','demo_01','MVP 데모 계정 · 실제 사용자가 아닙니다 · 초기 화면 검증용',true),
  ('d0e00002-2222-4222-8222-222222222222','demo_02','MVP 데모 계정 · 실제 사용자가 아닙니다 · 초기 화면 검증용',true),
  ('d0e00003-3333-4333-8333-333333333333','demo_03','MVP 데모 계정 · 실제 사용자가 아닙니다 · 초기 화면 검증용',true),
  ('d0e00004-4444-4444-8444-444444444444','demo_04','MVP 데모 계정 · 실제 사용자가 아닙니다 · 초기 화면 검증용',true),
  ('d0e00005-5555-4555-8555-555555555555','demo_05','MVP 데모 계정 · 실제 사용자가 아닙니다 · 초기 화면 검증용',true)
on conflict (id) do update set
  username=excluded.username,
  bio=excluded.bio,
  onboarding_completed=true,
  updated_at=now();

-- Demo content is disposable. Re-seeding resets only demo-owned Picks.
delete from public.picks
where user_id in (
  'd0e00001-1111-4111-8111-111111111111',
  'd0e00002-2222-4222-8222-222222222222',
  'd0e00003-3333-4333-8333-333333333333',
  'd0e00004-4444-4444-8444-444444444444',
  'd0e00005-5555-4555-8555-555555555555'
);

with choices(username,category_slug,item_name,review,minutes_ago) as (
  values
    ('demo_01','ramen','신라면','깔끔하게 매운 국물이 생각날 때 제일 먼저 떠오름',9),
    ('demo_01','movie','인터스텔라','긴 러닝타임인데도 우주와 가족 이야기가 같이 흘러가서 끝까지 집중하게 됨',1),
    ('demo_01','pokemon','파이리','작고 불꽃 꼬리가 눈에 띄어서 제일 기억에 남음',10),
    ('demo_01','game','Minecraft','블록을 쌓다가 계획이 바뀌어도 그대로 새로운 놀이가 되는 자유도가 좋음',6),

    ('demo_02','ramen','진라면 매운맛','면이랑 국물 균형이 좋아서 자주 찾게 됨',11),
    ('demo_02','drama','미생','직장 생활의 답답함과 작은 성취가 현실적으로 느껴져 오래 기억남',2),
    ('demo_02','music','밤편지 · IU','조용한 밤에 들으면 목소리와 분위기가 가장 편안하게 느껴짐',3),

    ('demo_03','ramen','짜파게티','주말 점심에 생각나는 가장 익숙한 짜장라면',12),
    ('demo_03','pokemon','이상해씨','처음부터 같이 성장하는 느낌이 있어서 스타팅 포켓몬 중 가장 정이 감',4),
    ('demo_03','youtube','김주환의 내면소통 INZEUM','복잡한 생각을 차분하게 정리할 때 듣기 좋음',13),
    ('demo_03','game','KartRider Rush+','짧게 한 판 하기 좋고 조작이 익숙해서 부담 없이 다시 켜게 됨',7),

    ('demo_04','ramen','팔도비빔면','새콤한 비빔면이 당길 때 가장 먼저 고르게 됨',14),
    ('demo_04','movie','센과 치히로의 행방불명','상상력이 풍부해서 몇 번을 봐도 장면을 새로 보게 됨',15),
    ('demo_04','snacks','맛동산','달달하고 바삭해서 한 번 열면 계속 손이 감',16),

    ('demo_05','ramen','삼양라면','익숙한 국물 맛이라 가끔 꼭 생각나는 라면',17),
    ('demo_05','drama','디어 마이 프렌즈','등장인물들이 현실적이라 가족 생각이 많이 남',18),
    ('demo_05','pokemon','피카츄','표정이 밝고 익숙해서 포켓몬 하면 가장 먼저 떠오르는 캐릭터',5),
    ('demo_05','game','KartRider: Drift','카트 특유의 속도감에 깔끔한 화면이 더해져 보는 맛이 있음',8)
),
resolved as (
  select p.id user_id,c.id category_id,i.id item_id,x.review,x.minutes_ago
  from choices x
  join public.profiles p on p.username=x.username
  join public.categories c on c.slug=x.category_slug
  join public.items i on i.category_id=c.id
    and i.name=x.item_name
    and i.status in ('active','discontinued')
)
insert into public.picks(
  user_id,category_id,item_id,one_line_review,status,started_at,created_at,updated_at
)
select
  user_id,category_id,item_id,review,'active',
  now()-make_interval(mins=>minutes_ago),
  now()-make_interval(mins=>minutes_ago),
  now()-make_interval(mins=>minutes_ago)
from resolved;

commit;
