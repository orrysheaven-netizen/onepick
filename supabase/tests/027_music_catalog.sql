begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select ok(exists(
  select 1 from public.categories music join public.categories content on content.id=music.parent_id
  where music.slug='music' and music.name='음악' and music.status='open' and music.is_visible and music.is_pickable
    and content.slug='content' and content.parent_id is null
),'music is an open pickable child of content');

select has_column('public','items','creator_name','items store structured creator text');
select has_column('public','items','collection_name','items store structured collection text');
select has_table('public','external_catalog_cache','server catalog cache exists');
select has_function('public','reserve_external_catalog_slot',array['text','integer'],'shared provider reservation exists');
select ok(not has_table_privilege('anon','public.external_catalog_cache','SELECT'),'anonymous clients cannot read provider cache');
select ok(not has_table_privilege('authenticated','public.external_catalog_cache','SELECT'),'signed-in clients cannot read provider cache');

insert into public.items(category_id,name,normalized_name,status,external_source,external_id,original_name,release_year,creator_name,collection_name)
values((select id from public.categories where slug='music'),'밤편지 · 아이유','밤편지·아이유','active',
  'musicbrainz_recording','11111111-2222-4333-8444-555555555555','밤편지',2017,'아이유','Palette');

select is((select creator_name from public.search_items('밤편지',array[(select id from public.categories where slug='music')],20) limit 1),
  '아이유','item search preserves music creator metadata');
select is((select collection_name from public.search_items('아이유',array[(select id from public.categories where slug='music')],20) limit 1),
  'Palette','combined normalized item name remains searchable by artist');

set local role authenticated;
select throws_ok($$select public.reserve_external_catalog_slot('musicbrainz',1100)$$,'42501',null,'clients cannot reserve upstream slots directly');
reset role;

select * from finish();
rollback;
