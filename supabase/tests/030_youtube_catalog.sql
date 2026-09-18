begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select ok(exists(
  select 1 from public.categories youtube join public.categories content on content.id=youtube.parent_id
  where youtube.slug='youtube' and youtube.name='유튜브' and youtube.status='open'
    and youtube.is_visible and youtube.is_pickable
    and content.slug='content' and content.parent_id is null
),'youtube is an open pickable child of content');

select has_column('public','items','external_refreshed_at','items track provider metadata refresh time');
select has_function('private','scrub_stale_youtube_api_data',array[]::text[],'private stale-data scrubber exists');
select ok(not has_function_privilege('anon','private.scrub_stale_youtube_api_data()','execute'),'anonymous clients cannot scrub provider data');
select ok(not has_function_privilege('authenticated','private.scrub_stale_youtube_api_data()','execute'),'signed-in clients cannot scrub provider data');
select ok(exists(select 1 from cron.job where jobname='onepick-youtube-api-data-scrub'),'daily YouTube API cleanup cron exists');

insert into public.items(category_id,name,normalized_name,status,external_source,external_id,original_name,image_source_url,official_url,external_refreshed_at)
values
((select id from public.categories where slug='youtube'),'오래된 채널','오래된채널','active','youtube_channel',
 'UC1234567890123456789012','오래된 채널','https://yt3.ggpht.com/old','https://www.youtube.com/channel/UC1234567890123456789012',now()-interval '26 days'),
((select id from public.categories where slug='youtube'),'신선한 채널','신선한채널','active','youtube_channel',
 'UCabcdefghijklmnopqrstuv','신선한 채널','https://yt3.ggpht.com/fresh','https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',now()-interval '2 days');

insert into public.external_catalog_cache(provider,cache_key,payload,fetched_at) values
('youtube',repeat('a',64),'[]'::jsonb,now()-interval '26 days'),
('youtube',repeat('b',64),'[]'::jsonb,now()-interval '2 days');

select is(private.scrub_stale_youtube_api_data(),1,'scrubber removes API metadata from one stale item');

select is((select status from public.items where name='YouTube 채널 · 정보 갱신 필요' limit 1),
  'discontinued','stale social item remains as a discontinued metadata tombstone');

select ok(exists(select 1 from public.items where external_source='youtube_channel' and external_id='UCabcdefghijklmnopqrstuv'),
  'fresh YouTube metadata remains intact');

select ok(not exists(select 1 from public.external_catalog_cache where provider='youtube' and cache_key=repeat('a',64)),
  'stale YouTube API cache is deleted');

select ok(exists(select 1 from public.search_items('신선한 채널',array[(select id from public.categories where slug='youtube')],20)
  where external_source='youtube_channel'),'fresh adopted YouTube channel remains searchable');

select * from finish();
rollback;
