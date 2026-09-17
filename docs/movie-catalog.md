# 영화 카탈로그 연결

OnePick 영화 검색은 TMDB를 실시간 조회하고, 사용자가 선택한 영화만 `public.items`에 저장한다.

## 데이터 흐름

1. 앱이 기존 `items`에서 영화 제목을 검색한다.
2. 같은 검색어를 `movie-catalog` Edge Function에 전달한다.
3. Edge Function이 TMDB 영화 검색 결과를 한국어 기준으로 반환한다.
4. 신규 영화를 선택한 사용자는 로그인하고, Edge Function이 사용자 JWT와 TMDB 상세 정보를 다시 검증한다.
5. `(external_source, external_id)`가 없을 때만 `items`에 활성 항목으로 추가한다.
6. 앱은 기존 `/pick/choose`와 `change_pick()` 흐름을 그대로 사용한다.

포스터는 `item-photos` Storage에 복사하지 않는다. TMDB의 `poster_path`로 만든 원격 URL을 `image_source_url`에 저장하고, 사용자가 올린 이미지가 있으면 그 이미지를 우선 표시한다.

## 필요한 서버 Secret

Supabase 프로젝트의 Edge Function Secret에 다음 값을 등록한다.

```text
TMDB_READ_ACCESS_TOKEN=<TMDB API Read Access Token>
```

이 값은 Expo 환경변수나 모바일 번들에 넣지 않는다. `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`는 Edge Function 런타임이 제공하는 서버 전용 환경변수를 사용한다.

## 운영 조건

- 검색어는 2~60자로 제한한다.
- 성인 콘텐츠는 검색·저장하지 않는다.
- 영화 ID는 숫자만 허용하고, 저장 전에 TMDB 상세 API로 다시 확인한다.
- 실시간 검색은 비로그인 사용자도 가능하지만 DB 저장은 로그인 사용자만 가능하다.
- 같은 영화는 `unique (external_source, external_id)`로 한 번만 저장한다.
- 숨김·병합·거절 상태의 기존 항목은 다시 활성화하지 않는다.
- 앱의 영화 화면에 TMDB attribution 문구를 표시한다.

TMDB는 비상업적 이용과 상업적 이용 조건이 다르므로 공개 수익화 전에 사용 조건과 로고 표시 요건을 다시 확인한다.
