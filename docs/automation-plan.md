# QA·운영 자동화 계획 (Claude ↔ ChatGPT/Codex)

결정일: 2026-09-23. 2026-09-25부터 역할 분담 v2는 `docs/ai-role-division.md`, 일일 QA는 `docs/daily-qa.md`를 따른다.

원칙: **사람이 따로 알리거나 시작 버튼을 누르지 않는다.** 각자 정해진 시각에 GitHub을 읽고 일한다. 진행 상황의 유일한 원본은 GitHub(이슈·PR·Actions)이다. 한 작업은 한 에이전트만 맡는다. ChatGPT/Codex가 기본 작업 조정 주체이며, 작업량은 `size:S/M/L` 점수로 최근 14일 Codex 60% : Claude 40%를 목표로 한다. 고위험 변경의 교차 검증과 사용자 승인 게이트는 작업량 비율보다 우선한다.

## 역할 분담

| # | 자동화 | ChatGPT/Codex (빌더) | Claude (QA·리뷰) |
| --- | --- | --- | --- |
| A | 일일 QA 리포트 (완료) | 리포트 이슈의 수정 요청을 PR로 처리 | 06:00 측정 도구, 07:00 리포트 이슈 |
| B | PR 성능 검사 | Cloudflare 미리보기 배포가 끝나면 `tools/qa/live-qa.mjs`를 실행하는 워크플로와 PR 댓글. 첫 로드 JS 예산을 `verify-web`에 추가 | `live-qa.mjs`에 미리보기 모드(`--budget`, JSON 판정 결과, 종료 코드) 추가 |
| C | PR 자동 리뷰·수정 확인 | PR 템플릿에 `Refs #<qa 이슈>`와 "완료 기준" 칸 추가 | 2시간마다 열린 PR을 리뷰하고, `Refs`된 QA 항목의 완료 기준을 확인해 댓글로 남김 |
| D | 실사용자 오류 급증 감지 | 1시간마다 도는 Actions 워크플로. 급증하거나 새 오류 코드가 나오면 `qa-alert` 라벨 이슈 생성 | 급증 기준값 검토. 다음 날 리포트에서 원인 분석 |
| E | 배포 일치 확인 | `main`에 push된 뒤 Cloudflare `deployment.json` 커밋과 Edge Functions 배포 상태가 `main` HEAD와 같은지 확인하는 워크플로 | 일일 리포트에 결과 반영 |
| F | 로그인 상태 QA | 테스트 전용 계정(이메일 로그인), RLS상 안전한 시드 데이터, `QA_TEST_EMAIL`/`QA_TEST_PASSWORD` 시크릿 | 원픽 등록·댓글·프로필 시나리오 스크립트를 `tools/qa`에 추가 |
| G | DB 성능·보안 점검 | 점검에서 나온 인덱스·RLS 수정 migration | Supabase advisors와 느린 쿼리 상위 목록을 일일 리포트에 추가 (읽기 전용) |
| H | 의존성·보안 업데이트 | Dependabot 설정(npm `mobile/`, `tools/qa/`, GitHub Actions, 주 1회) | 업데이트 PR 리뷰 |
| I | 주간 추세 리포트 | 없음 | 매주 월요일 `[Weekly QA]` 이슈 작성 |

## 일정 (KST, 알림 없이 자동 실행)

### 반복

| 시각 | 주체 | 일 |
| --- | --- | --- |
| 매일 06:00 | Actions `Daily QA` | 라이브 측정, 실사용자 오류 집계 |
| 매일 06:30 | Claude 루틴 | 먼저 `handoff:claude` preflight 후 `[Security QA]` 보안 점검 이슈 (`docs/daily-security.md`) |
| 매일 07:00 | Claude 루틴 | 먼저 `handoff:claude` preflight 후 `[Daily QA]` 이슈 작성 |
| 매일 07:30 | ChatGPT 예약 작업 | AI Ops 대시보드와 `handoff:codex`를 확인해 Codex의 작업을 정리. 고위험 보안·DB 변경은 현재 owner/handoff 또는 사용자 위임에 따라 담당하고, 반대 AI의 독립 검토를 필수로 함 |
| 매일 09~23시, 2시간마다 | Claude 루틴 | 먼저 `handoff:claude` 한 건을 수락/진행한 뒤 열린 PR 리뷰와 QA 항목 수정 확인 (C) |
| 매시 정각 (D 완료 후) | Actions | 실사용자 오류 급증 감지 |
| 매주 월 08:00 | Claude 루틴 | 먼저 `handoff:claude` preflight 후 `[Weekly QA]` 주간 추세 (I) |
| 매주 월 09:00 | Dependabot (H 완료 후) | 의존성 업데이트 PR |

### 단계별 마감

1. **1단계, ~9/25(금)**
   - ChatGPT: C(PR 템플릿), E(배포 일치 확인), H(Dependabot)
   - Claude: 9/24(목)부터 PR 리뷰 루틴 시작
2. **2단계, ~9/29(월)**
   - Claude: 9/26(금) 10:00에 B의 도구 쪽과 G를 PR로 올림
   - ChatGPT: 그 PR이 병합된 뒤 B의 워크플로를 연결
3. **3단계, ~10/2(목)**
   - ChatGPT: D(오류 급증 감지), F(테스트 계정·시크릿)
   - Claude: 10/1(수) 10:00에 F의 시나리오 스크립트 PR. 테스트 계정 시크릿이 없으면 건너뛰고 추적 이슈에 남김
4. **10/5(월) 08:00**: 첫 주간 추세 리포트

앞 단계가 끝나지 않았으면 다음 단계 담당은 기다리지 않는다. 할 수 있는 부분까지 하고, 막힌 내용을 추적 이슈에 댓글로 남긴다.

## 진행 추적

- 추적 이슈: 라벨 `automation-plan`, 제목 `[자동화 계획] QA·운영 자동화`
- 항목마다 담당·마감 체크박스를 둔다. 완료한 에이전트가 PR 링크와 함께 체크한다.
- PR 본문에는 `Refs #<추적 이슈>`와 항목 문자(A~I)를 적는다.
- 상대가 맡은 항목은 구현하지 않는다. 리뷰와 댓글로만 참여한다.


## 역할 분담 v2 운영 (2026-09-25)

- 기준 이슈: #295 `[AI 운영] ChatGPT/Codex 60 : Claude 40 역할 분담 v2`
- 공용 상태판: #296 `[AI Ops] OnePick 작업·인계 대시보드`
- 완료 보고는 별도 완료 이슈가 아니라 원래 작업 이슈의 `## 완료 리포트` 댓글로 남긴다.
- 후속 담당이 바뀌면 `state:handoff` + `handoff:codex` 또는 `handoff:claude`를 붙인다.
- 두 AI는 세션 시작 시 #296 → 자기 handoff → 해당 작업 이슈/PR 순서로 읽는다.
- Claude의 모든 예약 루틴과 일반 세션은 `CLAUDE.md`의 공통 handoff preflight를 먼저 수행한다. 한 번에 한 이슈만 수락하고, 수락 즉시 `handoff:claude`를 제거해 중복 실행을 막는다.
- 예약 루틴의 필수 산출물(Security QA, Daily QA, Weekly QA 등)은 handoff 수락 때문에 생략하지 않는다.
- AI Ops workflow는 GitHub 이슈/라벨/PR 데이터만 사용하고 외부 AI API를 호출하지 않는다.
- 기존 A~I 자동화 항목의 역사적 결정은 유지하되, 현재 담당·교차검토·사용자 승인 기준이 충돌하면 `docs/ai-role-division.md`의 최신 원칙이 우선한다.
