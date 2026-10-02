# OnePick 현재 상태

기준일: 2026-10-02  
기준 main: `11edfe486a648cfe64b06beeb338472595e8e312`

## PM 판정

2026-09-29 기준선 점검(#557)은 완료되었고, 현재는 **초기 MVP의 main 구현을 Production과 맞추고 잔여 P2 리스크를 정리하는 단계**다.

신규 기능 개발이 기본 우선순위가 아니다. 현재 main과 Production의 차이, 기존 데이터 정리, QA/Security 재측정이 먼저다.

## 완료된 핵심 범위

| 영역 | 현재 상태 |
| --- | --- |
| Follow 공개 프로필 | Follow CTA + 팔로워/팔로잉 수·목록 main 반영 완료 |
| Follow Home/알림 | following feed / follow 변경 알림·설정·푸시는 feature gate OFF |
| Profile navigation | 공개 프로필·connections에서 하단 5탭/뒤로가기 계약 main 반영 |
| 원픽 사진 필수 | 신규/교체 photo-less Pick 서버 차단 Production 반영 완료 |
| 마지막 사진 제거 guard | PR #664 main 병합 + Production `20261002165000` 적용·검증 완료 |
| 승인 후 자동 Pick 제거 | PR #675 main 병합 + Production `20261002193000` 적용·검증 완료 |
| CI required check | unrelated Ready PR cwd 회귀 수정 + 재발 방지 테스트 main 반영 |
| Social/Home/QA 문서 | 최신 Follow·offline MVP 노출 정책으로 정합화 완료 |
| Baseline | Product/UX/Engineering/Data/QA/Release #558~#563 및 #557 완료 |

## Production DB 정합성

2026-10-02 사용자 승인 후 아래 두 migration을 순서대로 적용하고 사후 검증했다.

1. `20261002165000_guard_current_pick_last_photo`
2. `20261002193000_remove_approval_auto_pick`

검증 결과:
- 두 exact version이 Production migration history에 기록됨
- last-photo guard trigger 2개 존재
- `change_pick_impl` target item row lock 존재
- review trigger에서 legacy 새 Pick INSERT 제거
- approved/merged notification INSERT 제거
- SECURITY DEFINER / empty search_path / private EXECUTE 계약 유지
- `pending_item_picks` 0건
- pending/rejected + needs_review Pick 0건
- photo-backed current-Pick item 18건
- 기존 photo-less current-Pick item 8건은 비파괴 유지
- Security advisor 신규 Critical/High 없음

현재 main과 Production의 해당 DB 계약은 정합화 완료 상태다.

## 열린 작업

| Issue | 상태 | 의미 |
| --- | --- | --- |
| #633 | blocked | photo-less active Pick 8건 중 게임 3건 exact IGDB cover 미확정 + Production 사진 반영 승인 대기 |
| #640 | open | Security QA Low/정책 결정·다음 측정 추적 |
| #641 | open | Daily QA 다음 cold/warm 재측정 추적 |
| #665 | Draft | Security L4 risk-acceptance 사용자 결정 전 병합 금지 |

## 현재 실행 정책

- **즉시 가능:** 읽기 전용 Production 검증, QA 재측정, 문서 정합화, superseded 정리.
- **사용자 승인 후 가능:** Production 사진 보충, Security L4 risk acceptance.
- **보류:** P3 확장, 별도 유료 API, 불필요한 새 DB 인덱스/인프라.
- **금지:** 기존 Pick/한줄평 자동 삭제, source-policy를 우회한 이미지 자동 채택, 승인 게이트 우회.

## 최신 MVP 노출 기준

- 음식/오프라인 우선.
- 공개 프로필 Follow 관계 UI는 노출.
- Home following feed와 follow 알림은 비노출.
- AI 취향평가 UI·CTA 비노출.
- 온라인/레시피와 추가 테마는 후순위.
- 신규/교체 원픽은 사진 필수.
- 등록 승인 후 legacy intent에서 새 원픽 자동 생성하지 않음.

## 관리자 조치 표기

- **관리자 승인 필요:** Production 사진 보충, Security L4 risk acceptance.
- **관리자 직접 수행 필요:** 현재 없음.
