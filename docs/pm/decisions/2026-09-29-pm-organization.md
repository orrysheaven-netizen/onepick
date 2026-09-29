# 결정 기록 — PM 조직 운영 전환

결정일: 2026-09-29

## 결정

OnePick의 부서별 기준을 여러 대화창에 분산하지 않고 GitHub `docs/pm/`을 공식 조직 본부로 사용한다.

## 구조

- 사용자: 최종 의사결정 및 Production 승인
- ChatGPT: 총괄 PM
- Product: ChatGPT
- UX/Figma: ChatGPT, Claude 보조 검토
- Engineering: ChatGPT/Codex, Claude 독립 검토
- Data/DB: ChatGPT/Codex, Claude 독립 검토
- QA/Reliability/Security: Claude
- Release/운영: Claude 측정·검증 + ChatGPT PM Go/Hold 판정

## 실행 방식

- 규칙·조직·우선순위: `docs/pm/`
- 웹 PM 대시보드: #553
- 실행 상태: #296
- 실제 작업: GitHub Issue
- 구현: PR
- M/L·고위험: 반대 AI 독립 리뷰
- 최종 merge/Production 변경: 사용자 승인 게이트

## 이유

대화창은 실행 맥락으로 사용할 수 있지만 공식 결정·업무 분배·상태는 GitHub에 남겨야 Claude와 Codex가 같은 기준을 지속적으로 참조할 수 있다.
