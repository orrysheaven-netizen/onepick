# OnePick 현재 상태

기준일: 2026-10-02

## PM 판정

2026-09-29의 조직 전환·기준선 재확인 단계는 완료됐다.  
현재는 **공개 MVP 안정화와 main ↔ Production 정합성 마감 단계**다.

## 현재 실행 정책

- 신규 기능 작업: 원칙적으로 보류
- 기존 완료 기능의 중복 수정: 금지
- 허용 작업: Production 정합성, QA 재검증, 비파괴 데이터 보완, 문서 정합성, superseded 정리
- main에 병합됐더라도 필요한 Production migration/deploy가 미반영이면 완료로 보지 않는다.
- 사용자 승인 게이트가 남은 작업은 `state:blocked`로 분리하고 다른 안전 작업을 병렬 진행한다.
- 현재 #640/#641 후속은 사용자 지시에 따라 GPT/Codex가 담당한다.

## 현재 확인된 기준선

| 영역 | 현재 상태 |
| --- | --- |
| Product | 극초기 MVP 유지. 승인 후 자동 원픽 생성·승인 알림 제거 정책이 #675로 main 반영됨 |
| Follow | 공개 프로필 Follow CTA + 팔로워/팔로잉 수·목록 main 반영 완료. 홈 팔로잉 피드·followee 변경 알림은 비노출 |
| Engineering | required-check cwd 회귀 수정 및 회귀 방지 테스트 main 반영 완료 |
| Data/DB | #664 last-photo guard와 #675 approval auto-Pick 제거 migration이 main에는 존재하나 Production 미적용 |
| Production DB | remote latest migration은 `20261002083000`. pending은 `20261002165000`, `20261002193000` 두 건 |
| Existing data | photo-less current Pick 8건 유지. 안전 source 5/8 확보, 게임 3건 보류 |
| QA | Home DB 성능 Medium은 지역 편향으로 재분류. 검색 RPC cold/warm 재측정 필요 |
| Security | 신규 Critical/High/Medium 없음. Low 정책 항목만 남음 |
| UX/Figma | 새 화면 추가 중단 유지. 기존 화면 안정화·Foundations 정합성 우선 |
| Documentation | 최신 정책·상태를 main 기준으로 정리 중 |

## 최근 완료

- #557 기준선 점검 완료
- Follow MVP canonical chain 완료
- #667/#670 required-check cwd 수정·회귀 방지 완료
- #664 last-photo guard main 병합 완료
- #675 승인 후 자동 원픽/승인 알림 제거 main 병합 완료
- #669 CI 회귀 이슈 완료 처리

## 현재 차단/승인 게이트

### 관리자 승인 필요

- Production DB `mode=apply`
  - `20261002165000_guard_current_pick_last_photo.sql`
  - `20261002193000_remove_approval_auto_pick.sql`
- #665 L4 첫 사용자 사진 즉시 대표사진 위험 수용 여부
- #633의 확정 source 사진 Production 반영

### 관리자 직접 수행 필요

없음.

## 다음 완료 조건

1. 사용자 승인 후 pending migration 2건 Production apply
2. apply 직후 migration history와 pending=0 재검증
3. #633의 안전한 사진 보완 범위 결정·반영
4. 다음 Daily QA에서 검색 first-cold/warm 재측정
5. 남은 Low 보안 정책 항목을 사용자 결정 또는 수용 기록으로 정리

세부 실행 목록은 이 문서에 누적하지 않고 GitHub Issue를 단일 원본으로 사용한다.
