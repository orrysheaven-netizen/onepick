begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select ok(exists(
  select 1 from public.categories book join public.categories content on content.id=book.parent_id
  where book.slug='book' and book.name='책' and book.status='open' and book.is_visible and book.is_pickable
    and content.slug='content' and content.parent_id is null
),'book is an open pickable child of content');

insert into public.items(category_id,name,normalized_name,status,external_source,external_id,original_name,release_year,creator_name,collection_name,image_source_url)
values
((select id from public.categories where slug='book'),'소년이 온다 · 한강','소년이온다·한강','active',
  'nlk_isbn','9788936434120','소년이 온다',2014,'한강','창비',null),
((select id from public.categories where slug='book'),'소년이 온다 · 한강','소년이온다·한강','active',
  'nlk_isbn','9780306406157','소년이 온다',2026,'한강','테스트출판사',null);

select is((select count(*)::integer from public.items where external_source='nlk_isbn' and original_name='소년이 온다'),
  2,'same title with different ISBNs remains separate editions');

select is((select creator_name from public.search_items('한강',array[(select id from public.categories where slug='book')],20) order by release_year limit 1),
  '한강','book items remain searchable by author through normalized display name');

select is((select collection_name from public.search_items('소년이 온다',array[(select id from public.categories where slug='book')],20) order by release_year limit 1),
  '창비','book publisher metadata is retained');

select is((select image_source_url from public.items where external_source='nlk_isbn' and external_id='9788936434120'),
  null::text,'book cover is not auto-adopted before rights verification');

select ok(exists(select 1 from public.search_items('소년이 온다',null,20) where external_source='nlk_isbn'),
  'global OnePick search can find adopted books');

select ok(not exists(
  select 1 from public.items where external_source='nlk_isbn' and external_id='9788936434121'
),'invalid ISBN fixture is not present');

select * from finish();
rollback;
