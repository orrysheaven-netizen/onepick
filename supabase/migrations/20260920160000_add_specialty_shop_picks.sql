begin;

-- 전문몰 원픽: 하나 또는 소수 품목만 취급하는 판매처를 아이템으로 고른다.
-- docs/specialty-shop-pick.md. 카테고리 개방과 상업화 오염 방어를 한 마이그레이션에 둔다.
-- 오염된 데이터는 되돌릴 수 없다. 그 몰을 고른 사용자의 원픽까지 함께 지워야 하기 때문이다.

-- 1. 저장 시점 URL 정규화 --------------------------------------------------
--
-- 쿼리스트링을 통째로 버리는 것이 어필리에이트 파라미터(ref / utm_* / partner)
-- 방어의 핵심이다. 같은 몰이 파라미터만 달리해 여러 아이템으로 쪼개지는 것도
-- 같은 규칙으로 함께 막힌다.
--
-- 호스트가 곧 몰인 경우(자사몰, 카페24 / 아임웹 / 식스샵처럼 가입 시 고유
-- 서브도메인을 받는 입점몰)는 경로를 버리고 호스트만 남긴다. 반면 스마트스토어
-- 계열은 여러 몰이 호스트 하나를 공유하므로 첫 경로 세그먼트까지 살려야
-- 서로 다른 몰로 구분된다.
create or replace function private.normalize_shop_url(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  -- 한 호스트를 여러 몰이 나눠 쓰는 입점형 플랫폼만 첫 경로 세그먼트를 남긴다.
  v_shared_hosts constant text[] := array[
    'smartstore.naver.com',
    'brand.naver.com',
    'shop.naver.com'
  ];
  v_raw text := btrim(coalesce(p_url, ''));
  v_rest text;
  v_authority text;
  v_host text;
  v_path text;
  v_segment text;
begin
  if v_raw = '' then
    return null;
  end if;

  -- 스킴이 없으면 https를 가정하고, http(s)가 아닌 스킴은 받지 않는다.
  if v_raw !~ '^[a-zA-Z][a-zA-Z0-9+.-]*://' then
    v_raw := 'https://' || v_raw;
  end if;
  if v_raw !~* '^https?://' then
    return null;
  end if;

  v_rest := regexp_replace(v_raw, '^[a-zA-Z][a-zA-Z0-9+.-]*://', '');
  v_authority := (regexp_match(v_rest, '^([^/?#]*)'))[1];
  v_path := coalesce((regexp_match(v_rest, '^[^/?#]*(/[^?#]*)'))[1], '');

  -- userinfo는 버린다. https://real-shop.example@evil.example 같은 입력이
  -- 실제로는 evil.example로 향하기 때문이다.
  v_authority := regexp_replace(v_authority, '^.*@', '');
  v_host := lower(regexp_replace(v_authority, ':[0-9]*$', ''));
  v_host := regexp_replace(v_host, '\.$', '');
  v_host := regexp_replace(v_host, '^www\.', '');

  -- 라벨이 올바른 도메인만 받는다. 마지막 라벨이 알파벳이어야 하므로 IP 주소는 빠진다.
  if v_host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
     or v_host !~ '\.[a-z]{2,}$'
  then
    return null;
  end if;

  if v_host = any(v_shared_hosts) then
    -- 입점형 플랫폼은 세그먼트가 곧 몰이므로 루트 주소만으로는 몰을 특정할 수 없다.
    v_segment := (regexp_match(lower(v_path), '^/([^/]+)'))[1];
    if v_segment is null or v_segment = '' then
      return null;
    end if;
    return 'https://' || v_host || '/' || v_segment;
  end if;

  return 'https://' || v_host;
end;
$function$;

revoke all on function private.normalize_shop_url(text) from public, anon, authenticated;

-- 2. 마트형 판매처 차단 ------------------------------------------------------
--
-- 경계는 데이터로 판정할 수 없다. 여기 목록은 "여러 품목을 함께 파는 곳"의
-- 대표값일 뿐이고, 실제 기준은 카테고리 설명 문구가 지킨다.
create or replace function private.is_marketplace_shop_url(p_normalized_url text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_marketplace_hosts constant text[] := array[
    'naver.com','shopping.naver.com','search.shopping.naver.com',
    'coupang.com','kurly.com','oliveyoung.co.kr','oliveyoung.com',
    'gmarket.co.kr','auction.co.kr','11st.co.kr','ssg.com','emart.com',
    'lotteon.com','homeplus.co.kr','tmon.co.kr','wemakeprice.com',
    'interpark.com','danawa.com','musinsa.com','29cm.co.kr',
    'ably.co.kr','zigzag.kr','aliexpress.com','amazon.com','temu.com'
  ];
  v_host text;
  v_blocked text;
begin
  if p_normalized_url is null then
    return false;
  end if;

  v_host := (regexp_match(p_normalized_url, '^https://([^/]+)'))[1];
  if v_host is null then
    return false;
  end if;

  -- 스마트스토어처럼 호스트를 공유하는 입점몰은 경로가 붙어 있어 개별 몰이다.
  -- 마트형 판정은 호스트만 남은 주소에만 적용한다.
  if position('/' in substring(p_normalized_url from 9)) > 0 then
    return false;
  end if;

  foreach v_blocked in array v_marketplace_hosts loop
    if v_host = v_blocked or v_host like ('%.' || v_blocked) then
      return true;
    end if;
  end loop;

  return false;
end;
$function$;

revoke all on function private.is_marketplace_shop_url(text) from public, anon, authenticated;

-- 3. 전문몰 카테고리 판별 ----------------------------------------------------
-- SECURITY DEFINER for two reasons. Trigger functions below are not executed
-- by the system with extra rights: their bodies run as the writing user, who is
-- `authenticated` on every admin and user write, and that role has no execute
-- right on these helpers. It also keeps the answer independent of what the
-- writer can see through RLS, so a category row hidden from the writer cannot
-- silently turn the specialty-shop rules off.
create or replace function private.is_specialty_shop_category(p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  with recursive ancestors as (
    select c.id, c.parent_id, c.slug, 1 as depth
    from public.categories c
    where c.id = p_category_id
    union all
    select c.id, c.parent_id, c.slug, a.depth + 1
    from public.categories c
    join ancestors a on c.id = a.parent_id
    where a.depth < 4
  )
  select exists (select 1 from ancestors where slug = 'specialty-shop');
$function$;

revoke all on function private.is_specialty_shop_category(uuid) from public, anon, authenticated;

-- 4. 전문몰 아이템 저장 규칙 -------------------------------------------------
--
-- 트리거로 두는 이유: 사용자 제출 RPC, 관리자 등록/수정, 승인·병합 경로가 모두
-- items를 직접 쓴다. 경로마다 검사를 넣으면 한 곳이 빠진다.
-- 유일성은 부분 인덱스로 표현할 수 없다. 전문몰 여부가 카테고리 조회에 달려 있어
-- immutable이 아니기 때문이다. 기존 items_prevent_internal_duplicate와 같은
-- 권고 잠금 방식을 쓴다.
create or replace function private.enforce_specialty_shop_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_normalized text;
begin
  if not private.is_specialty_shop_category(new.category_id) then
    -- 전문몰이 아닌 아이템의 official_url은 건드리지 않는다. 외부 카탈로그
    -- 아이템은 경로까지 있는 주소가 의미를 갖는다.
    return new;
  end if;

  if new.official_url is null or btrim(new.official_url) = '' then
    raise exception 'SHOP_URL_REQUIRED' using errcode = 'P0001';
  end if;

  v_normalized := private.normalize_shop_url(new.official_url);
  if v_normalized is null then
    raise exception 'SHOP_URL_INVALID' using errcode = 'P0001';
  end if;

  if private.is_marketplace_shop_url(v_normalized) then
    raise exception 'SHOP_URL_NOT_SPECIALTY' using errcode = 'P0001';
  end if;

  new.official_url := v_normalized;

  if new.status in ('pending','active','discontinued') then
    perform pg_advisory_xact_lock(hashtextextended('shop-url:' || v_normalized, 0));

    if exists (
      select 1
      from public.items i
      where i.official_url = v_normalized
        and i.status in ('pending','active','discontinued')
        and i.id <> new.id
        and private.is_specialty_shop_category(i.category_id)
    ) then
      raise exception 'SHOP_URL_DUPLICATE' using errcode = '23505';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_specialty_shop_item() from public, anon, authenticated;

drop trigger if exists items_enforce_specialty_shop on public.items;
create trigger items_enforce_specialty_shop
before insert or update of category_id, official_url, status
on public.items
for each row
execute function private.enforce_specialty_shop_item();

-- 전문몰 아이템 유일성 검사가 순차 스캔으로 떨어지지 않게 한다.
create index if not exists items_official_url_active_idx
on public.items (official_url)
where official_url is not null and status in ('pending','active','discontinued');

-- 5. 한줄평 광고 차단 --------------------------------------------------------
--
-- 한줄평은 자유 텍스트라 그대로 광고판이 된다. 도메인처럼 보이는 토큰과
-- 코드가 따라붙은 쿠폰/추천인 문구만 막는다. 평범한 한국어 문장이 걸리지
-- 않도록 키워드 단독으로는 차단하지 않는다.
create or replace function private.review_contains_promotion(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    btrim(coalesce(p_text, '')) ~* '(https?://|\ywww\.)'
    or btrim(coalesce(p_text, '')) ~* '\y[a-z0-9][a-z0-9-]*\.(co\.kr|or\.kr|ne\.kr|com|net|org|kr|io|me|shop|store|xyz|biz|info)\y'
    -- 키워드 뒤에 코드처럼 보이는 토큰이 따라붙을 때만 막는다. 코드 토큰은
    -- 네 자 이상이면서 알파벳을 최소 하나 포함해야 하므로 "할인 3000원"처럼
    -- 숫자만 오는 평범한 문장은 걸리지 않는다. 같은 이유로 '할인'과 '적립'은
    -- 단독으로 쓰지 않고 '코드'가 붙은 형태만 키워드로 본다.
    or btrim(coalesce(p_text, '')) ~* '(쿠폰|프로모\s*션?|추천인|초대|할인\s*코드|적립\s*코드|coupon|promo|referral)\s*(코드|번호|code)?\s*[:：]?\s*(?=[a-z0-9]{4,}\y)[a-z0-9]*[a-z][a-z0-9]*\y',
    false
  );
$function$;

revoke all on function private.review_contains_promotion(text) from public, anon, authenticated;
grant execute on function private.review_contains_promotion(text) to authenticated;

create or replace function private.enforce_pick_review_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if private.review_contains_promotion(new.one_line_review) then
    raise exception 'REVIEW_PROMOTIONAL' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_pick_review_policy() from public, anon, authenticated;

drop trigger if exists picks_enforce_review_policy on public.picks;
create trigger picks_enforce_review_policy
before insert or update of one_line_review
on public.picks
for each row
execute function private.enforce_pick_review_policy();

-- 6. 신고 사유에 "본인이 운영하는 몰" 추가 ------------------------------------
alter table public.content_reports
  drop constraint if exists content_reports_reason_check;
alter table public.content_reports
  add constraint content_reports_reason_check
  check (reason in ('spam','harassment','inappropriate','misleading','self_promotion','other'));

-- 7. 전문몰 카테고리 개방 ----------------------------------------------------
--
-- 초기 개방은 6개다. content-seeding.md의 완료 기준이 카테고리당 사용자 3명,
-- 서로 다른 아이템 2개 이상이라 카테고리를 넓히면 어느 곳도 밀도에 닿지 못한다.
insert into public.categories(parent_id, name, slug, status, is_visible, is_pickable, sort_order)
values (null, '전문몰', 'specialty-shop', 'open', true, false, 10)
on conflict (slug) do update
set name = excluded.name,
    parent_id = null,
    status = 'open',
    is_visible = true,
    is_pickable = false,
    updated_at = now();

insert into public.categories(parent_id, name, slug, status, is_visible, is_pickable, sort_order)
select
  (select id from public.categories where slug = 'specialty-shop'),
  seed.name,
  seed.slug,
  'open',
  true,
  true,
  seed.sort_order
from (values
  ('원두 전문몰',      'specialty-shop-coffee-beans', 10),
  ('차 전문몰',        'specialty-shop-tea',          20),
  ('양말 전문몰',      'specialty-shop-socks',        30),
  ('문구 전문몰',      'specialty-shop-stationery',   40),
  ('향 전문몰',        'specialty-shop-fragrance',    50),
  ('수제 조미료 전문몰','specialty-shop-seasoning',    60)
) as seed(name, slug, sort_order)
on conflict (slug) do update
set name = excluded.name,
    parent_id = excluded.parent_id,
    status = 'open',
    is_visible = true,
    is_pickable = true,
    sort_order = excluded.sort_order,
    updated_at = now();

-- 전문몰에는 외부 카탈로그가 없다. 아이템은 사용자 제출과 관리자 등록으로만
-- 들어오므로 기존 내부 카탈로그 중복 방지를 함께 켠다.
insert into public.category_catalog_sources(category_id, mode, is_enabled, notes)
select c.id, 'internal', true, '전문몰은 외부 카탈로그가 없다. 관리자 사전 등록과 사용자 제출로만 채운다.'
from public.categories c
where c.slug like 'specialty-shop-%'
on conflict (category_id) do update
set mode = 'internal',
    is_enabled = true,
    updated_at = now();

commit;
