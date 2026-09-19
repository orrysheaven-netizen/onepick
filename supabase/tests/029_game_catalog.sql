begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select ok(exists(
  select 1 from public.categories game join public.categories content on content.id=game.parent_id
  where game.slug='game' and game.name='게임' and game.status='open' and game.is_visible and game.is_pickable
    and content.slug='content' and content.parent_id is null
),'game is an open pickable child of content');

insert into public.items(category_id,name,normalized_name,status,external_source,external_id,original_name,release_year,creator_name,collection_name,image_source_url,official_url)
values
((select id from public.categories where slug='game'),'테스트 게임','테스트게임테스트스튜디오pcnintendoswitch','active',
  'igdb_game','1942','테스트 게임',2024,'테스트 스튜디오','PC · Nintendo Switch',
  'https://images.igdb.com/igdb/image/upload/t_cover_big/co1234.jpg','https://www.igdb.com/games/test-game'),
((select id from public.categories where slug='game'),'테스트 게임','테스트게임리마스터스튜디오playstation5','active',
  'igdb_game','1944','테스트 게임',2026,'리마스터 스튜디오','PlayStation 5',
  'https://images.igdb.com/igdb/image/upload/t_cover_big/co5678.jpg','https://www.igdb.com/games/test-game-remaster');

select is((select count(*)::integer from public.items where external_source='igdb_game' and original_name='테스트 게임'),
  2,'same title with different IGDB IDs stays separate');

select is((select creator_name from public.search_items('테스트 스튜디오',array[(select id from public.categories where slug='game')],20) limit 1),
  '테스트 스튜디오','game search preserves developer metadata');

select is((select collection_name from public.search_items('Nintendo',array[(select id from public.categories where slug='game')],20) limit 1),
  'PC · Nintendo Switch','game search can find adopted platform text');

select ok((select image_source_url::text from public.items where external_source='igdb_game' and external_id='1942')
  like 'https://images.igdb.com/igdb/image/upload/%','selected game stores IGDB remote cover URL');

select ok((select official_url::text from public.items where external_source='igdb_game' and external_id='1942')
  like 'https://www.igdb.com/games/%','selected game stores IGDB official URL');

select ok(exists(select 1 from public.search_items('테스트 게임',null,20) where external_source='igdb_game'),
  'global OnePick search can find adopted games');

select * from finish();
rollback;
