# 매일 아침 앱 QA (Claude → ChatGPT/Codex)

결정일: 2026-09-23. 역할 분담은 `docs/ai-role-division.md`를 따른다. Claude는 QA와 리포트를 맡고, 수정은 ChatGPT/Codex가 PR로 진행한다.

## 흐름

| 시각 (KST) | 주체 | 하는 일 |
| --- | --- | --- |
| 06:00 | GitHub Actions `Daily QA` (`.github/workflows/daily-qa.yml`) | 테스터 사이트를 실제 휴대폰 환경처럼 열어 측정하고, 실사용자 오류 집계를 만든다 |
| 07:00 | Claude Code Routine "OnePick daily QA" | Actions 결과와 최근 24시간 변경을 분석해 GitHub 이슈 `[Daily QA] YYYY-MM-DD`(라벨 `qa-report`)를 만든다 |
| 이후 | ChatGPT / Codex | 이슈의 High → Medium 순으로 수정 PR을 만든다. PR 본문에 `Refs #<이슈>`를 남긴다 |
| 다음 날 07:00 | Claude | 전날 항목이 고쳐졌는지 다시 측정하고, 전날 이슈를 닫으며 남은 항목을 새 이슈로 넘긴다 |

Claude 클라우드 세션은 네트워크 정책 때문에 `onepick-5cl.pages.dev`와 Supabase에 직접 접속하지 못한다. 그래서 실제 측정은 Actions가 하고, Claude는 GitHub MCP로 그 로그를 읽는다.

## Actions가 측정하는 것

`tools/qa/live-qa.mjs`는 iPhone 13 에뮬레이션, 비로그인 상태로 측정한다.

- **대상 화면**: `/`, `/explore`, `/auth/login`, `/legal/terms`, 홈 카드 → 상세 전환, 저속 4G·CPU 4배 감속 상태의 홈
- **속도**: TTFB, FCP, LCP, 화면 준비 시간(네트워크 안정 후 스피너가 사라지고 본문이 보일 때까지), JS 전송량, TBT, CLS
- **오류**: 처리되지 않은 JS 예외, 콘솔 에러, 실패한 요청, 4xx/5xx 응답, 끝나지 않는 스피너, 화면에 노출된 오류 문구, 빈 화면
- **Supabase**: 화면별 호출 수와 p95 응답 시간, 가장 느린 요청
- **결과물**: `report.md`, `report.json`, 스크린샷. 아티팩트 `daily-qa-live-web`으로 14일 보관하고, 로그에서는 `===QA-REPORT-BEGIN===` 표시로 찾는다

기준값은 `live-qa.mjs`의 `LIMITS`에서만 조정한다. URL은 쿼리스트링을 지우고 기록한다. 쿼리스트링에 토큰이나 필터가 들어갈 수 있기 때문이다.

`tools/qa/real-user-errors.mjs`는 `SUPABASE_ACCESS_TOKEN`으로 `client_error_events`와 `product_analytics_events`를 읽는다. 최근 24시간과 8일 동안의 **집계만** 가져오고, 사용자 ID나 경로는 가져오지 않는다.

로컬에서는 다음처럼 실행한다.

```bash
cd tools/qa && npm ci && npx playwright install chromium
QA_BASE_URL=https://onepick-5cl.pages.dev node live-qa.mjs   # 결과: tools/qa/qa-output/
```

## Claude 루틴 절차

1. **Actions 결과 확인**: 오늘 06:00 KST 이후 `main`에서 실행된 `Daily QA`를 찾는다(`actions_list`). 없거나 실패했으면 `workflow_dispatch`로 한 번 실행한다. 끝나지 않았으면 몇 분 기다린다. 그래도 결과가 없으면 리포트에 "라이브 측정 없음"과 그 이유를 적는다.
2. **로그 추출**: `live-web`과 `real-user-errors` 두 잡의 로그에서 `===QA-REPORT-BEGIN===`부터 `END`까지를 가져온다(`get_job_logs`).
3. **배포 확인**: 리포트의 배포 커밋을 `main` HEAD와 비교한다. 다르면 배포 지연 또는 실패로 기록한다. `main`의 필수 CI(`typecheck`, `verify-web`, `database-tests`)가 실패했는지도 확인한다.
4. **최근 24시간 변경 검토**: `main`에 병합된 커밋과 PR의 diff를 읽는다. 다음 네 가지를 코드 근거와 함께 찾는다.
   - 사용자가 겪을 오류(예외 처리 누락, 오류 상태 누락, 무한 로딩)
   - 느려지는 코드(순차 await, N+1, 과도한 select·limit, 인덱스 없는 정렬, 불필요한 재요청이나 폴링)
   - 첫 번들을 키우는 import
   - RLS와 성능이 함께 문제가 되는 곳
5. **이전 리포트와 비교**: 열려 있는 `qa-report` 이슈의 항목마다 상태를 붙인다.
   - `해결됨`: 측정이나 코드로 확인됨
   - `진행 중`: 연결된 PR이 있음
   - `미해결`
   - `신규`
6. **이슈 작성**: 아래 형식으로 `[Daily QA] YYYY-MM-DD` 이슈를 만든다(라벨 `qa-report`). 이전 이슈에는 새 이슈 링크를 댓글로 남기고 `completed`로 닫는다.
7. **추측 금지**: 근거 없는 추측은 넣지 않는다. 한 번의 측정값만 느린 것은 `Low`로 두고 다음 날 재측정한다. 이틀 연속 기준을 넘으면 올린다.

Claude는 앱 코드를 직접 고치지 않는다. 테스트 보강이나 QA 도구(`tools/qa`, 이 문서) 개선은 역할 분담상 Claude가 해도 된다.

## 이슈 형식

```markdown
## 요약
- 결과: High n · Medium n · Low n / 전날 대비 해결 n · 신규 n
- 배포: <커밋> (main HEAD와 일치/불일치) · main CI: 통과/실패
- 핵심 수치: 홈 FCP / LCP / 준비 시간, 저속 4G 홈 LCP, 가장 느린 Supabase 요청

## 수정 요청 (ChatGPT/Codex)
### [High] <한 줄 제목>  — 신규|미해결(n일째)
- 위치: `path/file.ts:line`
- 사용자 영향: <실제로 겪는 것>
- 재현/근거: <측정값·로그·코드>
- 제안: <구체적 수정 방향>
- 완료 기준: <다음 날 측정으로 확인할 조건>

## 해결 확인됨
## 측정 전문 (접어 두기)
<details><summary>라이브 웹 QA</summary> ... </details>
<details><summary>실사용자 오류</summary> ... </details>

@codex 위 "수정 요청"을 High부터 처리해 주세요. 항목별로 main 기준 PR을 만들고, PR 본문에 `Refs #<이 이슈>`와 해당 항목 제목을 적어 주세요. 규칙은 AGENTS.md를 따릅니다.
```

## ChatGPT/Codex 쪽 처리

ChatGPT/Codex가 리포트를 확인하는 경로는 세 가지다. 어느 하나가 빠져도 나머지로 이어진다.

1. **세션 시작 규칙**: 루트 `AGENTS.md`의 "Daily QA report" 절이다. Codex는 작업을 시작할 때마다 이 파일을 읽으므로, 열린 `qa-report` 이슈를 먼저 확인한다.
2. **이슈 멘션**: 리포트 이슈 끝의 `@codex` 요청이다. 저장소에 Codex GitHub 연동이 켜져 있으면 바로 작업이 만들어진다.
3. **ChatGPT 예약 작업**: 매일 07:30 KST에 아래 프롬프트를 실행하도록 ChatGPT의 예약 작업(Tasks)에 등록한다. GitHub 커넥터가 켜져 있어야 한다.

```text
매일 07:30(한국 시간)에 실행. GitHub 저장소 orrysheaven-netizen/onepick에서 라벨 qa-report가 붙은
가장 최근의 열린 이슈("[Daily QA] YYYY-MM-DD")를 읽어라. 없으면 "오늘 QA 리포트 없음"이라고만 답한다.
있으면 다음을 한국어로 정리한다.
1) 요약 줄의 High/Medium/Low 건수, 전날 대비 해결·신규 건수
2) "수정 요청"의 High·Medium 항목마다: 제목, 위치(파일:줄), 완료 기준, 상태(신규/미해결 n일째/진행 중)
3) 오늘 착수할 순서(High 우선, 같은 파일을 건드리는 항목은 묶기)와 항목별 Codex 작업 지시문 한 단락
4) "해결 확인됨"에 올라간 항목
작업 규칙은 저장소의 AGENTS.md와 docs/daily-qa.md를 따른다. main 기준 PR 하나에 항목 하나,
PR 본문에 "Refs #<이슈 번호>"를 넣는다. 오탐이라고 판단되면 이슈에 근거를 댓글로 남긴다.
```

처리 규칙:

- `qa-report` 라벨의 가장 최근 열린 이슈가 할 일 목록이다.
- 항목 하나에 PR 하나를 원칙으로 한다. 이미 같은 파일을 수정하는 PR이 있으면 그 PR에 합친다.
- 항목이 오탐이면 이슈에 이유를 댓글로 남긴다. Claude는 다음 날 그 항목을 `오탐`으로 정리한다.
