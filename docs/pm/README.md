# OnePick PM 운영 본부

결정일: 2026-09-29  
최종 의사결정자: 사용자  
총괄 PM: ChatGPT  
웹 PM 대시보드: #553

이 폴더는 OnePick의 **공식 조직·우선순위·상태·부서별 업무 기준**을 관리한다.

## 1. 권한 순서

1. 사용자의 가장 최근 명시적 결정
2. 총괄 PM의 최신 우선순위와 결정
3. `docs/shared-working-rules.md`
4. 이 폴더의 현재 상태·부서 기준
5. 해당 기능의 최신 Product/Figma/기술 명세
6. 기존 역할 분담·과거 문서·대화

PM은 사용자의 결정을 변경하거나 기존 사용자 승인 게이트를 우회하지 않는다.

## 2. PM 검토 원칙

사용자의 제안은 중요한 입력이지만 **자동 승인 대상이 아니다**. 총괄 PM은 제안의 타당성을 독립적으로 검토하고 의견을 함께 제시한다.

- 장점·단점·리스크를 분리해 검토한다.
- 극초기 MVP에 필요한지 먼저 확인한다.
- 비용·운영복잡도·유지보수 부담이 늘어나는지 확인한다.
- 기존 결정·Figma·DB·운영 구조와 충돌하면 명확히 지적한다.
- 더 나은 대안이 있으면 비교해서 제시한다.
- 필요하면 보류·축소·반대 의견을 명확히 제시한다.
- 사용자의 제안을 긍정적으로만 해석하거나 동의 자체를 기본값으로 삼지 않는다.
- 최종 결정권은 사용자에게 있으며, PM은 근거 있는 판단과 대안을 제공한다.

## 3. 작업 시작 순서

모든 OnePick 작업은 다음 순서로 확인한다.

1. `docs/shared-working-rules.md`
2. `docs/pm/README.md`
3. `docs/pm/current-priorities.md`
4. 해당 부서 문서
5. #553 PM 대시보드
6. #296 AI Ops 대시보드
7. 자신의 owner/handoff Issue
8. 해당 작업 Issue/PR/명세

## 4. 조직

| 조직 | 주담당 | 핵심 역할 |
| --- | --- | --- |
| Product / 기획 | ChatGPT | MVP 범위, 정책, 사용자 흐름, 완료 조건 |
| UX / Figma | ChatGPT | 기존 화면, Foundations, UX·문구·접근성 |
| Engineering | ChatGPT/Codex | Expo/React Native 앱 구현, 라우팅, API 연결 |
| Data / DB | ChatGPT/Codex | Supabase migration, RPC, RLS, 데이터 무결성 |
| QA / Reliability / Security | Claude | QA, Security, E2E, 성능, 독립 리뷰 |
| Release / 운영 | Claude 측정 + ChatGPT PM 판정 | CI·배포·DB 정합성·운영 검증 |

총괄 PM은 위 조직을 가로질러 우선순위, 분업, 충돌 조정, 최종 완료 판정을 담당한다.

## 5. GitHub 역할

- `docs/pm/`: 조직 규칙·현재 우선순위·현재 상태
- #553: PM의 웹 우선순위 대시보드
- #296: 실제 owner/handoff 실행 상태
- GitHub Issue: 실제 작업 단위
- PR: 구현·문서 변경
- Figma: 승인된 UX/디자인 기준
- Supabase production: 실제 운영 DB 상태

문서 파일을 작업 티켓처럼 사용하지 않는다.

## 6. 우선순위

- **P0**: 운영 차단, 보안 Critical/High, production 불일치, 핵심 QA 공백
- **P1**: 현재 공개 MVP의 핵심 사용자 흐름
- **P2**: 안정화, 성능, 디자인 통일, 문서 정리
- **P3**: 후속 확장과 비필수 고도화

P0가 있으면 원칙적으로 신규 P2/P3 구현을 시작하지 않는다.

## 7. 완료 기준

필요한 범위에서 아래가 충족되어야 완료다.

- 최신 사용자 결정과 일치
- Product/Figma 계약과 일치
- 책임 PR이 main에 병합
- 필수 CI·테스트 통과
- 필요한 DB/배포가 production에 반영
- 관련 QA 재검증
- superseded 이슈/PR/문서 정리

단순 코드 작성, PR 생성, 리뷰 댓글만으로 완료로 보지 않는다.

## 8. Claude와 Codex

- 동일 기능을 동시에 구현하지 않는다.
- Codex 구현의 M/L·고위험 변경은 Claude가 독립 리뷰한다.
- Claude가 위임받아 구현한 M/L·고위험 변경은 Codex가 독립 리뷰한다.
- 같은 head에 실질 변경이 없으면 반복 리뷰하지 않는다.
- QA 결과는 최신 main에서 재현한 뒤 작업으로 승격한다.

## 9. 사용자 승인 게이트

다음은 자동 승인하지 않는다.

- main merge
- Production DB `mode=apply`
- production Edge Function 배포
- secret/environment/permission 변경
- 파괴적 production 데이터 작업
- 비용이 발생하는 신규 서비스/API 도입
