create table public.taste_dimensions (
  code text primary key,
  name text not null,
  description text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint taste_dimensions_code_check
    check (code ~ '^[a-z][a-z0-9_-]{1,31}$'),
  constraint taste_dimensions_name_check
    check (char_length(btrim(name)) between 1 and 40),
  constraint taste_dimensions_description_check
    check (char_length(btrim(description)) between 1 and 240)
);

create table public.category_taste_dimensions (
  category_id uuid not null references public.categories(id) on delete cascade,
  dimension_code text not null references public.taste_dimensions(code) on delete cascade,
  weight smallint not null default 100,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (category_id, dimension_code),
  constraint category_taste_dimensions_weight_check
    check (weight between 1 and 100)
);

create unique index category_taste_dimensions_one_primary_idx
  on public.category_taste_dimensions(category_id)
  where is_primary;

alter table public.taste_dimensions enable row level security;
alter table public.category_taste_dimensions enable row level security;

grant select on public.taste_dimensions to anon, authenticated;
grant select on public.category_taste_dimensions to anon, authenticated;
grant insert, update, delete on public.taste_dimensions to authenticated;
grant insert, update, delete on public.category_taste_dimensions to authenticated;
grant select, insert, update, delete on public.taste_dimensions to service_role;
grant select, insert, update, delete on public.category_taste_dimensions to service_role;

create policy taste_dimensions_public_read
on public.taste_dimensions
for select
to anon, authenticated
using (true);

create policy taste_dimensions_admin_insert
on public.taste_dimensions
for insert
to authenticated
with check ((select private.is_admin_mfa()));

create policy taste_dimensions_admin_update
on public.taste_dimensions
for update
to authenticated
using ((select private.is_admin_mfa()))
with check ((select private.is_admin_mfa()));

create policy taste_dimensions_admin_delete
on public.taste_dimensions
for delete
to authenticated
using ((select private.is_admin_mfa()));

create policy category_taste_dimensions_public_read
on public.category_taste_dimensions
for select
to anon, authenticated
using (true);

create policy category_taste_dimensions_admin_insert
on public.category_taste_dimensions
for insert
to authenticated
with check ((select private.is_admin_mfa()));

create policy category_taste_dimensions_admin_update
on public.category_taste_dimensions
for update
to authenticated
using ((select private.is_admin_mfa()))
with check ((select private.is_admin_mfa()));

create policy category_taste_dimensions_admin_delete
on public.category_taste_dimensions
for delete
to authenticated
using ((select private.is_admin_mfa()));

insert into public.taste_dimensions(code,name,description,display_order)
values
  ('food','음식','먹는 것에서 드러나는 맛과 익숙함의 취향',10),
  ('culture','문화','영화·음악·책·게임 등 콘텐츠와 팬덤 취향',20),
  ('tech','기술','기기와 도구에서 드러나는 기능·브랜드·사용감 취향',30),
  ('style','스타일','패션·향 등 외형과 감각적 선택에서 드러나는 취향',40),
  ('living','생활','문구·생활용품처럼 일상에서 반복적으로 사용하는 것의 취향',50)
on conflict (code) do update
set
  name=excluded.name,
  description=excluded.description,
  display_order=excluded.display_order,
  updated_at=now();

insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
values
  (gen_random_uuid(),null,'테크','tech','open',true,false),
  (gen_random_uuid(),null,'스타일','style','open',true,false)
on conflict (slug) do update
set
  name=excluded.name,
  status='open',
  is_visible=true,
  is_pickable=false,
  updated_at=now();

insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
select gen_random_uuid(), p.id, x.name, x.slug, 'open', true, true
from (
  values
    ('tech','키보드','keyboard'),
    ('tech','스마트폰','smartphone'),
    ('tech','헤드폰·이어폰','headphones-earphones'),
    ('style','운동화','sneakers'),
    ('style','향수','perfume')
) as x(parent_slug,name,slug)
join public.categories p on p.slug=x.parent_slug
on conflict (slug) do update
set
  parent_id=excluded.parent_id,
  name=excluded.name,
  status='open',
  is_visible=true,
  is_pickable=true,
  updated_at=now();

insert into public.category_catalog_sources(
  category_id,mode,provider,edge_function_slug,external_source,is_enabled,notes
)
select c.id,'internal',null,null,null,true,
       'Curated OnePick internal master catalog; user-uploaded photos preferred.'
from public.categories c
where c.slug in ('keyboard','smartphone','headphones-earphones','sneakers','perfume')
on conflict (category_id) do update
set
  mode='internal',
  provider=null,
  edge_function_slug=null,
  external_source=null,
  is_enabled=true,
  notes=excluded.notes,
  updated_at=now();

with mappings(category_slug,dimension_code,weight) as (
  values
    ('ramen','food',100),
    ('snacks','food',100),
    ('ice-cream','food',100),

    ('movie','culture',100),
    ('drama','culture',100),
    ('music','culture',100),
    ('game','culture',100),
    ('book','culture',100),
    ('youtube','culture',100),
    ('pokemon','culture',90),

    ('notebook','living',100),
    ('ballpoint-pen','living',100),

    ('keyboard','tech',100),
    ('smartphone','tech',100),
    ('headphones-earphones','tech',100),

    ('sneakers','style',100),
    ('perfume','style',100)
)
insert into public.category_taste_dimensions(
  category_id,dimension_code,weight,is_primary
)
select c.id,m.dimension_code,m.weight,true
from mappings m
join public.categories c on c.slug=m.category_slug
on conflict (category_id,dimension_code) do update
set
  weight=excluded.weight,
  is_primary=true,
  updated_at=now();

