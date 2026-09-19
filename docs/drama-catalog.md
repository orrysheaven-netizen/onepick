# 드라마 1단계: TMDB TV 연결

## 범위 / 선택 단위
- 드라마만 추가한다. 음악·책·애니메이션·예능·다큐 카테고리는 만들지 않는다.
- 콘텐츠 → 드라마에서 극본 기반 TV 시리즈/미니시리즈·시트콤을 작품 하나로 선택한다. 시즌·에피소드별 별도 상품을 생성하지 않는다.
- 검색 결과는 TMDB의 이야기 장르(드라마, 코미디, 범죄, 미스터리, 액션/어드벤처, SF/판타지, 소프, 전쟁/정치)를 포함하고 애니메이션/다큐/뉴스/리얼리티/토크는 제외한다. 상세 조회의 Scripted/Miniseries 유형도 재확인한다. 분류 누락·오분류로 일부 작품이 제외될 수 있으며 검색 1페이지 중 적합한 결과만 최대 20개 표시한다.

## 흐름 / 데이터 축적
- 기존 /pick/find 화면에서 한국어 제목/원제 → 포스터·첫 방영 연도 → 작품 선택 → 본인의 한줄평 → 저장.
- 영화 카테고리의 기존 코드와 복귀/취소/중복 클릭/오류 회복을 공유한다. 새 업로드/원픽 저장 화면은 만들지 않는다.
- 기존 전체·드라마 범위 검색에 아직 로컬 결과가 없으면 드라마 DB 검색으로 이어갈 수 있다. 라면 등 다른 범위에서는 이 진입점을 표시하지 않는다. 카테고리 조회는 빈 결과의 부가 동작일 뿐 상품 검색의 사전 대기가 아니다.
- 검색은 데이터베이스 쓰기를 수행하지 않는다. 사용자가 고른 시리즈만 외부 상세정보를 확인해 items에 저장한다. 다음 검색부터 기존 상품을 재사용한다.
- 원픽과 댓글은 기존 사용자 저장 절차를 따른다. 작품 가져오기는 원픽 등록과 다른 작업이며 자동 선택하지 않는다.

## 식별 / API
- 기존 movie-catalog Edge Function에 mediaType: 'tv'를 추가한다. 생략/기존 'movie' 요청은 영화 동작을 유지한다. TMDB_READ_ACCESS_TOKEN을 서버에서 재사용한다. 새 외부 계정/키를 클라이언트에 요구하지 않는다.
- TMDB /search/tv 및 /tv/{id}, language=ko-KR, include_adult=false. 포스터는 기존 TMDB 이미지 호스트를 사용하며 업로드 저장소로 복제하지 않는다.
- 영화는 기존 (tmdb, 숫자ID), TV는 (tmdb_tv, 숫자ID). 이름이 같아도 ID가 다르면 다른 작품이며 같은 숫자의 영화와 TV도 충돌하지 않는다. 계절/회차·다른 외부 ID를 제목만으로 합치지 않는다.
- 저장 항목: title/name, original_name, first_air_date의 release_year, poster/image_source_url, TMDB TV 원문 URL, external_source, external_id. 설명·시놉시스·전회차 데이터는 대량 저장하지 않는다.
- 읽기 캐시는 영화와 TV를 구분한다. 기존 200ms 외부 검색 대기, 30초 동일 검색 캐시, AbortSignal 전달을 유지한다.
- 인증 복귀는 choose_drama/externalDramaId로 분리한다. 영화 링크를 드라마에서 또는 반대로 자동 실행하지 않는다. 비밀번호/토큰/초안은 URL에 넣지 않는다.
- 드라마 가져오기는 인증 및 정지 여부, 공개/선택 가능 말단 카테고리와 부모를 확인한다. 이미 숨긴/병합한 상품은 재활성화하지 않는다. 동시 선택은 기존 DB unique 제약으로 한 작품을 재사용한다.

## 배포 / 확인 범위
- 기존 PR #11, feature/shared-item-photo-actions에 누적하며 main과 운영 사이트는 수정하지 않는다. [CF-Pages-Skip] 및 Vercel 제외 설정을 유지한다.
- 신규 20260918093000_add_drama_category.sql은 Git-only다. 기존 카테고리 설정을 강제로 재개방하지 않으며 운영 DB에 아직 적용하지 않는다.
- 기존 앱 배포·보류 중 마이그레이션·movie-catalog 함수의 업데이트를 같은 운영 주소에서 확인해야 실제 사용 가능하다. 음악/책 단계는 진행하지 않는다.
- API 테스트는 소스 실행과 제어된 HTTP/DB 더블, DB 검사는 CI 임시 DB다. 실 TMDB 응답·휴대폰 OAuth/화면 및 영구 데이터의 실사용 확인은 별도 출시 관문이다. 도구 연결/호스팅 승인 없이 배포했다고 안내하지 않는다.
- 기존 TMDB 출처 문구를 드라마 검색에도 표시한다. 공개 운영 전 About/Credits의 공식 TMDB 로고·고지 및 상업 이용 라이선스 검토를 별도 확인한다. 무제한 데이터 저장 권한을 가정하지 않는다.

## 공식 참고 (2026-09-18 확인)
- https://developer.themoviedb.org/reference/search-tv
- https://developer.themoviedb.org/reference/tv-series-details
- https://developer.themoviedb.org/docs/faq
- https://docs.expo.dev/versions/v57.0.0/
