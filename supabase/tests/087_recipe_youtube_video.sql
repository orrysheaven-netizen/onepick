begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select ok(exists(
  select 1 from public.categories recipe join public.categories food on food.id=recipe.parent_id
  where recipe.slug='recipe' and recipe.name='레시피' and recipe.status='open'
    and recipe.is_visible and recipe.is_pickable
    and food.slug='food' and food.parent_id is null and not food.is_pickable
),'recipe is an open pickable child of food');

select ok(public.category_is_open_leaf((select id from public.categories where slug='recipe')),
  'recipe is an open leaf');

select ok(exists(
  select 1 from public.category_catalog_sources s join public.categories c on c.id=s.category_id
  where c.slug='recipe' and s.mode='external' and s.provider='youtube'
    and s.edge_function_slug='youtube-catalog' and s.external_source='youtube_video'
    and s.is_enabled and not s.place_catalog_enabled
),'recipe resolves through the youtube-catalog video source');

select ok(not public.category_uses_place_catalog((select id from public.categories where slug='recipe')),
  'recipe never switches registration to place search');

select ok(exists(
  select 1 from public.category_taste_dimensions d join public.categories c on c.id=d.category_id
  where c.slug='recipe' and d.dimension_code='food'
),'recipe counts toward the food taste dimension');

insert into public.items(category_id,name,normalized_name,status,external_source,external_id,original_name,creator_name,image_source_url,official_url,external_refreshed_at)
values
((select id from public.categories where slug='recipe'),'오래된 김치찌개 레시피','오래된김치찌개레시피','active','youtube_video',
 'AAAAAAAAAAA','오래된 김치찌개 레시피','요리 채널','https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg',
 'https://www.youtube.com/watch?v=AAAAAAAAAAA',now()-interval '26 days'),
((select id from public.categories where slug='recipe'),'신선한 된장찌개 레시피','신선한된장찌개레시피','active','youtube_video',
 'BBBBBBBBBBB','신선한 된장찌개 레시피','요리 채널','https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg',
 'https://www.youtube.com/watch?v=BBBBBBBBBBB',now()-interval '2 days');

select throws_ok($$
  insert into public.items(category_id,name,normalized_name,status,external_source,external_id)
  values((select id from public.categories where slug='recipe'),'같은 영상','같은영상','active','youtube_video','BBBBBBBBBBB')
$$,'23505',null,'one item per YouTube video ID');

select ok(exists(select 1 from public.search_items('된장찌개',array[(select id from public.categories where slug='recipe')],20)
  where external_source='youtube_video' and external_id='BBBBBBBBBBB'),'fresh recipe video is searchable in its category');

select is(private.scrub_stale_youtube_api_data(),1,'scrubber removes API metadata from the stale video only');

select is((select status from public.items where name='YouTube 영상 · 정보 갱신 필요' limit 1),
  'discontinued','stale video remains as a discontinued tombstone');

select ok(not exists(select 1 from public.items where external_id='AAAAAAAAAAA' or creator_name is not null and name='YouTube 영상 · 정보 갱신 필요'),
  'stale video ID and channel name are removed');

select ok(exists(select 1 from public.items where external_source='youtube_video' and external_id='BBBBBBBBBBB'
  and creator_name='요리 채널'),'fresh video metadata remains intact');

select ok(not has_function_privilege('authenticated','private.scrub_stale_youtube_api_data()','execute'),
  'signed-in clients still cannot scrub provider data');

set local role authenticated;
select throws_ok($$
  insert into public.items(category_id,name,normalized_name,status,external_source,external_id)
  values((select id from public.categories where slug='recipe'),'직접 넣은 영상','직접넣은영상','active','youtube_video','CCCCCCCCCCC')
$$,'42501',null,'clients cannot insert recipe video items directly');
reset role;

select * from finish();
rollback;
