# 맛집 장소 데이터 소스 정책

상태: 공식 정책 재검증 완료 / 구현 기준  
기준일: 2026-09-22  
대상: 맛집 MVP 장소 검색·canonical 원장·초기 데이터 적재

## 0. 현재 구현 상태

다음 기반은 이미 `main`과 onepick-dev에 적용되어 있다.

- `places`: OnePick canonical 물리적 장소
- `item_places`: category별 item ↔ canonical place 연결
- `item_channels`: `offline | online`
- `unique(place_provider, provider_place_id)`
- 같은 place + 같은 category는 같은 item 재사용
- 같은 place + 다른 category는 다른 item이지만 같은 place 공유
- canonical place mapping이 없는 offline item은 active Pick 차단
- 관리자 canonical upsert는 MFA 기반 권한 검사를 통과해야 함

따라서 이 문서의 목적은 새 스키마 설계가 아니라 **어떤 외부 소스를 canonical 원장과 검색 UX에 사용할지** 확정하는 것이다.

## 1. 결론

장소 데이터는 두 층으로 분리한다.

| 층 | 역할 | 영구 저장 | 1차 소스 |
| --- | --- | --- | --- |
| Canonical 원장 | OnePick `places`를 채우는 검증 가능한 장소 기준 | 가능 | 소상공인시장진흥공단 상가(상권)정보 |
| 보완/검증 | 영업상태·주소 보완 및 재검증 | 가능 | LOCALDATA 일반음식점 |
| 검색 UX | 사용자가 빠르게 식당을 찾고 선택 | provider 정책 범위 내 최소 정보만 | Kakao Local / Google Places 등 |

핵심 원칙:

1. OnePick 내부의 영구 identity는 `places.id`다.
2. 외부 `provider_place_id`는 **source-scoped identity**이며 영구불변하다고 가정하지 않는다.
3. 검색 API 응답 전체를 canonical DB로 복제하지 않는다.
4. 이름만으로 장소를 합치지 않는다.
5. 자동 매칭이 불확실하면 pending/admin 검수로 보낸다.

## 2. Canonical 1순위 — 소상공인시장진흥공단 상가(상권)정보

공공데이터포털의 최신 설명 기준:

- 전국 영업 중 상가업소 데이터
- 주요 항목: 상가업소번호, 상호명, 주소, 업종, 경도, 위도
- 이용허락범위 제한 없음
- 파일/OPEN API 제공
- 전국 범위

OnePick 초기 canonical seed의 1순위로 사용한다.

### 장점

- 주소와 WGS84 경도/위도를 바로 사용할 수 있다.
- 음식점 업종 후보를 전국 단위로 추릴 수 있다.
- 공공데이터 이용 범위가 명확하다.
- OnePick `places.region_1 / region_2 / latitude / longitude`와 잘 맞는다.

### 중요한 제한

상가업소번호는 **영구불변 ID로 간주하지 않는다**.

공공데이터포털의 과거 변경 안내에는 상가업소번호가 새로 생성되어 과거 데이터와 연계되지 않는 변경 이력이 명시되어 있다. 따라서:

```text
place_provider = 'sbiz'
provider_place_id = 현재 데이터셋의 상가업소번호
```

로 저장하되, 이 값은 “현재 SBIZ 데이터 버전에서의 source identity”다.

재수집 때 provider id가 사라지거나 바뀌면 다음 보조 신호로 기존 `places.id`와 재연결한다.

- 정규화 상호명
- 도로명주소
- 지점명
- 좌표 반경
- 업종

자동 재연결 확신이 낮으면 관리자 검수 대상으로 둔다.

## 3. 보완 1순위 — LOCALDATA 일반음식점

공공데이터포털의 전국일반음식점표준데이터 기준:

- 전국 지자체 일반음식점 인허가 데이터
- 영업상태, 사업장명, 주소 등 제공
- 현재 안내 기준 매일 갱신, 2일 전 기준 현행화
- 좌표계: Bessel 중부원점 TM, EPSG:5174
- 이용허락범위 제한 없음

초기 canonical seed의 주 원장보다는 **영업상태/주소 보완 및 검증 소스**로 사용한다.

```text
place_provider = 'localdata'
provider_place_id = 관리번호
```

를 사용할 수 있지만, OnePick 내부 영구 identity는 여전히 `places.id`다.

### 적재 전 처리

- 폐업/휴업 등 비정상 영업상태 제외
- EPSG:5174 → WGS84 변환
- 사업장명/주소 정규화
- SBIZ와 보조 매칭
- 매칭 충돌 시 자동 merge 금지

## 4. 검색 UX — Google Places

공식 Google Maps Platform 정책 기준:

- Place ID는 캐싱 제한 예외이며 장기 저장 가능
- 12개월 이상 된 Place ID는 refresh 권장
- Places API의 위도/경도는 최대 30일 임시 캐시
- Places API 콘텐츠는 일반적으로 저장/캐시 제한을 받음
- Google Maps Content는 non-Google map과 결합 사용 제한이 있음

따라서 OnePick에서는 Google Places를 **검색/선택 UX**로만 사용하고, 초기 canonical 장소 원장으로 복제하지 않는다.

허용 가능한 최소 장기 식별자는 Google Place ID다. 다만 현재 `places`는 canonical provider identity 하나만 가지므로, SBIZ canonical place에 Google ID를 붙이려면 향후 별도 다중 참조 테이블을 만든다.

예:

```text
place_external_refs
- place_id
- provider
- provider_place_id
- last_verified_at
unique(provider, provider_place_id)
```

이 테이블이 생기기 전에는 SBIZ canonical row의 `place_provider`를 Google로 덮어쓰지 않는다.

## 5. 검색 UX — Kakao Local

Kakao Local API는 검색 결과에 다음과 같은 장소 필드를 제공한다.

- 장소 ID
- 장소명
- 주소/도로명주소
- 경도/위도
- Kakao Map 장소 URL

다만 Kakao Developers 운영정책은 Kakao 제공 데이터를 앱 사용자 환경 개선 목적 외로 캐싱하는 행위를 제한하고, 캐시 데이터의 최신 상태 유지를 요구한다.

따라서 초기 OnePick 정책은 보수적으로 잡는다.

- 검색 결과는 실시간 UX에 사용
- Kakao 응답 전체를 canonical `places`로 복제하지 않음
- Kakao 장소 ID/장소명/좌표의 장기 저장 범위는 운영 전 서면 확인
- 확인 전에는 SBIZ/LOCALDATA canonical과 ephemeral 매칭에만 사용

즉 “카카오 데이터 저장이 전면 금지”라고 단정하지 않지만, **canonical 원장 적재 소스로는 사용하지 않는다.**

## 6. 검색 UX — NAVER 지역검색

NAVER 검색 API 이용약관은 검색 API 데이터를 “네이버 검색결과 제공” 목적에 맞게 사용하고, 원본 출처와 원본 링크를 표시하며, 검색결과의 순위·내용을 수정/왜곡하지 않도록 요구한다.

따라서 OnePick에서는 NAVER 지역검색 결과를 canonical 장소 데이터베이스 구축 소스로 사용하지 않는다.

- 필요할 경우 검색 보조 UX로만 검토
- 반환 데이터를 OnePick 자체 장소 원장으로 재구성/재배포하지 않음
- 초기 MVP의 필수 provider로 두지 않음

## 7. Provider별 역할

| Provider | OnePick 역할 | canonical 저장 |
| --- | --- | --- |
| SBIZ | 초기 장소 seed, 주소/좌표/업종 | 예 |
| LOCALDATA | 영업상태·주소 보완, 재검증 | 예 |
| Google Places | 검색/자동완성/선택 | Place ID 외 제한적 |
| Kakao Local | 국내 검색 UX 후보 | 초기에는 아니오 |
| NAVER 검색 | 보조 검색 후보 | 아니오 |

## 8. OnePick 등록 흐름

```text
사용자 검색
  ↓
검색 provider에서 실시간 후보 표시
  ↓
사용자가 특정 지점 선택
  ↓
OnePick canonical places 매칭
  ├─ 정확히 매칭 → 기존 place/item 재사용
  └─ 미매칭/충돌 → pending 검수
                         ↓
                 관리자 canonical 확인
                         ↓
                   places에 확정
```

장소 매칭 우선순위:

1. 저장 가능한 동일 provider identity
2. 도로명주소 + 좌표 근접 + 정규화 상호명
3. 도로명주소 + 지점명
4. 불확실하면 자동 merge 금지

## 9. 음식 카테고리와 장소 identity는 분리한다

한 식당은 여러 음식 세부 카테고리의 후보가 될 수 있다.

예:

```text
OO곱창 강남점
  place: 1개
  ├─ 곱창 item
  ├─ 대창 item
  └─ 곱창전골 item
```

외부 데이터의 업종분류를 OnePick leaf로 자동 확정하지 않는다.

- 공공데이터 업종 → 후보/상위 분류 참고
- OnePick 세부 카테고리 → 사용자 선택 + 관리자 검수
- 한 place에서 여러 category item 허용

## 10. 초기 적재 전략

전국 원픽 원칙은 유지하지만, 첫 데이터 적재는 품질 검증 가능한 작은 범위부터 진행한다.

### 1차 샘플

- 서울 음식점 표본
- 새로 추가한 77개 맛집 leaf와 관련성이 높은 업종 우선
- 수천 건 이하로 제한
- SBIZ → canonical 후보 생성
- LOCALDATA → 영업상태/주소 교차검증

### 측정

- provider id 중복률
- 동일 상호/다른 지점 분리 정확도
- SBIZ ↔ LOCALDATA 매칭률
- 주소 누락률
- 좌표 누락률
- OnePick leaf 자동 후보 매핑률
- 관리자 수동 검수 비율

자동 category 확정률보다 **잘못된 장소 merge를 만들지 않는 것**을 우선한다.

## 11. 구현 순서

1. SBIZ 샘플 import 포맷/검증 스크립트
2. LOCALDATA EPSG:5174 변환 및 교차검증
3. canonical place import staging
4. 관리자 검수/merge UI에 장소 identity 표시
5. 검색 provider 추상화
6. Kakao 또는 Google 검색 provider 연결
7. 사용자 “맛집 검색 → 지점 선택” UI
8. 미매칭 pending 검수
9. 서울 샘플 QA 후 전국 확대

## 12. 확정하지 않은 것

아래는 별도 검증 후 결정한다.

- Kakao 장소 ID 장기 저장 범위
- 첫 검색 provider를 Kakao와 Google 중 무엇으로 할지
- Google Place ID용 `place_external_refs` 도입 시점
- SBIZ/LOCALDATA 전국 사전 적재 규모
- OSM/Overture/Foursquare Open Places 보조 사용 여부

## 공식 참고

- 소상공인시장진흥공단 상가(상권)정보 API: https://www.data.go.kr/data/15012005/openapi.do
- 전국일반음식점표준데이터: https://www.data.go.kr/data/15096283/standard.do
- Google Places API 정책: https://developers.google.com/maps/documentation/places/web-service/policies
- Google Place ID: https://developers.google.com/maps/documentation/places/web-service/place-id
- Google Maps Platform Service Specific Terms: https://cloud.google.com/maps-platform/terms/maps-service-terms
- Kakao Developers Local API: https://developers.kakao.com/docs/ko/local/dev-guide
- Kakao Developers 운영정책: https://developers.kakao.com/terms/ko/site-policies
- NAVER API 서비스 이용약관: https://developers.naver.com/products/intro/terms/terms.md
