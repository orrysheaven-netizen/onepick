begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temp table bl_ids(key text primary key, id uuid not null) on commit drop;
insert into bl_ids values
  ('admin','b1a00000-0000-4000-8000-000000000001'),
  ('user','b1a00000-0000-4000-8000-000000000002'),
  ('brand','b1a10000-0000-4000-8000-000000000001'),
  ('brand_off','b1a10000-0000-4000-8000-000000000002'),
  ('brand_product','b1a10000-0000-4000-8000-000000000003'),
  ('place','b1a20000-0000-4000-8000-000000000001'),
  ('place_hidden','b1a20000-0000-4000-8000-000000000002'),
  ('place_off','b1a20000-0000-4000-8000-000000000003'),
  ('store','b1a30000-0000-4000-8000-000000000001'),
  ('store_hidden','b1a30000-0000-4000-8000-000000000002'),
  ('store_off','b1a30000-0000-4000-8000-000000000003'),
  ('store_plain','b1a30000-0000-4000-8000-000000000004'),
  ('product','b1a30000-0000-4000-8000-000000000005'),
  ('place_plain','b1a20000-0000-4000-8000-000000000004');
grant select on bl_ids to anon, authenticated;

insert into auth.users(id,aud,role,created_at,updated_at)
select id,'authenticated','authenticated',now(),now() from bl_ids where key in ('admin','user');
insert into public.profiles(id,username,onboarding_completed)
select id,'bl_'||key,true from bl_ids where key in ('admin','user');
insert into private.admin_users(user_id) select id from bl_ids where key='admin';

insert into public.brands(id,name,normalized_name,is_active)
select id, v.name, v.normalized, v.active
from (values
  ('brand','구구밀크티','구구밀크티',true),
  ('brand_off','숨은브랜드','숨은브랜드',false),
  ('brand_product','농심테스트','농심테스트',true)
) as v(key,name,normalized,active)
join bl_ids using(key);

insert into public.places(id,name,branch_name,road_address,place_provider,provider_place_id,is_visible)
select id, v.name, v.branch, '서울 강남구 테스트로 1', 'bltest', key, v.visible
from (values
  ('place','구구밀크티','강남점',true),
  ('place_hidden','구구밀크티','숨김점',false),
  ('place_off','숨은브랜드','본점',true),
  ('place_plain','동네밀크티',null,true)
) as v(key,name,branch,visible)
join bl_ids using(key);

-- 김치찌개 is a food dish; place items get their provider from the sync trigger.
insert into public.items(id,category_id,name,normalized_name,status,external_source,external_id)
select s.id, c.id, v.name, v.name, 'active', 'onepick_place', p.id::text||':'||c.id::text
from (values
  ('store','place','구구밀크티'),
  ('store_hidden','place_hidden','구구밀크티숨김'),
  ('store_off','place_off','숨은브랜드'),
  ('store_plain','place_plain','동네밀크티')
) as v(skey,pkey,name)
join bl_ids s on s.key=v.skey
join bl_ids p on p.key=v.pkey
cross join public.categories c
where c.slug='kimchi-jjigae';
insert into public.item_places(item_id,category_id,place_id)
select s.id, i.category_id, p.id
from (values ('store','place'),('store_hidden','place_hidden'),('store_off','place_off'),('store_plain','place_plain')) as v(skey,pkey)
join bl_ids s on s.key=v.skey
join bl_ids p on p.key=v.pkey
join public.items i on i.id=s.id;
set constraints all immediate;

update public.providers pr set brand_id=b.id
from bl_ids b, bl_ids p
where b.key='brand' and p.key in ('place','place_hidden') and pr.place_id=p.id;
update public.providers pr set brand_id=b.id
from bl_ids b, bl_ids p
where b.key='brand_off' and p.key='place_off' and pr.place_id=p.id;

-- A non-provider item keeps its brand on items.brand_id.
insert into public.items(id,category_id,name,normalized_name,status,brand_id)
select p.id, c.id, '테스트라면', '테스트라면', 'active', b.id
from bl_ids p, bl_ids b, public.categories c
where p.key='product' and b.key='brand_product' and c.slug='ramen';

select ok(
  (select public and allowed_mime_types @> array['image/png','image/jpeg','image/webp']
     and not ('image/svg+xml' = any(allowed_mime_types))
   from storage.buckets where id='brand-logos'),
  'brand-logos is a public bucket for png/jpeg/webp only'
);

-- Logo path checks ----------------------------------------------------------
-- The existence trigger runs before CHECK constraints, so the shape cases use
-- objects that do exist.
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'brand-logos', b.id::text||'/'||v.file, a.id::text, jsonb_build_object('mimetype','image/png','size',2048)
from (values ('brand','logo.png'),('brand','old.png'),('brand_off','logo.png'),('brand_product','logo.webp'),('brand','logo.svg')) as v(key,file)
join bl_ids b using(key)
cross join bl_ids a where a.key='admin';

select throws_ok(
  $$update public.brands set logo_path='b1a10000-0000-4000-8000-000000000002/logo.png'
    where id='b1a10000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'a logo path must live in its own brand folder'
);

select throws_ok(
  $$update public.brands set logo_path='b1a10000-0000-4000-8000-000000000001/logo.svg'
    where id='b1a10000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'svg logos are rejected'
);

select throws_ok(
  $$update public.brands set logo_path='b1a10000-0000-4000-8000-000000000001/missing.png'
    where id='b1a10000-0000-4000-8000-000000000001'$$,
  'P0001', 'BRAND_LOGO_NOT_FOUND',
  'a logo path must point at an uploaded object'
);

select throws_ok(
  $$insert into public.brands(name,normalized_name,logo_path)
    values('새브랜드','새브랜드','b1a10000-0000-4000-8000-000000000001/logo.png')$$,
  null, null,
  'a new brand cannot start with a logo path'
);

select lives_ok(
  $$update public.brands set logo_path=id::text||'/logo.png'
    where id in ('b1a10000-0000-4000-8000-000000000001','b1a10000-0000-4000-8000-000000000002');
    update public.brands set logo_path=id::text||'/logo.webp'
    where id='b1a10000-0000-4000-8000-000000000003'$$,
  'an uploaded logo can be attached'
);

-- Storage policies ----------------------------------------------------------
select set_config('request.jwt.claims',
  jsonb_build_object('sub',(select id from bl_ids where key='user'),'role','authenticated','aal','aal2')::text, true);
set local role authenticated;

select throws_ok(
  $$insert into storage.objects(bucket_id,name,owner_id)
    values('brand-logos','b1a10000-0000-4000-8000-000000000001/user.png',auth.uid()::text)$$,
  '42501', null,
  'a regular user cannot upload a brand logo'
);

update public.brands set logo_path=null where id='b1a10000-0000-4000-8000-000000000001';

reset role;
select is(
  (select logo_path from public.brands where id='b1a10000-0000-4000-8000-000000000001'),
  'b1a10000-0000-4000-8000-000000000001/logo.png',
  'a regular user cannot change a brand logo'
);
select set_config('request.jwt.claims',
  jsonb_build_object('sub',(select id from bl_ids where key='admin'),'role','authenticated','aal','aal1')::text, true);
set local role authenticated;

select throws_ok(
  $$insert into storage.objects(bucket_id,name,owner_id)
    values('brand-logos','b1a10000-0000-4000-8000-000000000001/aal1.png',auth.uid()::text)$$,
  '42501', null,
  'an admin without MFA cannot upload a brand logo'
);

reset role;
select set_config('request.jwt.claims',
  jsonb_build_object('sub',(select id from bl_ids where key='admin'),'role','authenticated','aal','aal2')::text, true);
set local role authenticated;

select lives_ok(
  $$insert into storage.objects(bucket_id,name,owner_id)
    values('brand-logos','b1a10000-0000-4000-8000-000000000001/new.png',auth.uid()::text)$$,
  'an MFA admin can upload a logo into a brand folder'
);

select throws_ok(
  $$insert into storage.objects(bucket_id,name,owner_id)
    values('brand-logos','b1a1ffff-0000-4000-8000-000000000001/new.png',auth.uid()::text)$$,
  '42501', null,
  'an admin cannot upload into a folder with no brand'
);

-- The Storage API sets this before deleting; direct SQL deletes are blocked otherwise.
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects
where bucket_id='brand-logos' and name in (
  'b1a10000-0000-4000-8000-000000000001/logo.png',
  'b1a10000-0000-4000-8000-000000000001/old.png');

reset role;
select is(
  (select array_agg(name order by name) from storage.objects
   where bucket_id='brand-logos' and name in (
     'b1a10000-0000-4000-8000-000000000001/logo.png',
     'b1a10000-0000-4000-8000-000000000001/old.png')),
  array['b1a10000-0000-4000-8000-000000000001/logo.png'],
  'only a logo no brand points at can be deleted'
);

-- item_brands ---------------------------------------------------------------
set local role anon;

select results_eq(
  $$select b.item_id::text, b.brand_name, b.logo_path
    from public.item_brands(array(select id from bl_ids where key like 'store%' or key='product')) b
    order by b.brand_name$$,
  $$values
    ('b1a30000-0000-4000-8000-000000000001','구구밀크티','b1a10000-0000-4000-8000-000000000001/logo.png'),
    ('b1a30000-0000-4000-8000-000000000005','농심테스트','b1a10000-0000-4000-8000-000000000003/logo.webp')$$,
  'anon sees the provider brand for a store and items.brand_id for a product; hidden places, inactive brands and unbranded stores return nothing'
);

select is(
  (select count(*)::int from public.item_brands(
     array(select 'b1a30000-0000-4000-8000-000000000001'::uuid from generate_series(1,150)))),
  1,
  'duplicate ids collapse and the input is capped'
);

reset role;

select * from finish();
rollback;
