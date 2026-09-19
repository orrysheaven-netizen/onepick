# AI 프로필 성능 정리

## 목적

AI 프로필 기능의 반복 조회와 생성 완료 대기를 줄인다. 기능·권한·최소 원픽 10개·T/F 말투·비공개 미리보기 규칙은 바꾸지 않는다.

## 변경

- AI 댓글 자체는 공개/숨김 및 원본 변경을 비교적 빠르게 반영해야 하므로 **화면이 실제로 활성화된 동안만 30초 주기**를 유지한다.
- 분석 가능한 원픽 개수는 상시 폴링하지 않는다. 현재 원픽 개수 변화가 query key를 바꾸며, 화면 복귀 시 stale 여부에 따라 다시 확인하고, **생성 버튼을 누르는 순간에는 항상 공개 권한으로 강제 재확인**한다.
- AI 서버 규격/설정은 5분 캐시하며 상시 폴링하지 않는다. 생성 버튼 클릭 직전에는 항상 강제 재확인한다.
- React Native에서는 TanStack Query focusManager를 AppState와 연결해 앱이 background/inactive일 때 query focus를 내린다. Web은 기존 visibility 처리에 맡긴다.
- 생성 응답은 이미 서버가 저장한 완전한 댓글이므로 owner cache에 즉시 넣는다. 다른 viewer cache는 refetchType none으로 stale 표시만 하고, **후속 표시 조회를 기다리거나 즉시 시작하지 않는다**.
- 이미 데이터가 있는 background refresh의 isFetching만으로 T/F 버튼을 잠그지 않는다. 클릭 직전 preflight가 안전 기준을 다시 확인한다.

## 요청량의 변화

정상 상태에서 프로필 하나를 계속 열어둔 경우의 코드 기준 계산이다. 실제 네트워크/React Query 재사용 상황에 따라 달라질 수 있으며 부하 테스트 수치가 아니다.

- AI 댓글 없음, 본인 프로필: 이전 약 8 HTTP/min → 변경 후 AI 댓글 확인 약 2 HTTP/min + 화면 진입/명시적 조작 시 확인.
- AI 댓글 있음: 댓글 행과 OnePick AI 작성자 조회가 각각 남아 있어 약 4 HTTP/min이 가능하다.
- 서버 상태와 원픽 적격성은 더 이상 30초마다 자동 요청하지 않는다.
- 화면을 벗어나면 AI 댓글 30초 poll도 중단한다.

## 유지하는 안전성

- 생성 직전 서버 규격과 공개 원픽 개수를 다시 읽는다.
- Edge Function도 최소 10개와 원본 버전을 다시 검증한다.
- 공개는 사용자가 본 댓글 id/generated_at에 묶인다.
- 원픽/분석용 제품·카테고리 변경 시 DB trigger가 기존 공개 댓글을 stale/hidden으로 만든다.
- 공개 상태 확인의 30초 상한은 유지하므로 성능 최적화를 위해 개인정보/공개 통제를 약화시키지 않는다.

## 후속 성능 작업

현재 DB 규모에서는 조회 자체가 병목이라는 근거가 없다. 다음 단계는 실제 API 연결 후 preflight / model / save / UI completion 시간을 따로 계측하는 것이다. 규모가 커지기 전에는 catalog 변경 trigger가 많은 사용자에게 반복 작업을 수행하는 경로를 배치형으로 재검토한다.

근거 문서:
- https://tanstack.com/query/latest/docs/framework/react/react-native
- https://docs.expo.dev/versions/latest/sdk/router/
