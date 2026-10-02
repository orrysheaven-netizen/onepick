# OnePick 현재 우선순위

기준일: 2026-10-02  
상태: **MVP 기준선 점검 완료 / Production 정합성·잔여 P2 보완 단계**

## 현재 원칙

- 극초기 MVP 핵심 흐름 안정성을 신규 기능보다 우선한다.
- 이미 완료된 기능을 다시 구현하지 않고, superseded PR/이슈를 재사용하지 않는다.
- main 병합과 Production 반영을 분리한다. Production DB apply·secret/permission 변경·파괴적 데이터 작업은 사용자 승인 게이트를 유지한다.
- 별도 유료 API·추가 비용은 필수인 경우가 아니면 도입하지 않는다.
- P3 확장은 사용자가 별도로 우선 지시하지 않는 한 보류한다.

## P0 — Production 정합성 / 데이터 무결성

1. **Production migration 2건 적용 대기**
   - `20261002165000_guard_current_pick_last_photo` (#634)
   - `20261002193000_remove_approval_auto_pick` (#674)
   - 둘 다 main 병합·CI·GPT DB/RLS 검토 완료.
   - Production 읽기 전용 preflight 완료, 적용 순서는 `165000 → 193000`.
   - 실제 Production apply는 사용자 별도 승인 전 금지.

2. **기존 photo-less active Pick 8건 비파괴 보충** (#633)
   - Pick/한줄평/선택 기록은 유지한다.
   - 라면 4건 + IU 1건은 exact/high-confidence source 확보.
   - 게임 3건은 IGDB exact cover hash 미확정으로 보류.
   - source-policy 우회나 임의 이미지 자동 채택은 하지 않는다.
   - Production 사진 반영은 별도 승인 전 0건 유지.

3. **Daily QA / Security QA 최신 측정 유지** (#640, #641)
   - Critical/High 신규 없음.
   - Home DB 지연은 KR 실측/EXPLAIN 기준 DB 결함으로는 재분류.
   - 검색 first-cold long-tail은 다음 측정에서 cold/warm 분리 확인.
   - 과거 QA 문구보다 latest main·실측·현재 feature gate를 우선한다.

## P1 — 현재 MVP 흐름 안정화

- **Follow MVP**
  - 공개 프로필 Follow CTA: ON
  - 공개 팔로워/팔로잉 수·목록: ON
  - Home following feed: OFF
  - follow 변경 알림·설정·푸시: OFF
  - #648 → #655 → #657 canonical chain main 반영 완료.

- **원픽 사진 계약**
  - 신규/교체 Pick은 대표사진 필수.
  - current Pick item의 마지막 사진 제거 차단 코드는 main 반영 완료.
  - 기존 photo-less Pick 8건은 별도 비파괴 보충 대상으로 유지.

- **등록 요청 정책**
  - 승인/병합 이벤트가 legacy intent에서 새 Pick을 자동 생성하지 않는 코드가 main 반영 완료.
  - modern `needs_review` Pick은 새 row 생성이 아니라 기존 row publish/move 계약을 유지.
  - 승인/검토 완료 후속 알림은 현재 MVP에서 노출하지 않는다.

- **CI / 문서 정합성**
  - unrelated Ready PR required-check cwd 회귀 수정 및 재발 방지 테스트 main 반영 완료.
  - social/home/Daily QA 문서는 현재 MVP 노출 정책과 정합화 완료.

## P2 — 점검 후 보완

실제 근거가 있는 항목만 처리한다.

- Security Low L4: 첫 유효 사용자 사진의 즉시 대표사진 채택 위험은 **사용자 risk-acceptance 결정 대기**. Draft #665를 임의 병합하지 않는다.
- Security Low L5: `cleanup-item-photos` 공개 호출은 현재 bounded maintenance 경로이며, 별도 secret 계층 도입은 사용자 승인 없이는 하지 않는다.
- Security Low L7: DB deploy TLS/argv 비밀번호 개선은 CA/CLI 계약 검증 없이 즉시 변경하지 않는다.
- Notion/운영 문서가 현재 main과 어긋날 경우 최신 GitHub 기준으로 최소 정합화한다.

## P3 — 보류 중인 확장

- 온라인/레시피 공개 롤아웃
- 추가 테마·카테고리 확장
- Home following feed / follow 알림
- 비필수 AI·추천 고도화
- 추가 유료 자동화·인프라

사용자가 별도로 우선 지시하지 않는 한 P0~P2보다 먼저 시작하지 않는다.
