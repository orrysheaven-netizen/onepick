# OnePick 현재 우선순위

기준일: 2026-10-02  
상태: **기준선 점검 완료 후 안정화·Production 정합성 마감 단계**

## 현재 원칙

- 신규 기능보다 현재 공개 MVP의 안정화·운영 정합성을 우선한다.
- 이미 완료·병합된 기능을 다른 이슈/브랜치에서 다시 구현하지 않는다.
- main 반영과 Production DB 반영을 별도 완료 조건으로 관리한다.
- main merge, Production DB `mode=apply`, secret/permission 변경, 파괴적 데이터 작업은 사용자 승인 게이트를 유지한다.
- 공개 Follow MVP는 프로필 CTA·팔로워/팔로잉 수·목록까지만 포함한다. 홈 팔로잉 피드와 followee 원픽 변경 알림/설정·푸시는 보류한다.
- 현재 공개 음식 MVP는 offline 채널을 기준으로 유지한다.
- AI 취향평가 UI·CTA 및 P3 확장은 별도 사용자 결정 전 노출하지 않는다.

## P0 — Production 정합성

1. **DB migration 2건 Production 반영**
   - `20261002165000_guard_current_pick_last_photo.sql`
   - `20261002193000_remove_approval_auto_pick.sql`
   - latest main 자동 dry-run에서 위 두 건만 pending으로 확인됨.
   - 기술 사전검증은 완료됐으며 **사용자 Production apply 승인 대기**다.
   - apply 후 `migration list`와 재 dry-run으로 pending=0을 확인한다.

2. **기존 photo-less current Pick 8건 비파괴 보완 — #633**
   - Pick·한줄평·선택 이력은 변경하지 않는다.
   - 안전한 exact source는 5/8건 확보.
   - 게임 3건은 정확한 IGDB cover source 미확정으로 보류한다.
   - Production 사진 반영도 별도 사용자 승인 전 수행하지 않는다.

## P1 — 안정화·QA

- #641 Daily QA
  - Home DB 지연은 KR/US 지역 차이와 Edge upstream 근거로 DB 결함에서 재분류됨.
  - 새 DB 인덱스·brand-logo 추가 최적화는 현재 근거로 하지 않는다.
  - 검색 RPC는 다음 QA에서 first-cold vs warm을 분리해 재측정한다.
- #640 Security QA
  - 신규 Critical/High/Medium 없음.
  - 남은 항목은 Low 정책·운영 판단 위주다.
  - L4 첫 사용자 사진 즉시 대표사진 위험 수용 문서 PR #665는 사용자 정책 결정 전 Draft 유지한다.
- 현재 #640/#641의 Claude 인계는 사용자 지시에 따라 GPT/Codex 담당으로 전환된 상태다.

## P2 — 정리

- 최신 main·Production·QA 상태와 PM 문서를 일치시킨다.
- superseded 이슈/PR과 과거 정책 문구를 정리한다.
- Follow MVP canonical chain, required-check cwd 회귀 수정, #664/#675 main 반영은 완료 상태로 취급하고 재구현하지 않는다.
- 문서 정리 자체가 새 기능 범위를 만들지 않도록 한다.

## P3 — 보류

- 온라인/레시피 공개 확장
- 추가 테마·카테고리
- AI 취향평가 UI·CTA
- 비필수 추천 고도화
- 비용·운영복잡도를 늘리는 추가 자동화

사용자가 별도로 우선 지시하지 않는 한 P0~P2 안정화가 끝나기 전 시작하지 않는다.
