# OnePick 정기 루틴 업무대장

기준일: 2026-09-29  
상위 기준: `docs/pm/README.md`, `docs/pm/current-priorities.md`, #553

정기 루틴은 PM 조직을 대체하지 않는다. 각 루틴은 자신의 담당 범위만 점검·보고하며, 신규 기능·우선순위·owner를 임의로 만들지 않는다.

## 운영 원칙

1. 사용자 최신 지시와 PM 현재 우선순위를 먼저 따른다.
2. 각 담당 조직이 자기 영역을 1차 점검한다.
3. QA/Reliability/Security는 독립 검증을 수행한다.
4. 자동 수정은 명시된 owner/handoff 범위에서만 허용한다.
5. 기준선 점검 기간에는 신규 기능 구현형 루틴을 중단한다.
6. main merge, Production DB apply, production Edge Function deploy, secret/environment/permission 변경, 파괴적 데이터 작업은 사용자 승인 게이트를 유지한다.
7. 계정 소유자가 직접 해야 하는 UI·인증·Secret·MFA·결제는 **관리자 직접 수행 필요**로 표시한다.
8. 완료된 특정 PR/이슈를 감시하는 일회성 루틴은 목적 달성 후 비활성화한다.

## 현재 루틴

| 루틴 | 주기(KST) | 담당 | 상태 | 역할 | 자동 변경 범위 |
| --- | --- | --- | --- | --- | --- |
| GitHub Actions Daily QA | 매일 06:00 | QA/Reliability | 유지 | 라이브·로그인 QA, 오류/DB health 측정 | 측정·아티팩트만 |
| OnePick daily security | 매일 06:30 | Claude / Security QA | 유지 | Security QA 점검·이슈 보고 | 구현은 별도 owner/handoff |
| OnePick daily QA | 매일 07:00 | Claude / QA | 유지 | Daily QA 분석·이슈 보고 | 구현은 별도 owner/handoff |
| OnePick QA 브리핑 | 매일 07:30 | ChatGPT / PM 지원 | 유지·정비 | #553/#557/#296 기반 차단·담당·관리자 조치 요약 | 읽기·요약만 |
| 아침 루틴 통합 요약 | 매일 08:00 | ChatGPT | 유지·정비 | 최근 24시간 루틴 결과 100자 이내 통합 | 읽기·요약만 |
| OnePick QA Builder | 매일 08:00 | ChatGPT/Codex | **기준선 기간 중 중단** | 과거 QA 수정 자동 구현 | 중단 |
| OnePick 자동화 구현 | 매일 10:00 | ChatGPT/Codex | **기준선 기간 중 중단** | 과거 자동화 backlog 구현 | 중단 |
| Claude PR/QA 반복 검토 | 09~23시 2시간 간격 | Claude | 유지 | 열린 PR 독립 리뷰·QA 완료 기준 확인 | 리뷰/보고, 구현은 handoff 시 |
| Weekly QA | 매주 월 08:00 | Claude / QA | 유지 | QA 추세 보고 | 읽기·보고 |
| OnePick 주간 점검 | 매주 금 07:00 | 각 담당 보고 + PM 취합 | 유지·정비 | 부서별 상태 취합 및 다음 우선순위 판정 | 읽기·PM 판정 |
| OnePick 월비용 | 매주 월 08:00 | ChatGPT | 유지 | 월 예상 운영비 갱신 | 읽기·계산 |
| PR #555 병합 실행 | 조건 충족 시 | PM | 임시 | 승인된 head의 CI 충족 후 병합 | #555 병합과 후속 상태 전환만 |
| 특정 완료 PR 감시 | 목적별 | PM/Release | 목적 달성 후 종료 | 과거 PR 상태 감시 | 신규 작업 생성 금지 |

## 현재 기준선 기간 규칙

#557 기준선 점검이 끝날 때까지 아래는 자동으로 시작하지 않는다.

- 신규 기능 구현
- 과거 backlog의 자동 구현
- PM 우선순위에 없는 리팩터링
- 비용 증가 기능
- 후속 온라인/레시피 공개 작업

허용되는 자동 루틴은 다음이다.

- QA/Security 측정·보고
- 담당별 기준선 자체 점검
- 독립 검증
- 운영 정합성 확인
- 요약·비용 보고
- 사용자 승인 완료 작업의 안전한 후속 처리

## 기준선 점검 연계

- #558 Product 자체 점검
- #559 UX/Figma 자체 점검
- #560 Engineering 자체 점검
- #561 Data/DB 자체 점검
- #562 QA 독립 재검증
- #563 Release 운영 검증
- #557 PM 취합

루틴은 위 이슈의 결과를 보조할 수 있지만, 담당자의 자체 점검을 대신하지 않는다.

## 관리자 조치 표기

- **관리자 승인 필요**: AI가 실행 가능하지만 승인 후 진행해야 하는 작업
- **관리자 직접 수행 필요**: OAuth token, GitHub Secret, MFA, 결제 등 계정 소유자가 직접 수행해야 하는 작업

현재 별도 관리자 직접 수행 항목은 #486의 Claude OAuth token 재발급 및 GitHub Actions Secret 교체다.
