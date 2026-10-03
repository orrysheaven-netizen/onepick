# OnePick 현재 상태

기준일: 2026-10-03  
기준 main: `d0fae5d2a817fbbdfd3918180f549e52e1384b62`

## PM 판정

2026-09-29 기준선 점검(#557)은 완료되었고, 현재는 **초기 MVP의 핵심 데이터 계약을 Production과 맞춘 뒤 잔여 데이터 정리와 QA 운영 신뢰성을 보완하는 단계**다.

신규 기능 개발이 기본 우선순위가 아니다. 기존 photo-less Pick 정리, QA/Security 재측정, 운영 credential 분리가 먼저다.

## 완료된 핵심 범위

| 영역 | 현재 상태 |
| --- | --- |
| Follow 공개 프로필 | Follow CTA + 팔로워/팔로잉 수·목록 main 반영 완료 |
| Follow Home/알림 | following feed / follow 변경 알림·설정·푸시는 feature gate OFF |
| Profile navigation | 공개 프로필·connections에서 하단 5탭/뒤로가기 계약 main 반영 |
| 원픽 사진 필수 | 신규/교체 photo-less Pick 서버 차단 Production 반영 완료 |
| 마지막 사진 제거 guard | PR #664 main 병합 + Production `20261002165000` 적용·검증 완료 |
| 승인 후 자동 Pick 제거 | PR #675 main 병합 + Production `20261002193000` 적용·검증 완료 |
| 첫 사용자 사진 검수 | PR #690 병합 + Production `20261002210000` 적용·검증 완료 |
| L4 위험 수용 문서 | #665 superseded로 종료 |
| Deployment Consistency 인증 | #676 QA Edge read token 401 해소 후 종료 |
| QA 계측 | #689 cold/warm 검색 + Home endpoint 호출 수 계측 main 반영 |
| CI required check | Ready PR required-check 회귀 수정 + 재발 방지 테스트 main 반영 |
| Baseline | Product/UX/Engineering/Data/QA/Release #558~#563 및 #557 완료 |

## Production DB 정합성

현재 핵심 사진/승인 관련 migration은 Production에 반영되어 있다.

1. `20261002165000_guard_current_pick_last_photo`
2. `20261002193000_remove_approval_auto_pick`
3. `20261002210000_review_first_item_photos`

검증 결과:
- exact migration history 기록 확인
- current Pick item 마지막 사진 제거 guard 유지
- 승인/병합 시 legacy 새 Pick INSERT 제거
- 승인/병합 완료 알림 제거
- 첫 사진 후보용 `public.item_photo_candidates` + RLS + settle trigger 존재
- AAL2 관리자 candidate list/review RPC 계약 유지
- 주요 SECURITY DEFINER 함수 `search_path=''`
- 현재 pending candidate 0건 / needs_review Pick 0건
- 기존 photo-less current-Pick item 8건은 비파괴 유지
- 관련 신규 Critical/High 없음

## 열린 작업

| Issue / PR | 상태 | 의미 |
| --- | --- | --- |
| #633 | blocked | photo-less current Pick 8건. 게임 3건 exact IGDB cover 미확정 + Production 사진 반영 승인 대기 |
| #686 | open | 최신 Security QA. L4 해결, L5·L7 Low 추적 |
| #687 | open | 최신 Daily QA. #689 계측 반영 후 다음 측정 대기 |
| #697 | open / qa-alert | 기존 deploy token의 DB read 403 원인은 분리 완료. #698 병합 후 Database/Advisors endpoint 성공 확인 시 종료 |
| #698 | completed | QA read-only token과 Production deploy token 분리 main 반영 완료 (`d0fae5d`) |
| #683 | blocked / P3 | Production `youtube-catalog`가 main보다 뒤처짐. recipe 공개 재개 전 사용자 승인 후 Edge deploy 필요 |

UX/Figma #684/#685는 별도 병렬 작업으로 진행 중이며 위 QA credential·DB/data 작업과 파일 범위를 겹치지 않게 유지한다.

## QA credential 상태

- Repository `SUPABASE_QA_ACCESS_TOKEN`: Deployment Consistency의 Edge Function 조회용으로 정상 동작 확인.
- Repository `SUPABASE_QA_ACCESS_TOKEN`: OnePick 프로젝트 범위의 **Edge Functions: Read + Database: Read + Advisors: Read** 권한으로 재발급·교체 완료. Edge status read 실제 검증에서 401/403 없음 확인.
- #698은 QA job에서 `Production` Environment를 제거해 동일 이름 Environment secret의 shadowing을 차단한다.
- Production Environment `SUPABASE_ACCESS_TOKEN`: Edge Function 배포용 credential로 분리 유지하며 QA read-only 용도로 재사용하지 않는다.
- secret 값은 코드·문서·로그·이슈에 기록하지 않는다.

## 현재 실행 정책

- **즉시 가능:** 읽기 전용 Production 검증, QA 재측정, 문서 정합화, superseded 정리, #698 코드 검증.
- **사용자 직접 조치 필요:** 현재 없음.
- **사용자 승인 후 가능:** #699 PM 문서 병합, #633 Production 사진 보충.
- **P3 재노출 전 승인 필요:** #683 `youtube-catalog` Production Edge deploy.
- **보류:** P3 확장, 별도 유료 API, 불필요한 새 DB 인덱스/인프라.
- **금지:** 기존 Pick/한줄평 자동 삭제, source-policy를 우회한 이미지 자동 채택, 승인 게이트 우회.

## 최신 MVP 노출 기준

- 음식/오프라인 우선.
- 공개 프로필 Follow 관계 UI는 노출.
- Home following feed와 follow 알림은 비노출.
- AI 취향평가 UI·CTA 비노출.
- 온라인/레시피와 추가 테마는 후순위.
- 신규/교체 원픽은 사진 필수.
- 대표사진이 없는 공개 item의 첫 사용자 사진은 관리자 검수 후 공개.
- 등록 승인 후 legacy intent에서 새 원픽 자동 생성하지 않음.
