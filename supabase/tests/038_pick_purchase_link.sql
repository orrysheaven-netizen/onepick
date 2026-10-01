-- 구매처 링크와 쇼핑꿀팁. docs/pick-purchase-link.md 참조.
--
-- 중요한 것 셋: 제휴·추적 파라미터가 RPC를 우회한 쓰기에서도 남지 않는가,
-- 팁만 있고 살 곳이 없는 행이 막히는가, 쇼핑몰 판별이 상위 도메인을 통째로
-- 삼키지 않는가.
begin;
-- Keep this legacy fixture focused on its original contract after the
-- photo-required Pick invariant. Rolled back with this pgTAP transaction.
alter table public.items alter column image_source_url
  set default 'https://example.test/onepick-test-item.png'; -- test fixture default for the photo-required Pick invariant

create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values ('38383838-3838-4838-8838-383838383838', 'authenticated', 'authenticated', 'purchase-link@example.com', '', now(), now());

insert into public.profiles (id, username, onboarding_completed)
values ('38383838-3838-4838-8838-383838383838', 'purchase_link_user', true);

insert into public.categories (id, name, slug, status, is_visible, is_pickable)
values ('38a38a38-a38a-4a38-8a38-a38a38a38a38', '라면 링크 테스트', 'purchase-link-test', 'open', true, true);

insert into public.items (id, category_id, name, normalized_name, status)
values
  ('38b38b38-b38b-4b38-8b38-b38b38b38b38', '38a38a38-a38a-4a38-8a38-a38a38a38a38', '신라면', '신라면', 'active'),
  ('38c38c38-c38c-4c38-8c38-c38c38c38c38', '38a38a38-a38a-4a38-8a38-a38a38a38a38', '진라면', '진라면', 'active');

-- URL 정규화 --------------------------------------------------------------

select is(
  private.normalize_purchase_url('https://www.coupang.com/vp/products/1?itemId=5&wpuid=aff&utm_source=kakao&vendorItemId=7'),
  'https://www.coupang.com/vp/products/1?itemId=5&vendorItemId=7',
  '제휴·추적 파라미터는 지우고 상품 식별 파라미터는 남긴다'
);

select is(
  private.normalize_purchase_url('https://www.11st.co.kr/products/1?ref=partner#tracked'),
  'https://www.11st.co.kr/products/1',
  '프래그먼트와 ref를 지우며 파라미터가 모두 사라지면 물음표도 남기지 않는다'
);

select is(
  private.normalize_purchase_url('https://smartstore.naver.com/shop/products/55?NaPm=abc'),
  'https://smartstore.naver.com/shop/products/55',
  '대소문자가 섞인 추적 파라미터도 지운다'
);

select is(private.normalize_purchase_url('   '), null, '빈 값은 null이 된다');
select is(private.normalize_purchase_url(null), null, 'null은 null 그대로다');

select throws_ok(
  $$ select private.normalize_purchase_url('http://www.coupang.com/vp/products/1') $$,
  'P0001', null, 'http는 거부한다'
);

select throws_ok(
  $$ select private.normalize_purchase_url('javascript:alert(1)') $$,
  'P0001', null, 'javascript 스킴은 거부한다'
);

select throws_ok(
  $$ select private.normalize_purchase_url('https://' || repeat('a', 2100) || '.com/x') $$,
  'P0001', null, '길이 제한을 넘는 URL은 거부한다'
);

-- 쇼핑몰 판별 ------------------------------------------------------------

select ok(public.is_shopping_url('https://www.coupang.com/vp/products/1'), '등록 도메인의 하위 호스트는 쇼핑몰이다');
select ok(public.is_shopping_url('https://coupang.com/vp/products/1'), '등록 도메인 자체도 쇼핑몰이다');
select ok(not public.is_shopping_url('https://blog.naver.com/someone/1'), '같은 상위 도메인의 비쇼핑 서비스는 쇼핑몰이 아니다');
select ok(not public.is_shopping_url('https://evil-coupang.com.attacker.net/x'), '도메인을 흉내 낸 호스트는 쇼핑몰이 아니다');
select ok(not public.is_shopping_url('https://bit.ly/abc'), '단축 URL은 펼치지 않으므로 쇼핑몰로 보지 않는다');

-- 쓰기 경로 --------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '38383838-3838-4838-8838-383838383838', true);

select is(
  (select purchase_url from public.change_pick(
    '38a38a38-a38a-4a38-8a38-a38a38a38a38', '38b38b38-b38b-4b38-8b38-b38b38b38b38',
    '10년째 이것만', 'https://www.coupang.com/vp/products/9?itemId=1&utm_medium=ad', '6개입이 낱개보다 싸요')),
  'https://www.coupang.com/vp/products/9?itemId=1',
  'change_pick은 저장 전에 URL을 정규화한다'
);

select is(
  (select purchase_tip from public.picks
    where user_id = '38383838-3838-4838-8838-383838383838' and status = 'active'),
  '6개입이 낱개보다 싸요',
  '팁이 저장된다'
);

-- 링크를 지우면서 팁을 남기려는 시도는 거부한다. 살 곳 없는 팁은 팁이 아니다.
select throws_ok(
  $$ select public.change_pick(
       '38a38a38-a38a-4a38-8a38-a38a38a38a38', '38b38b38-b38b-4b38-8b38-b38b38b38b38',
       '리뷰', '', '살 곳 없는 팁') $$,
  'P0001', null, '링크를 지우면서 팁만 남기려는 저장은 거부한다'
);

-- 반대로 링크 인자를 넘기지 않으면 저장된 링크가 살 곳이 되므로 팁만 고칠 수 있다.
select is(
  (select purchase_tip from public.change_pick(
    '38a38a38-a38a-4a38-8a38-a38a38a38a38', '38b38b38-b38b-4b38-8b38-b38b38b38b38',
    '리뷰', null, '팁만 고침')),
  '팁만 고침',
  '저장된 링크가 있으면 팁만 고칠 수 있다'
);

-- null은 "그대로 두기"다. 한줄평만 고치는 기존 3인자 호출이 링크를 조용히
-- 지우면 사용자가 남긴 정보를 잃는다.
select is(
  (select purchase_tip from public.change_pick(
    '38a38a38-a38a-4a38-8a38-a38a38a38a38', '38b38b38-b38b-4b38-8b38-b38b38b38b38', '한줄평만 수정')),
  '팁만 고침',
  '링크 인자를 넘기지 않은 호출은 저장된 링크와 팁을 그대로 둔다'
);

select is(
  (select purchase_tip from public.update_pick_review(
    (select id from public.picks where user_id = '38383838-3838-4838-8838-383838383838' and status = 'active'),
    '또 수정')),
  '팁만 고침',
  'update_pick_review도 넘기지 않은 링크와 팁을 그대로 둔다'
);

-- 빈 문자열은 "지우기"다.
select ok(
  (select purchase_url is null and purchase_tip is null from public.change_pick(
    '38a38a38-a38a-4a38-8a38-a38a38a38a38', '38b38b38-b38b-4b38-8b38-b38b38b38b38', '이유', '', '')),
  '빈 문자열은 링크를 지우고 팁도 함께 끝낸다'
);

-- 상품이 바뀌면 이전 구매처는 더 이상 그 선택의 것이 아니다.
select is(
  (select purchase_url from public.change_pick(
    '38a38a38-a38a-4a38-8a38-a38a38a38a38', '38b38b38-b38b-4b38-8b38-b38b38b38b38',
    '되돌림', 'https://ssg.com/item/1', '새벽배송이 빨라요')),
  'https://ssg.com/item/1',
  '링크를 다시 붙일 수 있다'
);

select ok(
  (select purchase_url is null and purchase_tip is null from public.change_pick(
    '38a38a38-a38a-4a38-8a38-a38a38a38a38', '38c38c38-c38c-4c38-8c38-c38c38c38c38', '다른 제품으로')),
  '다른 상품으로 바꾸면 이전 구매처를 이어받지 않는다'
);

reset role;

-- RPC를 우회한 직접 쓰기도 제약에 걸린다. 파라미터 제거를 클라이언트에만
-- 두면 REST를 직접 불러 우회할 수 있으므로 DB 쪽 검사가 마지막 방어선이다.
-- RLS가 아니라 제약을 확인하려는 것이므로 RLS를 지나친 권한으로 실행한다.
select throws_ok(
  $$ insert into public.picks(user_id, category_id, item_id, one_line_review, purchase_url)
     values ('38383838-3838-4838-8838-383838383838', '38a38a38-a38a-4a38-8a38-a38a38a38a38',
             '38c38c38-c38c-4c38-8c38-c38c38c38c38', '우회', 'javascript:alert(1)') $$,
  '23514', null, 'RPC를 우회해도 https가 아닌 링크는 제약에 걸린다'
);
select * from finish();
rollback;
