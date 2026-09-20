begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  shop_root uuid; shop_cat uuid; other_cat uuid;
  owner_id uuid := gen_random_uuid();
  item_a uuid := gen_random_uuid(); item_b uuid := gen_random_uuid();
  item_c uuid := gen_random_uuid(); plain_item uuid := gen_random_uuid();
  pick_id uuid := gen_random_uuid();
  stored text;
begin
  select id into shop_root from public.categories where slug='specialty-shop';
  assert shop_root is not null, '전문몰 최상위 카테고리가 열려 있다';
  assert not (select is_pickable from public.categories where id=shop_root),
    '최상위는 선택 대상이 아니다';
  assert (select count(*) from public.categories where slug like 'specialty-shop-%')=6,
    '초기 개방은 상품군 6개다';

  select id into shop_cat from public.categories where slug='specialty-shop-coffee-beans';
  assert private.is_specialty_shop_category(shop_cat), '말단 카테고리는 전문몰로 판정된다';

  insert into auth.users(id,aud,role,created_at,updated_at)
    values(owner_id,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed)
    values(owner_id,'shop_owner_test',true);

  -- 정규화: 어필리에이트 파라미터, www, 대소문자, 경로가 모두 같은 주소로 모인다.
  insert into public.items(id,category_id,name,normalized_name,status,official_url)
    values(item_a,shop_cat,'테스트 로스터리','테스트로스터리','active',
           'https://www.Test-Roastery.com/shop?ref=kakao&utm_source=blog');
  select official_url into stored from public.items where id=item_a;
  assert stored='https://test-roastery.com',
    '쿼리스트링과 www가 제거된 정규 주소로 저장된다: '||coalesce(stored,'<null>');

  begin
    insert into public.items(id,category_id,name,normalized_name,status,official_url)
      values(item_b,shop_cat,'같은 몰 다른 이름','같은몰다른이름','active',
             'http://TEST-ROASTERY.com:8080/about#intro');
    raise exception '같은 몰의 중복 등록은 거부되어야 한다';
  exception when others then
    assert sqlerrm like '%SHOP_URL_DUPLICATE%', '중복 몰 거부: '||sqlerrm;
  end;

  -- 입점형 플랫폼은 첫 경로 세그먼트까지 살려야 서로 다른 몰로 구분된다.
  insert into public.items(id,category_id,name,normalized_name,status,official_url)
    values(item_b,shop_cat,'스마트스토어 몰','스마트스토어몰','active',
           'https://smartstore.naver.com/MyBeans/products/99?ref=x');
  select official_url into stored from public.items where id=item_b;
  assert stored='https://smartstore.naver.com/mybeans',
    '입점몰은 첫 경로 세그먼트까지 남는다: '||coalesce(stored,'<null>');

  insert into public.items(id,category_id,name,normalized_name,status,official_url)
    values(item_c,shop_cat,'다른 입점몰','다른입점몰','active',
           'https://smartstore.naver.com/OtherBeans');
  assert (select count(*) from public.items
          where category_id=shop_cat and status='active')=3,
    '같은 호스트라도 세그먼트가 다르면 다른 몰이다';

  begin
    insert into public.items(id,category_id,name,normalized_name,status,official_url)
      values(gen_random_uuid(),shop_cat,'루트 입점몰','루트입점몰','active',
             'https://smartstore.naver.com/');
    raise exception '세그먼트 없는 입점형 주소는 거부되어야 한다';
  exception when others then
    assert sqlerrm like '%SHOP_URL_INVALID%', '세그먼트 없는 입점 주소 거부: '||sqlerrm;
  end;

  -- 마트형은 전문몰이 아니다.
  begin
    insert into public.items(id,category_id,name,normalized_name,status,official_url)
      values(gen_random_uuid(),shop_cat,'쿠팡','쿠팡','active','https://www.coupang.com/vp/1');
    raise exception '마트형 판매처는 거부되어야 한다';
  exception when others then
    assert sqlerrm like '%SHOP_URL_NOT_SPECIALTY%', '마트형 거부: '||sqlerrm;
  end;

  begin
    insert into public.items(id,category_id,name,normalized_name,status,official_url)
      values(gen_random_uuid(),shop_cat,'주소 없음','주소없음','active',null);
    raise exception '전문몰 아이템은 주소가 필요하다';
  exception when others then
    assert sqlerrm like '%SHOP_URL_REQUIRED%', '주소 누락 거부: '||sqlerrm;
  end;

  begin
    insert into public.items(id,category_id,name,normalized_name,status,official_url)
      values(gen_random_uuid(),shop_cat,'잘못된 주소','잘못된주소','active','ftp://example.com');
    raise exception 'http(s)가 아닌 주소는 거부되어야 한다';
  exception when others then
    assert sqlerrm like '%SHOP_URL_INVALID%', '비 http 주소 거부: '||sqlerrm;
  end;

  -- 전문몰이 아닌 아이템의 official_url은 건드리지 않는다.
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(gen_random_uuid(),'일반 카테고리','plain-category-test','open',true,true)
    returning id into other_cat;
  insert into public.items(id,category_id,name,normalized_name,status,official_url)
    values(plain_item,other_cat,'일반 상품','일반상품','active',
           'https://www.themoviedb.org/movie/123?language=ko');
  select official_url into stored from public.items where id=plain_item;
  assert stored='https://www.themoviedb.org/movie/123?language=ko',
    '전문몰이 아닌 아이템 주소는 원본 그대로다: '||coalesce(stored,'<null>');

  -- 한줄평 광고 차단.
  begin
    insert into public.picks(id,user_id,category_id,item_id,one_line_review,status)
      values(gen_random_uuid(),owner_id,shop_cat,item_a,'여기서 사세요 https://myshop.com','active');
    raise exception '링크가 담긴 한줄평은 거부되어야 한다';
  exception when others then
    assert sqlerrm like '%REVIEW_PROMOTIONAL%', '링크 한줄평 거부: '||sqlerrm;
  end;

  begin
    insert into public.picks(id,user_id,category_id,item_id,one_line_review,status)
      values(gen_random_uuid(),owner_id,shop_cat,item_a,'쿠폰코드 WELCOME10 쓰면 더 싸요','active');
    raise exception '할인코드가 담긴 한줄평은 거부되어야 한다';
  exception when others then
    assert sqlerrm like '%REVIEW_PROMOTIONAL%', '할인코드 한줄평 거부: '||sqlerrm;
  end;

  -- 평범한 문장은 통과한다. 키워드만으로 막지 않는다.
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status)
    values(pick_id,owner_id,shop_cat,item_a,'쿠폰 없어도 원래 싸고 로스팅이 신선하다','active');
  assert (select count(*) from public.picks where id=pick_id)=1,
    '평범한 한줄평은 저장된다';

  begin
    update public.picks set one_line_review='myshop.co.kr 에서 사세요' where id=pick_id;
    raise exception '한줄평 수정에도 같은 규칙이 적용되어야 한다';
  exception when others then
    assert sqlerrm like '%REVIEW_PROMOTIONAL%', '수정 경로 차단: '||sqlerrm;
  end;

  -- 신고 사유에 본인 운영 몰이 추가됐다.
  assert (
    select pg_get_constraintdef(oid) like '%self_promotion%'
    from pg_constraint where conname='content_reports_reason_check'
  ), '신고 사유에 self_promotion이 있다';
end;
$flow$;
$test$, '전문몰 카테고리, URL 정규화와 중복 방지, 마트형 차단, 한줄평 광고 차단, 신고 사유');
select * from finish();
rollback;
