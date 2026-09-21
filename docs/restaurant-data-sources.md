# 맛집 장소 데이터 소스 조사

상태: 조사 결과 / 구현 전 참고 문서
기준일: 2026-09-21
대상: 맛집 MVP (`docs/restaurant-mvp-foundation.md` §5, §6, §13 Phase 2·4)

## 0. 결론

맛집 데이터베이스를 통째로 구매하거나 내려받을 수 있는 단일 공급처는 없다.
데이터를 두 층으로 나누고, 두 층을 섞지 않는다.

| 층 | 용도 | 저장 | 대표 소스 |
| --- | --- | --- | --- |
| A층 | canonical 장소 원장 (`item_places`) | 저장·재배포 가능 | 공공데이터 (상가정보, LOCALDATA) |
| B층 | 검색/자동완성 UX | 저장 금지가 원칙 | 카카오 로컬, 네이버 지역검색, Google Places |

`docs/restaurant-mvp-foundation.md` §6은 지점 중복 판정을 상호명이 아니라 안정적 장소 identity로 하도록 요구한다.
그 identity는 A층에서 나와야 한다. B층 응답을 그대로 `items`/`item_places`에 적재하면 약관 위반이면서 동시에 §6 계약도 지킬 수 없다.

## 1. A층 — 저장 가능한 공공데이터

### 1-1. 소상공인시장진흥공단 상가(상권)정보

- 공공데이터포털에서 시도별 파일로 제공한다.
- 주요 컬럼: 상가업소번호, 상호명, **지점명**, 상권업종 대/중/소분류, 표준산업분류, 도로명주소, 지번주소, 시도/시군구/행정동, **경도·위도(WGS84)**.
- 갱신 주기는 분기 단위다.

맛집 MVP 시드로 가장 적합하다.

- 좌표가 이미 WGS84라 변환 작업이 없다.
- 지점명 컬럼이 따로 있어 `item_places.branch_name`과 §6의 "OO곱창 강남점 / OO곱창 부산" 구분 요구에 직접 대응한다.
- `region_1` / `region_2`를 시도·시군구 컬럼에서 그대로 채울 수 있다.

### 1-2. LOCALDATA 지방행정 인허가데이터

- `일반음식점`, `휴게음식점`, `제과점영업` 세 업종이 맛집 범위에 해당한다.
- 주요 컬럼: 관리번호(인허가 고유번호), 사업장명, 소재지/도로명 주소, 영업상태명, 업태구분명(한식·중식·일식·호프 등), 좌표정보(x, y).
- 갱신 주기는 월 단위이고 전국 규모는 수십만 건이다.

보완 소스로 쓴다.

- 좌표가 WGS84가 아니라 중부원점 TM 계열(EPSG:5174 등)이므로 적재 전에 변환이 필요하다. 실제 좌표계는 다운로드 시점의 파일 사양으로 확인한다.
- 폐업/휴업 레코드가 함께 들어 있다. `영업상태명`으로 필터해도 실제 폐업이 섞인다.

### 1-3. `place_provider` 값 제안

```text
place_provider = 'sbiz'      → provider_place_id = 상가업소번호
place_provider = 'localdata' → provider_place_id = 관리번호
```

`item_places`의 `unique(place_provider, provider_place_id)`가 그대로 지점 중복 방지 키로 동작한다.

### 1-4. 공공데이터를 쓸 때의 주의점

1. 인허가 데이터는 영업 실태가 아니라 행정 상태다. 적재된 장소를 곧바로 승인 상태로 만들지 않고 pending을 거친다 (§6-5, §6-6).
2. 업태구분명·상권업종 분류는 OnePick 세부 leaf(곱창 / 대창 / 평양냉면)와 1:1로 떨어지지 않는다. 자동 매핑은 상위 그룹까지만 하고, 세부 카테고리는 사용자 제출 + 관리자 승인으로 확정한다.
3. 관리번호는 폐업 후 재인허가 시 바뀔 수 있다. 영구 identity로만 신뢰하지 말고 (상호 + 도로명주소 + 좌표 반경) 보조 매칭을 함께 둔다.
4. MVP에서는 전국 전량 적재보다 서울/수도권 + 1차 세부 카테고리 범위로 수천 건만 적재한다.

## 2. B층 — 검색 UX용 장소 API

| 제공자 | 검색 품질 | 결과 저장 | MVP 적합도 |
| --- | --- | --- | --- |
| 카카오 로컬 API | 국내 최상 | 응답 결과의 별도 저장을 허용하지 않고 실시간 호출을 원칙으로 한다 | 검색 전용 |
| 네이버 지역검색 API | 상 | 결과 DB화 금지 조항이 있다 | 부적합 (반환 건수도 5~30건) |
| Google Places API | 중 (국내), 정책은 가장 명확 | place ID는 무기한 저장 가능, 좌표는 최대 30일 캐시, 이름·평점·리뷰·사진은 저장 불가 | 검색 전용 + place_id 보관 |
| OpenStreetMap / Overture·Foursquare Open Places | 하 (국내 커버리지 얇음) | 라이선스 자유 (ODbL 등, share-alike 확인 필요) | 보조 |

- 카카오는 사용자가 확정한 장소ID/장소명/place_url 수준의 최소 저장 가능 여부가 개발자 포럼에서 계속 질의되는 회색지대다. 오픈 전 카카오에 서면 확인을 받는다.
- Google Places를 쓸 경우 `place_provider = 'google'`, `provider_place_id = place_id`만 보관하고 이름·주소·좌표는 A층 값으로 채운다.
- 망고플레이트·다이닝코드·카카오맵 크롤링은 약관 위반이며 법적 위험이 있다. 사용하지 않는다.

## 3. OnePick 적용 흐름

```text
검색창(B층 실시간 호출)
  → 사용자가 장소 선택
  → 좌표 + 상호로 A층 canonical 레코드 매칭
  → 매칭됨: 기존 item 재사용
  → 매칭 안 됨: pending 제출 → 관리자 승인 후 canonical 등록
```

- B층 응답은 화면 렌더링에만 사용하고 저장하지 않는다.
- 승인된 장소만 원픽 대상이 된다 (§6-6).
- 같은 이름 + 다른 place id는 별도 item, 같은 place id는 기존 item 재사용 (§6-3, §6-4).

기존 `category_catalog_sources` 패턴을 그대로 확장할 수 있다.

```text
mode='external', provider='sbiz', edge_function_slug='place-catalog', external_source='sbiz_place'
```

TMDB / IGDB / MusicBrainz 카테고리와 같은 구조이므로 앱의 카탈로그 분기 로직을 새로 만들지 않아도 된다.

## 4. 다음 작업

1. 상가(상권)정보 최신 파일로 서울 기준 표본 적재 후 1차 세부 카테고리 매핑률을 측정한다.
2. LOCALDATA 좌표계 변환 절차를 확정한다.
3. 카카오 로컬 API 저장 범위를 서면으로 확인한다.
4. 확정된 결과를 `item_places` / `item_channels` migration(§13 Phase 2)에 반영한다.

## 참고

- LOCALDATA 지방행정인허가데이터개방: https://www.localdata.go.kr/
- LOCALDATA 데이터 다운로드: https://www.localdata.go.kr/devcenter/dataDown.do?menuNo=20001
- 행정안전부 일반음식점 (공공데이터포털): https://www.data.go.kr/data/15045016/fileData.do
- Google Places API 정책 및 저작자 표시: https://developers.google.com/maps/documentation/places/web-service/policies
- 카카오 데브톡 (로컬 API 저장 범위 문의): https://devtalk.kakao.com/t/api-id-place-url/151265
- 네이버 개발자센터: https://developers.naver.com
