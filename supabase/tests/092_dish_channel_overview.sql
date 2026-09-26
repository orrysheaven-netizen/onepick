begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temp table dco_ids(key text primary key, id uuid not null) on commit drop;
insert into dco_ids values
  ('u1','f9e00000-0000-4000-8000-000000000001'),
  ('u2','f9e00000-0000-4000-8000-000000000002'),
  ('u3','f9e00000-0000-4000-8000-000000000003'),
  ('store','f9e30000-0000-4000-8000-000000000001'),
  ('store2','f9e30000-0000-4000-8000-000000000002'),
  ('seller','f9e30000-0000-4000-8000-000000000003'),
  ('video','f9e30000-0000-4000-8000-000000000004');
grant select on dco_ids to anon;

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
select id,'authenticated','authenticated',key||'@dco.invalid','',now(),now() from dco_ids where key like 'u%';
insert into public.profiles(id,username,onboarding_completed)
select id,'dco_'||key,true from dco_ids where key like 'u%';

-- 김치찌개 is a food dish from the migrations.
insert into public.items(id,category_id,name,normalized_name,status,external_source,external_id)
select d.id,c.id,v.name,v.normalized,'active',v.src,v.ext
from (values
  ('store','김치찌개 명가','김치찌개명가',null,null),
  ('store2','김치찌개 골목집','김치찌개골목집',null,null),
  ('seller','김치찌개 밀키트몰','김치찌개밀키트몰',null,null),
  ('video','백종원 김치찌개','백종원김치찌개','youtube_video','DCODCODCO01')
) as v(key,name,normalized,src,ext)
join dco_ids d on d.key=v.key
cross join public.categories c
where c.slug='kimchi-jjigae';

-- Picks first (a store channel otherwise needs a linked place), channels after.
insert into public.picks(user_id,category_id,item_id,channel,one_line_review,status)
select u.id, i.category_id, i.id, v.channel, '맛있어요', 'active'
from (values
  ('u1','store','offline'),('u2','store','offline'),('u3','store2','offline'),
  ('u1','seller','online'),
  ('u2','video','recipe'),('u3','video','recipe')
) as v(ukey,ikey,channel)
join dco_ids u on u.key=v.ukey
join dco_ids x on x.key=v.ikey
join public.items i on i.id=x.id;
insert into public.item_channels(item_id,channel,is_primary)
select id,'offline',true from dco_ids where key in ('store','store2')
union all select id,'online',true from dco_ids where key='seller'
union all select id,'recipe',true from dco_ids where key='video';

set local role anon;

select is(
  (select count(*)::int from public.dish_channel_overview('김치찌개') where channel is null),
  1,
  'an exact dish name returns its header row'
);

select is(
  (select category_name from public.dish_channel_overview(' 김치 찌개 ') limit 1),
  '김치찌개',
  'spaces in the query are ignored'
);

select is(
  (select array_agg(item_name order by rank) from public.dish_channel_overview('김치찌개') where channel='offline'),
  array['김치찌개 명가','김치찌개 골목집'],
  '오프라인 맛집 lists stores, most picked first'
);

select is(
  (select pick_count from public.dish_channel_overview('김치찌개') where item_id=(select id from dco_ids where key='store')),
  2::bigint,
  'counts people picking the item in that channel'
);

select is(
  (select array_agg(item_name) from public.dish_channel_overview('김치찌개') where channel='online'),
  array['김치찌개 밀키트몰'],
  '온라인 맛집 lists online sellers'
);

select is(
  (select array_agg(item_name) from public.dish_channel_overview('김치찌개') where channel='recipe'),
  array['백종원 김치찌개'],
  '레시피 lists recipe videos'
);

select is(
  (select count(*)::int from public.dish_channel_overview('김치찌')),
  0,
  'a partial name is not a dish (plain item search handles it)'
);

select is(
  (select count(*)::int from public.dish_channel_overview('닭도리탕') where channel is null),
  1,
  'a search term of the dish works too (닭도리탕 → 닭볶음탕)'
);

select is(
  (select count(*)::int from public.dish_channel_overview('닭도리탕') where channel is not null),
  0,
  'a dish with nothing picked yet still has its header'
);

reset role;

select * from finish();
rollback;
