-- 원픽에 구매처 링크와 쇼핑꿀팁을 붙인다. docs/pick-purchase-link.md 참조.
--
-- 테마 컬럼을 만들지 않는다. 쇼핑꿀팁 표시는 purchase_tip 유무에서 파생하므로
-- 라벨과 내용이 어긋날 수 없다. picks_one_current_per_category는 그대로 두며
-- 링크는 카테고리당 원픽 수를 늘리지 않는다.

alter table public.picks
  add column purchase_url text,
  add column purchase_tip text;

comment on column public.picks.purchase_url is
  'Where this person bought the item. Per-pick, unlike items.official_url which is the shared official link.';
comment on column public.picks.purchase_tip is
  'Buying advice worth passing on. Its presence is what marks a pick as 쇼핑꿀팁; there is no separate theme column.';

alter table public.picks
  add constraint picks_purchase_url_shape check (
    purchase_url is null
    or (purchase_url ~ '^https://[^[:space:]]+$' and char_length(purchase_url) <= 2048)
  ),
  add constraint picks_purchase_tip_length check (
    purchase_tip is null or char_length(btrim(purchase_tip)) between 1 and 100
  ),
  -- A tip with nowhere to buy is not a tip. The reverse is fine: a link alone
  -- identifies the item without claiming to be advice.
  add constraint picks_purchase_tip_requires_url check (
    purchase_tip is null or purchase_url is not null
  );

-- 추적·제휴 파라미터 목록. 허용 목록이 아니라 거부 목록이다. 상품 식별
-- 파라미터가 쇼핑몰마다 달라 허용 목록은 정상 링크를 깨뜨린다. 새 파라미터는
-- 이 함수를 교체하는 마이그레이션으로 추가한다.
--
-- pid / sid / src / source는 넣지 않는다. 쇼핑몰에 따라 상품 식별에 쓰여
-- 지우면 링크가 깨진다. 제휴 차단보다 링크가 살아 있는 쪽을 택했다.
create or replace function private.is_tracking_param(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name like 'utm\_%' escape '\'
      or p_name like 'n\_%' escape '\'          -- 네이버 검색광고
      or p_name in (
        'gclid','fbclid','msclkid','igshid','ttclid','yclid','dclid','twclid',
        'ref','referrer','referer','trk','trkcode','spm','scm',
        'affiliate','affiliate_id','aff','aff_id','affid','partner','partner_id',
        'subid','sub_id','clickid','click_id','traceid','trace_id',
        'wpuid','lptag','addtag','ctag','itime','napm','mkt_src','channel_id'
      );
$$;

-- 저장 전에 URL을 정규화한다. 클라이언트에서만 걸면 REST를 직접 불러 우회할
-- 수 있으므로 쓰기 경로의 DB 쪽에서 한다.
create or replace function private.normalize_purchase_url(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_raw text := btrim(coalesce(p_url, ''));
  v_base text;
  v_query text;
  v_pair text;
  v_kept text[] := '{}';
  v_result text;
begin
  if v_raw = '' then return null; end if;
  if char_length(v_raw) > 2048 or v_raw ~ '[[:space:]]' then
    raise exception 'PURCHASE_URL_INVALID' using errcode = 'P0001';
  end if;
  -- https만 받는다. http, javascript:, data:, 앱 스킴은 저장에 닿지 않는다.
  if v_raw !~* '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?([/?#]|$)' then
    raise exception 'PURCHASE_URL_INVALID' using errcode = 'P0001';
  end if;

  -- 프래그먼트는 버린다. 상품 링크에 필요하지 않고 추적값을 숨기기 좋은 자리다.
  v_raw := split_part(v_raw, '#', 1);
  v_base := split_part(v_raw, '?', 1);
  v_query := nullif(substr(v_raw, char_length(v_base) + 2), '');

  if v_query is not null then
    foreach v_pair in array string_to_array(v_query, '&') loop
      if v_pair = '' then continue; end if;
      if private.is_tracking_param(lower(split_part(v_pair, '=', 1))) then continue; end if;
      v_kept := v_kept || v_pair;
    end loop;
  end if;

  v_result := v_base
    || case when coalesce(array_length(v_kept, 1), 0) = 0
            then '' else '?' || array_to_string(v_kept, '&') end;

  if char_length(v_result) > 2048 then
    raise exception 'PURCHASE_URL_INVALID' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

create or replace function private.normalize_purchase_tip(p_tip text, p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_tip text := btrim(coalesce(p_tip, ''));
begin
  if v_tip = '' then return null; end if;
  if p_url is null then
    raise exception 'PURCHASE_TIP_WITHOUT_URL' using errcode = 'P0001';
  end if;
  if char_length(v_tip) > 100 then
    raise exception 'PURCHASE_TIP_INVALID' using errcode = 'P0001';
  end if;
  return v_tip;
end;
$$;

-- 쇼핑몰 도메인 목록. 앱을 다시 배포하지 않고 고칠 수 있어야 해서 테이블로 둔다.
-- 이 목록은 "언제 물어볼지"만 정한다. 원픽이 쇼핑꿀팁인지는 사용자가 정한다.
create table public.shopping_domains (
  domain text primary key,
  match_type text not null default 'host' check (match_type in ('host', 'suffix')),
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shopping_domains_shape check (
    domain = lower(domain)
    and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    and char_length(domain) <= 253
  ),
  constraint shopping_domains_label_length check (char_length(btrim(label)) between 1 and 40)
);

comment on table public.shopping_domains is
  'Hosts that make the registration flow offer the shopping-tip question. Never a bare parent domain that also serves non-shop services.';

create trigger shopping_domains_set_updated_at
before update on public.shopping_domains
for each row execute function private.set_updated_at();

alter table public.shopping_domains enable row level security;
revoke all on public.shopping_domains from public, anon, authenticated;
grant select on public.shopping_domains to anon, authenticated;
grant insert, update, delete on public.shopping_domains to authenticated;
grant all on public.shopping_domains to service_role;

create policy shopping_domains_public_read
on public.shopping_domains for select to anon, authenticated
using (is_active);

create policy shopping_domains_admin_read
on public.shopping_domains for select to authenticated
using ((select private.is_admin_mfa()));

create policy shopping_domains_admin_insert
on public.shopping_domains for insert to authenticated
with check ((select private.is_admin_mfa()));

create policy shopping_domains_admin_update
on public.shopping_domains for update to authenticated
using ((select private.is_admin_mfa()))
with check ((select private.is_admin_mfa()));

create policy shopping_domains_admin_delete
on public.shopping_domains for delete to authenticated
using ((select private.is_admin_mfa()));

-- naver.com을 통째로 넣지 않는다. 블로그·카페·뉴스가 같은 도메인에 있다.
insert into public.shopping_domains(domain, match_type, label) values
  ('coupang.com', 'suffix', '쿠팡'),
  ('smartstore.naver.com', 'suffix', '네이버 스마트스토어'),
  ('brand.naver.com', 'suffix', '네이버 브랜드스토어'),
  ('shopping.naver.com', 'suffix', '네이버 쇼핑'),
  ('11st.co.kr', 'suffix', '11번가'),
  ('gmarket.co.kr', 'suffix', 'G마켓'),
  ('auction.co.kr', 'suffix', '옥션'),
  ('ssg.com', 'suffix', 'SSG닷컴'),
  ('lotteon.com', 'suffix', '롯데온'),
  ('tmon.co.kr', 'suffix', '티몬'),
  ('interpark.com', 'suffix', '인터파크'),
  ('musinsa.com', 'suffix', '무신사'),
  ('oliveyoung.co.kr', 'suffix', '올리브영'),
  ('kurly.com', 'suffix', '컬리'),
  ('ohou.se', 'suffix', '오늘의집'),
  ('aliexpress.com', 'suffix', '알리익스프레스'),
  ('amazon.com', 'suffix', 'Amazon')
on conflict (domain) do nothing;

-- 호스트 정확 일치 또는 명시한 접미사만 본다. 상위 도메인을 통째로 쇼핑몰로
-- 보지 않는다. 단축 URL은 목적지를 알 수 없으므로 펼치지 않고 쇼핑몰로도
-- 보지 않는다. 서버는 사용자 URL을 절대 가져오지 않는다.
create or replace function private.purchase_url_host(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(nullif(
    split_part(split_part(split_part(regexp_replace(coalesce(p_url, ''), '^https://', '', 'i'), '/', 1), '?', 1), '#', 1),
    ''
  ));
$$;

create or replace function public.is_shopping_url(p_url text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.shopping_domains d
    where d.is_active
      and (
        private.purchase_url_host(p_url) = d.domain
        or (d.match_type = 'suffix'
            and private.purchase_url_host(p_url) like '%.' || d.domain)
      )
  );
$$;

revoke all on function private.is_tracking_param(text) from public, anon;
revoke all on function private.normalize_purchase_url(text) from public, anon;
revoke all on function private.normalize_purchase_tip(text, text) from public, anon;
revoke all on function private.purchase_url_host(text) from public, anon;
grant execute on function private.is_tracking_param(text) to authenticated, service_role;
grant execute on function private.normalize_purchase_url(text) to authenticated, service_role;
grant execute on function private.normalize_purchase_tip(text, text) to authenticated, service_role;
grant execute on function private.purchase_url_host(text) to anon, authenticated, service_role;
grant execute on function public.is_shopping_url(text) to anon, authenticated, service_role;

-- 쓰기 경로에 링크와 팁을 받는다. 기존 3/2인자 함수는 남겨두면 기본값과
-- 겹쳐 호출이 모호해지므로 교체한다.
--
-- 두 인자의 계약: null은 "그대로 두기", 빈 문자열은 "지우기"다. 한줄평만
-- 고치는 기존 호출이 링크를 조용히 지우면 안 되기 때문이다. 상품이 바뀌면
-- 이전 구매처는 더 이상 그 원픽의 것이 아니므로 이어받지 않는다.
drop function if exists public.change_pick(uuid, uuid, text);
drop function if exists private.change_pick_impl(uuid, uuid, text);
drop function if exists public.update_pick_review(uuid, text);
drop function if exists private.update_pick_review_impl(uuid, text);

create or replace function private.change_pick_impl(
  p_category_id uuid,
  p_item_id uuid,
  p_one_line_review text,
  p_purchase_url text,
  p_purchase_tip text
)
returns public.picks
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_review text := btrim(p_one_line_review);
  v_fresh_url text := case when p_purchase_url is null then null
                           else private.normalize_purchase_url(p_purchase_url) end;
  v_url text;
  v_tip text;
  v_category public.categories%rowtype;
  v_item public.items%rowtype;
  v_current public.picks%rowtype;
  v_result public.picks%rowtype;
  v_new_pick_id uuid := gen_random_uuid();
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.profiles where id=v_user_id) then
    raise exception 'PROFILE_NOT_FOUND' using errcode='P0001';
  end if;
  if v_review is null or char_length(v_review)<1 or char_length(v_review)>100 then
    raise exception 'REVIEW_INVALID' using errcode='P0001';
  end if;

  select * into v_category from public.categories where id=p_category_id;
  if not found then raise exception 'CATEGORY_NOT_FOUND' using errcode='P0001'; end if;
  if v_category.status<>'open' or v_category.is_pickable is not true
     or exists(select 1 from public.categories where parent_id=p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  select * into v_item from public.items where id=p_item_id;
  if not found then raise exception 'ITEM_NOT_FOUND' using errcode='P0001'; end if;
  if v_item.category_id<>p_category_id then
    raise exception 'ITEM_CATEGORY_MISMATCH' using errcode='P0001';
  end if;
  if v_item.status not in ('active','discontinued') then
    raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text||':'||p_category_id::text,0)
  );

  select * into v_current
  from public.picks
  where user_id=v_user_id
    and category_id=p_category_id
    and status in ('active','needs_review')
  for update;

  if found and v_current.item_id=p_item_id then
    -- 같은 상품: 넘어오지 않은 값은 지금 저장된 값을 이어간다. 링크가 지워지면
    -- 팁도 함께 끝난다. 살 곳 없는 팁은 팁이 아니다.
    v_url := case when p_purchase_url is null then v_current.purchase_url else v_fresh_url end;
    v_tip := case
      when p_purchase_tip is not null then private.normalize_purchase_tip(p_purchase_tip, v_url)
      when v_url is null then null
      else v_current.purchase_tip
    end;

    update public.picks
    set one_line_review=v_review,purchase_url=v_url,purchase_tip=v_tip,
        status='active',ended_at=null,updated_at=now()
    where id=v_current.id
    returning * into v_result;
    return v_result;
  end if;

  -- 새 원픽이다. 상품이 달라졌으면 이전 구매처는 이 선택의 것이 아니다.
  v_url := v_fresh_url;
  v_tip := private.normalize_purchase_tip(p_purchase_tip, v_url);

  if found then
    update public.picks
    set status='replaced',ended_at=now(),replaced_by_pick_id=v_new_pick_id,updated_at=now()
    where id=v_current.id;
  end if;

  insert into public.picks(
    id,user_id,category_id,item_id,one_line_review,purchase_url,purchase_tip,
    status,started_at,ended_at,replaced_by_pick_id
  ) values (
    v_new_pick_id,v_user_id,p_category_id,p_item_id,v_review,v_url,v_tip,
    'active',now(),null,null
  )
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.change_pick(
  p_category_id uuid,
  p_item_id uuid,
  p_one_line_review text,
  p_purchase_url text default null,
  p_purchase_tip text default null
)
returns public.picks
language sql
set search_path to ''
as $$
  select private.change_pick_impl(p_category_id,p_item_id,p_one_line_review,p_purchase_url,p_purchase_tip);
$$;

-- 한줄평 편집과 마찬가지로 started_at을 바꾸지 않는다. 링크나 팁만 고친 것이
-- 홈 상단으로 다시 올라오지 않는다.
create or replace function private.update_pick_review_impl(
  p_pick_id uuid,
  p_one_line_review text,
  p_purchase_url text,
  p_purchase_tip text
)
returns public.picks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_review text := btrim(p_one_line_review);
  v_url text;
  v_tip text;
  v_pick public.picks%rowtype;
  v_result public.picks%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if v_review is null or char_length(v_review) < 1 or char_length(v_review) > 100 then
    raise exception 'REVIEW_INVALID' using errcode = 'P0001';
  end if;

  select * into v_pick from public.picks where id = p_pick_id;
  if not found then
    raise exception 'PICK_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_pick.user_id <> v_user_id then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || v_pick.category_id::text, 0)
  );

  select * into v_pick from public.picks where id = p_pick_id for update;

  if not found
     or v_pick.user_id <> v_user_id
     or v_pick.status not in ('active','needs_review') then
    raise exception 'PICK_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_url := case when p_purchase_url is null then v_pick.purchase_url
                else private.normalize_purchase_url(p_purchase_url) end;
  v_tip := case
    when p_purchase_tip is not null then private.normalize_purchase_tip(p_purchase_tip, v_url)
    when v_url is null then null
    else v_pick.purchase_tip
  end;

  update public.picks
  set one_line_review = v_review,
      purchase_url = v_url,
      purchase_tip = v_tip,
      status = 'active',
      updated_at = now()
  where id = v_pick.id
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.update_pick_review(
  p_pick_id uuid,
  p_one_line_review text,
  p_purchase_url text default null,
  p_purchase_tip text default null
)
returns public.picks
language sql
set search_path = ''
as $$
  select private.update_pick_review_impl(p_pick_id,p_one_line_review,p_purchase_url,p_purchase_tip);
$$;

revoke all on function private.change_pick_impl(uuid,uuid,text,text,text) from public,anon;
revoke all on function private.update_pick_review_impl(uuid,text,text,text) from public,anon;
revoke all on function public.change_pick(uuid,uuid,text,text,text) from public,anon;
revoke all on function public.update_pick_review(uuid,text,text,text) from public,anon;
grant execute on function private.change_pick_impl(uuid,uuid,text,text,text) to authenticated;
grant execute on function private.update_pick_review_impl(uuid,text,text,text) to authenticated;
grant execute on function public.change_pick(uuid,uuid,text,text,text) to authenticated,service_role;
grant execute on function public.update_pick_review(uuid,text,text,text) to authenticated,service_role;

-- register_pick_impl은 내부에서 3인자 change_pick_impl을 부른다. 위에서 그
-- 함수를 교체했으므로 이 호출도 함께 옮긴다. 본문은 20260918115537의 정의를
-- 그대로 두고 호출 한 줄만 바꿨다.
create or replace function private.register_pick_impl(
  p_category_id uuid, p_item_id uuid, p_item_name text, p_one_line_review text,
  p_image_path text, p_thumbnail_path text, p_image_source_url text
)
returns public.picks language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_category public.categories%rowtype;
  v_item public.items%rowtype;
  v_result public.picks%rowtype;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.profiles where id=v_user) then
    raise exception 'PROFILE_NOT_FOUND' using errcode='P0001';
  end if;
  if p_one_line_review is null or char_length(btrim(p_one_line_review)) not between 1 and 100 then
    raise exception 'REVIEW_INVALID' using errcode='P0001';
  end if;
  select * into v_category from public.categories where id=p_category_id;
  if not found or not v_category.is_visible or not v_category.is_pickable or v_category.status<>'open'
     or exists(select 1 from public.categories where parent_id=p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;
  if p_item_id is null then raise exception 'ITEM_SELECTION_REQUIRED' using errcode='P0001'; end if;
  select * into v_item from public.items where id=p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND' using errcode='P0001'; end if;
  if v_item.category_id<>p_category_id then raise exception 'ITEM_CATEGORY_MISMATCH' using errcode='P0001'; end if;
  if v_item.status not in ('active','discontinued') then raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001'; end if;
  if v_item.image_path is null and v_item.thumbnail_path is null and v_item.image_source_url is null
     and (p_image_path is not null or p_thumbnail_path is not null) then
    if p_image_path is null or p_thumbnail_path is null or p_image_path=p_thumbnail_path
       or split_part(p_image_path,'/',1)<>v_user::text or split_part(p_thumbnail_path,'/',1)<>v_user::text then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;
    perform 1 from storage.objects where bucket_id='item-photos' and name=p_image_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 786432 for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;
    perform 1 from storage.objects where bucket_id='item-photos' and name=p_thumbnail_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 98304 for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;
    if p_image_source_url is not null and (char_length(p_image_source_url)>2048 or p_image_source_url !~ '^https://') then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;
    update public.items set image_path=p_image_path, thumbnail_path=p_thumbnail_path,
      image_source_url=p_image_source_url where id=v_item.id;
  end if;
  -- 이 경로는 아직 구매처 링크를 받지 않는다. 링크 인자를 명시적으로 비워
  -- 넘겨, 나중에 여기에도 붙일 자리를 드러내 둔다.
  v_result := private.change_pick_impl(p_category_id,v_item.id,btrim(p_one_line_review),null,null);
  return v_result;
end;
$function$;
