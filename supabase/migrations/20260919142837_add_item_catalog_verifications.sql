create table public.item_catalog_verifications (
  item_id uuid primary key references public.items(id) on delete cascade,
  verification_state text not null
    check (verification_state in ('verified_active','verified_discontinued','needs_review')),
  source_type text
    check (source_type is null or source_type in ('manufacturer','official_store','major_retailer','other')),
  source_url text,
  notes text,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint item_catalog_verifications_source_url_check
    check (
      source_url is null
      or (
        char_length(source_url) <= 2048
        and source_url ~ '^https://'
      )
    ),
  constraint item_catalog_verifications_notes_check
    check (
      notes is null
      or char_length(btrim(notes)) between 1 and 500
    ),
  constraint item_catalog_verifications_verified_source_required
    check (
      verification_state = 'needs_review'
      or (source_type is not null and source_url is not null)
    )
);

alter table public.item_catalog_verifications enable row level security;

grant select, insert, update, delete on public.item_catalog_verifications to authenticated;
grant select, insert, update, delete on public.item_catalog_verifications to service_role;

create policy item_catalog_verifications_admin_select
on public.item_catalog_verifications
for select
to authenticated
using ((select private.is_admin_mfa()));

create policy item_catalog_verifications_admin_insert
on public.item_catalog_verifications
for insert
to authenticated
with check ((select private.is_admin_mfa()));

create policy item_catalog_verifications_admin_update
on public.item_catalog_verifications
for update
to authenticated
using ((select private.is_admin_mfa()))
with check ((select private.is_admin_mfa()));

create policy item_catalog_verifications_admin_delete
on public.item_catalog_verifications
for delete
to authenticated
using ((select private.is_admin_mfa()));

with evidence(item_name, verification_state, source_type, source_url, notes) as (
  values
    ('수타면','verified_active','manufacturer',
      'https://www.samyangfoods.com/kor/brand/view.do?pageIndex=6&pageUnit=10&searchCateCd1=45&seq=36',
      'Manufacturer product page remains available; current retail listing also observed.'),
    ('쇠고기면','verified_active','manufacturer',
      'https://www.samyangfoods.com/kor/brand/view.do?seq=478',
      'Manufacturer product page exposes purchase flow.'),
    ('뽀로로 짜장','verified_active','manufacturer',
      'https://paldofood.co.kr/product/noodle/165',
      'Current Paldo product page.'),
    ('순하군 안성탕면','verified_active','official_store',
      'https://nongshimmall.com/product/%EC%88%9C%ED%95%98%EA%B5%B0%EC%95%88%EC%84%B1%ED%83%95%EB%A9%B41255/4013/',
      'Nongshim official store listing with 2026 reviews.'),
    ('해물안성탕면','verified_active','official_store',
      'https://nongshimmall.com/product/%ED%95%B4%EB%AC%BC%EC%95%88%EC%84%B1%ED%83%95%EB%A9%B4112g5/2666/',
      'Nongshim official store listing remains current.'),
    ('앵그리 너구리','verified_active','official_store',
      'https://m.nongshimmall.com/product/detail.html?cate_no=419&display_group=1&product_no=2638',
      'Nongshim official store listing with 2026 reviews.'),
    ('카레면','verified_active','official_store',
      'https://www.otokimall.com/front/product/search_result?keyword=%EC%B9%B4%EB%A0%88%EB%A9%B4',
      'Otoki Mall current search results plus current retail stock evidence.'),
    ('컵누들 매콤찜닭맛','verified_active','official_store',
      'https://www.otokimall.com/front/product/2404',
      'Current Otoki Mall product listing.'),
    ('컵누들 베트남쌀국수','verified_active','official_store',
      'https://www.otokimall.com/front/product/2997',
      'Current Otoki Mall bundle includes this exact product.'),
    ('탱글 머쉬룸크림 파스타','verified_active','manufacturer',
      'https://www.samyangfoods.com/kor/brand/view.do?pageIndex=1&pageUnit=12&seq=677',
      'Current Samyang product page.'),
    ('탱글 갈릭오일 파스타','verified_active','manufacturer',
      'https://www.samyangfoods.com/kor/brand/view.do?pageIndex=1&seq=678',
      'Current Samyang product page.'),
    ('탱글 바질토마토 프로틴 파스타','verified_active','manufacturer',
      'https://www.samyangfoods.com/kor/brand/view.do?seq=686',
      'Current Samyang product page; launched 2026.'),
    ('탱글 갈릭쉬림프 프로틴 파스타','verified_active','manufacturer',
      'https://www.samyangfoods.com/kor/brand/view.do?seq=688',
      'Current Samyang product page; launched 2026.'),
    ('짜왕 건면','verified_discontinued','official_store',
      'https://www.nongshimmall.com/article/%EB%86%8D%EC%8B%AC%EB%AA%B0-%EB%A6%AC%EB%B7%B0-%EB%AA%A8%EC%95%84%EB%B3%B4%EA%B8%B0/4/32712/',
      'Nongshim Mall legacy listing is labeled 종료; item retained as discontinued.'),
    ('바지락칼국수','needs_review','major_retailer',
      'https://www.ssg.com/item/itemView.ssg?itemId=1000273466326',
      'Current retail listing exists, but manufacturer confirmation was not found.'),
    ('봉희설렁탕면','needs_review',null,null,
      'No sufficiently reliable current manufacturer or official-store evidence found.'),
    ('치즈라면','needs_review','manufacturer',
      'https://www.otoki.com/pr/news-detail?idx=911',
      'Manufacturer has current 2026 cheesy ramen line, but exact domestic SKU identity is ambiguous.')
)
insert into public.item_catalog_verifications (
  item_id, verification_state, source_type, source_url, notes, verified_at
)
select
  i.id, e.verification_state, e.source_type, e.source_url, e.notes, now()
from evidence e
join public.categories c on c.slug='ramen'
join public.items i on i.category_id=c.id and i.name=e.item_name
on conflict (item_id) do update
set
  verification_state=excluded.verification_state,
  source_type=excluded.source_type,
  source_url=excluded.source_url,
  notes=excluded.notes,
  verified_at=excluded.verified_at,
  updated_at=now();

