# 전문몰 원픽 테스트 절차

`specialty-shop-pick.md`의 1차 구현을 확인하는 절차다. 자동 검사, 로컬 손 검증,
운영 반영 전 확인으로 나뉜다.

## 1. 자동 검사

```bash
# 데이터베이스 (마이그레이션 + pgTAP)
supabase db start
supabase test db

# 모바일 (typecheck + 회귀)
cd mobile
npm ci
npm run typecheck
npm test
```

전문몰 관련 검사는 `supabase/tests/036_specialty_shop_picks.sql`과
`mobile/scripts/test-specialty-shop.cjs`에 있다. 나머지는 이 변경이 기존 동작을
깨지 않았는지 확인한다.

## 2. 로컬에서 손으로 확인

```bash
supabase start
cd mobile
cp .env.example .env.local     # URL/키를 supabase start 출력값으로 바꾼다
npm run web
```

### 2-1. 시험용 전문몰 넣기

아래는 **가상의 시험 데이터**다. 실제 업체를 고르는 일은 운영 판단이므로 코드에
넣지 않았다. `supabase start`가 띄운 DB에 그대로 실행한다.

```sql
insert into public.items(category_id, name, normalized_name, status, official_url)
select c.id, v.name, v.normalized, 'active', v.url
from public.categories c,
  (values
    ('테스트 로스터리', '테스트로스터리', 'https://www.Test-Roastery.example/shop?ref=kakao'),
    ('테스트 원두상',   '테스트원두상',   'test-beans.example/'),
    ('테스트 입점몰',   '테스트입점몰',   'https://smartstore.naver.com/TestBeans/products/1?NaPm=ct%3Dx')
  ) as v(name, normalized, url)
where c.slug = 'specialty-shop-coffee-beans';

-- 저장된 주소가 정규화됐는지 본다.
select name, official_url from public.items
where normalized_name like '테스트%';
```

기대: 추적 파라미터와 `www.`가 사라지고, 스킴 없는 입력에 `https://`가 붙고,
스마트스토어는 `https://smartstore.naver.com/testbeans`처럼 상점 세그먼트까지만 남는다.

### 2-2. 로컬에서 로그인하기

로그인은 카카오 / 구글 / 네이버 OAuth뿐이고 `config.toml`에 provider 설정이
없다. **로컬 스택에서는 화면으로 로그인할 수 없다.** 2-3 표의 1~4는 비로그인으로
확인되고, 5~9는 세션이 필요하다.

세션이 필요하면 로컬 Auth에 이메일 사용자를 만들어 브라우저에 넣는다.
로컬 기본값은 이메일 확인이 꺼져 있어 가입 응답에 바로 토큰이 들어온다.

```bash
# <ANON_KEY>는 supabase start 출력의 anon key
curl -s http://127.0.0.1:54321/auth/v1/signup   -H "apikey: <ANON_KEY>" -H "Content-Type: application/json"   -d '{"email":"tester@example.com","password":"onepick-test-1234"}'
```

응답 JSON을 그대로 쓴다. 앱이 띄워진 탭의 개발자도구 콘솔에서:

```js
// 키는 Supabase URL 호스트의 첫 조각에서 나온다.
// http://127.0.0.1:54321 -> sb-127-auth-token
// http://localhost:54321 -> sb-localhost-auth-token
localStorage.setItem('sb-127-auth-token', JSON.stringify({
  access_token: '<응답의 access_token>',
  refresh_token: '<응답의 refresh_token>',
  expires_at: <응답의 expires_at>,
  expires_in: <응답의 expires_in>,
  token_type: 'bearer',
  user: /* 응답의 user 객체 전체 */,
}));
location.reload();
```

첫 로그인이므로 사용자명 만들기로 들어간다. 정상이다.

관리자 화면(2-3)은 별도로 `profiles`에 관리자 권한과 MFA가 필요하다.
`admin-mfa.md`를 따른다.

### 2-3. 화면에서 확인할 것

| # | 로그인 | 할 일 | 기대 결과 |
| --- | --- | --- | --- |
| 1 | 불필요 | 카테고리 목록을 연다 | `전문몰` 아래에 상품군 6개가 보이고, `전문몰` 자체는 선택되지 않는다 |
| 2 | 불필요 | 테스트 몰의 상품 상세를 연다 | 상품 이름 아래에 `test-roastery.example` 같은 도메인 링크가 보이고 눌러 열린다 |
| 3 | 불필요 | 라면처럼 전문몰이 아닌 상품의 상세를 연다 | 판매처 링크가 보이지 않고 기존 화면 그대로다 |
| 4 | 불필요 | 스마트스토어로 넣은 테스트 몰의 상세를 연다 | `smartstore.naver.com/testbeans`까지만 보인다. 상품 경로가 남아 있지 않다 |
| 5 | 필요 | 한줄평에 `여기서 사세요 https://test.example` 을 넣고 저장을 누른다 | 저장되지 않고 "링크와 할인코드를 넣을 수 없어요" 안내가 뜬다. 입력 중에는 뜨지 않고 저장을 눌러야 뜬다 |
| 6 | 필요 | 한줄평에 `쿠폰코드 WELCOME10` 을 넣고 저장을 누른다 | 같은 안내가 뜬다 |
| 7 | 필요 | 한줄평에 `할인 3000원 받았어요` 를 넣고 저장을 누른다 | **저장돼야 한다.** 코드가 없는 평범한 문장은 막지 않는다 |
| 8 | 필요 | `로스팅 날짜를 믿을 수 있다` 로 저장 | 정상 저장된다 |
| 9 | 필요 | 다른 사람의 원픽을 신고한다 | 사유 목록에 `본인이 운영하는 몰`이 있다 |

### 2-4. 관리자 화면에서 확인할 것

| # | 할 일 | 기대 결과 |
| --- | --- | --- |
| 1 | 상품 등록에서 `원두 전문몰` 선택, 주소를 비운 채 저장 | "전문몰은 판매처 주소가 필요합니다" |
| 2 | 주소에 `https://www.coupang.com` 입력 | "여러 품목을 함께 파는 마트형 판매처는 전문몰이 아닙니다" |
| 3 | 이미 등록된 몰을 파라미터만 바꿔 다시 등록 | 중복으로 거부된다 |
| 4 | 주소에 `ftp://test.example` 입력 | "열 수 있는 http(s) 주소를 입력해 주세요" |
| 5 | 영화 카테고리 상품의 공식 URL을 수정 | 경로와 쿼리가 **그대로 유지된다**. 전문몰이 아닌 아이템은 정규화하지 않는다 |

## 3. 운영 반영 전 확인

- 마이그레이션은 `main` 머지 시 Supabase 연동으로 적용된다. 적용 후 `전문몰`
  카테고리 7개(최상위 1 + 상품군 6)가 실제로 생겼는지 본다.
- **아이템 마스터 사전 시딩이 끝나기 전에는 카테고리를 사용자에게 열지 않는다.**
  전문몰은 외부 카탈로그가 없어서, 고를 몰이 없으면 첫 사용자가 승인 대기에 걸린다.
- 시딩한 몰의 `official_url`이 전부 정규 형태인지 확인한다.

```sql
select name, official_url from public.items i
join public.categories c on c.id = i.category_id
where c.slug like 'specialty-shop-%'
  and official_url is distinct from private.normalize_shop_url(official_url);
```

  결과가 0행이어야 한다. 0행이 아니면 트리거를 우회한 경로가 있다는 뜻이다.

## 확인되지 않은 것

- **실기기와 OAuth.** 카카오/구글 로그인은 로컬 스택에서 쓸 수 없다. 실제 로그인
  경로는 테스터 사이트에서만 확인된다.
- **위 세션 주입 절차.** 이 환경에서는 컨테이너 이미지를 받을 수 없어 로컬
  스택을 띄우지 못했다. 절차는 코드에서 확인한 값(저장 키 형식, 세션 JSON 형식)에
  근거하지만 끝까지 실행해 보지는 않았다.
- **홈 카드의 도메인 표시.** 구현하지 않았다. 상품 상세에서만 보인다.
- **마트형 목록의 충분성.** 목록은 대표값이고, 빠진 마트는 운영 중에 신고로
  발견해 추가한다. 추가에는 마이그레이션이 필요하다.
