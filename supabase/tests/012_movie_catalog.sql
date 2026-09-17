begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select ok(
  exists(select 1 from public.categories where slug='content' and is_pickable=false and status='open'),
  'content parent category is open and not directly pickable'
);
select ok(
  exists(
    select 1
    from public.categories movie
    join public.categories content on content.id=movie.parent_id
    where movie.slug='movie' and movie.is_pickable=true and movie.status='open' and content.slug='content'
  ),
  'movie is an open pickable child of content'
);

insert into public.items(
  category_id,name,normalized_name,status,external_source,external_id,original_name,release_year,image_source_url
)
values (
  (select id from public.categories where slug='movie'),
  '인터스텔라','인터스텔라','active','tmdb','157336','Interstellar',2014,
  'https://image.tmdb.org/t/p/w342/example.jpg'
);

select throws_ok(
  $$insert into public.items(category_id,name,normalized_name,status,external_source,external_id)
    values ((select id from public.categories where slug='movie'),'중복 영화','중복영화','active','tmdb','157336')$$,
  '23505',null,'external catalog identity is unique'
);
select throws_ok(
  $$insert into public.items(category_id,name,normalized_name,status,external_source)
    values ((select id from public.categories where slug='movie'),'잘못된 영화','잘못된영화','active','tmdb')$$,
  '23514',null,'external source and id must be stored together'
);
select throws_ok(
  $$insert into public.items(category_id,name,normalized_name,status,external_source,external_id)
    values ((select id from public.categories where slug='movie'),'잘못된 출처','잘못된출처','active','TMDB','1')$$,
  '23514',null,'external source namespace is normalized'
);
select throws_ok(
  $$insert into public.items(category_id,name,normalized_name,status,external_source,external_id,release_year)
    values ((select id from public.categories where slug='movie'),'잘못된 연도','잘못된연도','active','tmdb','2',1800)$$,
  '23514',null,'movie release year stays in the supported range'
);
select is(
  (select external_id from public.search_items(
    '인터스텔라',array[(select id from public.categories where slug='movie')],20
  ) limit 1),
  '157336','item search keeps the imported TMDB identity'
);

select * from finish();
rollback;
