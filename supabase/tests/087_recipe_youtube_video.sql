begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- The single 레시피 category is retired; recipes are a channel of each dish.
select ok(exists(
  select 1 from public.categories recipe
  where recipe.slug='recipe' and recipe.status='paused'
    and not recipe.is_visible and not recipe.is_pickable
),'the old 레시피 category is paused, hidden and not pickable');

select ok(not public.category_is_open_leaf((select id from public.categories where slug='recipe')),
  'the old 레시피 category is no longer an open leaf');

select ok(not exists(
  select 1 from public.category_catalog_sources s join public.categories c on c.id=s.category_id
  where c.slug='recipe' and s.is_enabled
),'the old 레시피 video source is disabled');

select ok(public.category_accepts_recipe((select id from public.categories where slug='doenjang-jjigae')),
  'a food dish accepts recipe videos');

select ok(not public.category_accepts_recipe((select id from public.categories where slug='recipe'))
  and not public.category_accepts_recipe((select id from public.categories where slug='food-soups-rice')),
  'the retired category and dish groups do not');

insert into public.items(category_id,name,normalized_name,status,external_source,external_id,original_name,creator_name,image_source_url,official_url,external_refreshed_at)
values
((select id from public.categories where slug='kimchi-jjigae'),'오래된 김치찌개 레시피','오래된김치찌개레시피','active','youtube_video',
 'AAAAAAAAAAA','오래된 김치찌개 레시피','요리 채널','https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg',
 'https://www.youtube.com/watch?v=AAAAAAAAAAA',now()-interval '26 days'),
((select id from public.categories where slug='doenjang-jjigae'),'신선한 된장찌개 레시피','신선한된장찌개레시피','active','youtube_video',
 'BBBBBBBBBBB','신선한 된장찌개 레시피','요리 채널','https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg',
 'https://www.youtube.com/watch?v=BBBBBBBBBBB',now()-interval '2 days');
insert into public.item_channels(item_id,channel,target_url,is_primary)
select id,'recipe',official_url,true from public.items where external_id in ('AAAAAAAAAAA','BBBBBBBBBBB');

select throws_ok($$
  insert into public.items(category_id,name,normalized_name,status,external_source,external_id)
  values((select id from public.categories where slug='kimchi-jjigae'),'같은 영상','같은영상','active','youtube_video','BBBBBBBBBBB')
$$,'23505',null,'one item per YouTube video ID across dishes');

select ok(exists(select 1 from public.search_items('된장찌개',array[(select id from public.categories where slug='doenjang-jjigae')],20)
  where external_source='youtube_video' and external_id='BBBBBBBBBBB'),'a fresh recipe video is searchable in its dish');

select is(private.scrub_stale_youtube_api_data(),1,'scrubber removes API metadata from the stale video only');

select is((select status from public.items where name='YouTube 영상 · 정보 갱신 필요' limit 1),
  'discontinued','stale video remains as a discontinued tombstone');

select ok(not exists(select 1 from public.items where external_id='AAAAAAAAAAA' or creator_name is not null and name='YouTube 영상 · 정보 갱신 필요'),
  'stale video ID and channel name are removed');

select is((select ch.target_url from public.item_channels ch join public.items i on i.id=ch.item_id
  where i.name='YouTube 영상 · 정보 갱신 필요' and ch.channel='recipe'),null,
  'the stale video link is removed from its recipe channel');

select ok(exists(select 1 from public.items where external_source='youtube_video' and external_id='BBBBBBBBBBB'
  and creator_name='요리 채널'),'fresh video metadata remains intact');

select ok(exists(select 1 from public.item_channels ch join public.items i on i.id=ch.item_id
  where i.external_id='BBBBBBBBBBB' and ch.channel='recipe' and ch.target_url='https://www.youtube.com/watch?v=BBBBBBBBBBB'),
  'the fresh video keeps its recipe link');

select ok(not has_function_privilege('authenticated','private.scrub_stale_youtube_api_data()','execute'),
  'signed-in clients still cannot scrub provider data');

set local role authenticated;
select throws_ok($$
  insert into public.items(category_id,name,normalized_name,status,external_source,external_id)
  values((select id from public.categories where slug='kimchi-jjigae'),'직접 넣은 영상','직접넣은영상','active','youtube_video','CCCCCCCCCCC')
$$,'42501',null,'clients cannot insert recipe video items directly');
reset role;

select * from finish();
rollback;
