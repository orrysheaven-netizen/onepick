# Engineering 자동 인계 착수 점검 — 2026-09-29

원래 작업: [#571](https://github.com/orrysheaven-netizen/onepick/issues/571). 책임: Engineering 팀장. PM 조정: PM-2 / #553. 상태: **blocked — 준비 자료 작성, 구현·실제 인계 미완료**.

기준 main: `eada433f0c63a547928c0387cb0cd4843d622d4b`. 최신 origin/main을 fetch한 뒤 독립 worktree에서 점검했다. 공유 primary checkout의 작업 파일은 수정하지 않았다. 이 문서는 실행 명령이나 새로운 담당 배정이 아니라 시점별 감사 기록이다. 후속 착수 시 최신 이슈·PR·head를 다시 확인한다.

## 1. 선행조건과 중복 확인

| 대상 | 확인 결과 | 다음 조건 |
| --- | --- | --- |
| #571 | open, owner:claude, state:blocked. 인계 수락·구현 PR 확인 안 됨 | #573 반영 → #486 성공 → PM 결과 확인. 실행 전 기존 담당 착수 재확인 |
| #573 | open, non-draft, head `fc4abfbdcc454720655b8f7f1cd01decf7c503b3`; Codex 검토와 실제 Claude OAuth 독립 검토 게시 완료 | PM의 CI 경로 생략 근거 확인 및 정확한 head 사용자 병합 승인 |
| #486 | blocked, bot cycle 기록 3/4, 마지막 실행 실패 | #573 병합 후 기존 한도 내 마지막 1회. marker 삭제·초기화 금지 |
| #567 | open, head `490466f3d0ab671b0cd30caa86787e377c6f4161`; PM review queue 기존 구현 있음 | 중복 구현 금지. 기존 리뷰의 이벤트 유실·runner 비용·보호 목록 지적 처리 확인 |
| #564 | #573과 같은 allowedTools 수정의 이전 PR | 새 수정 PR을 만들지 않음. #573 처리 후 기존 담당이 superseded 정리 |

열린 PR 전체 6건(#573/#567/#564/#473/#466/#464)을 확인했다. #571 dispatcher에 해당하는 열린 구현 PR은 없었다. 이것은 로컬/미게시 작업 부재의 증명은 아니므로 실제 착수 직전에 다시 확인한다. #448의 active 작업, #492/#552 인계와 UI/DB 작업은 이 감사에서 실행하지 않는다. [열린 이슈 23건의 담당·상태·선행·산출물 점검표](engineering-handoff-open-issues-2026-09-29.md)를 함께 작성했다.

### CI와 실제 실행 근거

- #573: `changes` 3개 job SUCCESS; `typecheck`, `verify-web`, `database-tests`는 각각 SKIPPED. 현재 main의 경로별 gate에서 handoff workflow만 바뀐 PR의 앱/DB heavy job을 생략한 결과다. 실제 테스트 실행 성공으로 표기하지 않는다. Vercel은 build rate limit FAILURE이며 코드 실패와 구분한다.
- #573 변경은 allowedTools 한 줄이다. #564의 이전 head 리뷰를 새 head 리뷰 완료로 대체하지 않는다. 이 변경만으로 Claude 오류가 해결된다고 단정할 수 없다.
- 현재 head 검토: [Codex 보고](https://github.com/orrysheaven-netizen/onepick/pull/573#pullrequestreview-5353100507), [실제 Claude OAuth 독립 검토 및 실행 근거](https://github.com/orrysheaven-netizen/onepick/pull/573#pullrequestreview-5353247852). 둘 다 코드상 병합 차단 결함/권한 확대 없음, #486 해결 효과 미입증으로 판단했다. 두 보고는 COMMENT이며 사용자 병합 승인과 구분한다. 같은 head의 실질 변경이 없으면 모델 검토를 반복하지 않는다.
- 이 호스트의 CLI는 현재 `loggedIn=true`, `authMethod=claude.ai`, `apiProvider=firstParty`, `subscriptionType=max`로 재확인했다. 로그인 조치는 완료됐으며 다시 요청하지 않는다. 로컬 OAuth 성공은 GitHub Actions OAuth secret 유효성이나 #486 성공의 증명이 아니다. [기존 실패 로그 진단](https://github.com/orrysheaven-netizen/onepick/pull/573#issuecomment-5891090485)의 미로그인 기록은 과거 상태이며 현재 차단조건으로 사용하지 않는다.
- #486 최근 실패: [run 36551860181](https://github.com/orrysheaven-netizen/onepick/actions/runs/36551860181). 인계 3/4 수락 뒤 Claude 오류 및 blocked 기록이 있다.
- #560 실제 실행: [run 36572237481](https://github.com/orrysheaven-netizen/onepick/actions/runs/36572237481). claim SUCCESS → Run Claude Code FAILURE → finalize SUCCESS. 전체 run FAILURE다. 라벨/claim 성공은 작업 완료 증거가 아니다.
- #567 필수 3종은 현재 head에서 SUCCESS. 그러나 아직 main에 없고, [기존 리뷰](https://github.com/orrysheaven-netizen/onepick/pull/567/files)는 concurrency pending 교체에 의한 PM 판정 유실 가능성을 지적한다.

## 2. 현재 코드와 요구사항 차이

| 요구사항 | 현재 근거 | 구현 시 필요한 검증 |
| --- | --- | --- |
| 모든 작업 문서/열린 이슈의 담당·상태·선행·산출물 | owner/state label과 비정형 본문이 혼재. 아래 23건 inventory 참조 | 누락 필드에 명시적 unknown; 참조 링크를 dependency로 자동 해석하지 않음 |
| 팀장 책임과 실제 실행기 분리 | 기존 owner:codex/claude는 AI 실행/인계 식별 | department/lead와 executor를 분리. PM은 구현하지 않고 완료 판정 |
| 복수 선행조건 | CI Gate는 한 PR의 bot pending marker 중심. 작업 간 dependency graph 없음 | AND 조건, 누락·순환·자기참조·취소·superseded·다시 열린 선행조건은 실행 차단 |
| 선행 완료 증거 | CI Gate는 workflow 전체 결론 success를 사용 | 정확한 head·승인된 변경·관련 테스트·현재 head 독립 리뷰·필요 시 main 병합/운영 반영 확인. closed/COMPLETE만으로 완료 불가 |
| blocked/active | CI Gate의 라벨 검사에는 blocked/handoff만 있고 active 없음. Claude claim도 active/closed 방어 없음 | 모든 dispatch/claim/finalizer 경계에서 현재 상태 재확인, active를 지우며 새 작업 인계 금지 |
| 중복 이벤트 | review-events에 durable pending/processed queue 있음 | #571 신규 구현에서 재사용 가능한 계약만 활용. 동시 enqueue, label 성공 후 marker 실패, claim이 label을 먼저 소비한 경우까지 검증 |
| 자동 재개 | review-events는 review/comment 이벤트만 수신 | active/blocked 해제 및 모든 dependency 완료 시 최신 증거 재평가. 재시도할 기회 자체가 없어지는 경우 방지 |
| 재시도 한도 | Claude/Codex claim의 cycle count가 `comments?per_page=100` 단일 페이지 | 모든 페이지 합산, 위조 marker 제외, 두 실행기 합산 4회 유지, 실행 시도와 인프라 재시도 구분 |
| 승인 대기 | #567은 GitHub 내부 PM queue이며 미병합 | PM 판단과 사용자 승인 별도. 승인 없으면 merge/Production/secret/permission 실행 불가 |
| 유료 AI API 미사용 | Codex Action flag 기본 OFF. Claude finalizer/CI Gate에는 handoff:codex 생성 경로 잔존 | 해당 라벨이 수동/구독 기반 검토 대기인지 실제 무인 실행인지 구분. Codex API 활성화 금지 |
| 보호 목록 | 현 main 목록에 아직 신규 dispatcher/PM queue 없음 | 별도 고위험 변경으로 목록/실제 차단을 검토. 자동 실행기의 자기보호 우회 금지 |

관련 파일: `.github/workflows/ai-handoff-claude.yml`, `ai-handoff-codex.yml`, `ai-handoff-ci-gate.yml`, `ai-handoff-review-events.yml`, `.github/scripts/ci-path-gate.sh`. 이 문서에서 코드 변경은 하지 않았다. 위 항목은 코드 읽기 결과이며 실패 재현 테스트 결과로 주장하지 않는다.

## 3. 작업 정보 계약 초안

작업 이슈를 단일 실행 단위로 유지한다. 문서는 원래 작업 이슈와 연결하며 파일마다 실행 라벨을 붙이지 않는다. 아래는 후속 구현 검토용 필드이며 아직 parser/validator/실행 계약은 없다.

- `task_issue`: 원래 작업 이슈 URL; `kind`: task / dashboard / reference / decision.
- `department`, `responsible_lead`: 결과 책임 부서·팀장. 미정이면 unknown으로 차단.
- `executor`: claude-oauth / local-session / manual / none. AI 이름과 팀장 책임을 혼동하지 않음.
- `state`, `blocked_reason`, `approval_status`: ready / active / blocked / review / approval-wait / complete 및 근거.
- `depends_on[]`: 대상 이슈·PR, 요구 상태, 증거 URL/정확한 SHA. 빈 배열은 선행 없음이 확인된 경우만 허용.
- `deliverables[]`: 문서·PR·run·테스트·독립 리뷰·실제 후속 담당 수락/완료 증거.
- `next_department`, `source_id`, `attempts`: 다음 책임자, 원 이벤트 식별자, 영구적인 시도 기록.

실행 판단: 신뢰된 배정 + 유효한 작업 메타데이터 + 모든 선행 증거 충족 + 승인 충족 + 현재 open + 비active/비blocked + 기존 claim/handoff 없음 + 실행기 가용 + cycle<4. 하나라도 unknown이면 실행 라벨을 만들지 않는다. label 적용은 원자적 실행 lock이 아니므로 여러 workflow 간 경합을 별도로 막아야 한다.

### 규칙 기반 인계를 우선하고 모델 호출을 분리한다

- 라벨·선행조건·CI/head·리뷰·승인·시도 횟수·SOURCE_ID 판정은 GitHub API 데이터와 결정적 규칙으로 처리한다. 큐 저장/재평가/후속 라벨 결정에 LLM을 호출하지 않는다. 자연어를 모델이 임의로 완료/승인으로 해석하게 하지 않는다.
- 부서별 선행조건은 모든 항목의 AND 평가다. 데이터 누락/API 실패/해석 불가/순환 의존은 차단 또는 수동 확인 대기로 남긴다. PM이나 담당 팀장이 명시한 계약을 실행기가 스스로 보완하지 않는다.
- 모델은 실제 코드 작업 또는 필요한 독립 검토에만 사용한다. 기존 구독 OAuth/승인된 로컬 세션을 확인한 경우에만 호출하며 새 유료 모델 API, OpenAI API 기반 Codex Action, API-key fallback은 사용하지 않는다. 인증 미확인/한도 도달 시 다른 요금 경로로 전환하지 않는다.
- trusted 이벤트 → durable pending 저장 → 규칙 평가 → 실행권 확보 → 라벨 적용 확인 → 실제 담당 수락/실행 결과 확인을 구분한다. label/claim/워크플로 시작만으로 task complete를 기록하지 않는다.
- 이미 승인된 후속 작업은 선행 증거 충족 이벤트로 자동 재평가하는 것이 구현 목표다. 새로운 제품 판단·재배정·승인이 필요한 항목은 PM/user approval-wait로 보낸다. ChatGPT 채팅 자동 호출은 현재 구현된 기능으로 간주하지 않는다.
- GitHub Actions runner 비용은 별개다. 무관 이벤트의 job-level 차단과 이벤트 기반 재평가를 사용하고, 단순 상태 확인을 위해 polling/cron 또는 모델 호출을 추가하지 않는다. 이 문서는 설계이며 아직 실행 코드/라벨 변경이 아니다.

## 4. main 문서 연결 범위

| 문서군 | 책임/상태 | 연결 작업·산출물 |
| --- | --- | --- |
| `docs/pm/README.md`, `current-priorities.md`, `current-status.md`, `decisions/2026-09-29-pm-organization.md` | PM / 기준 문서 | #553, #557; 자체 실행 대상 아님 |
| `docs/pm/departments/product.md` | Product 팀장 / 이슈 상태 참조 | #558 자체 점검 보고 |
| `docs/pm/departments/ux-design.md` | UX 팀장 / 이슈 상태 참조 | #559, #552; Figma 직접 작업은 ChatGPT |
| `docs/pm/departments/engineering.md` | Engineering 팀장 / 이슈 상태 참조 | #560, #571; 이 준비 문서 |
| `docs/pm/departments/data-db.md` | Data/DB 팀장 / 이슈 상태 참조 | #561, #533; DB 증거·검증 보고 |
| `docs/pm/departments/qa-security.md` | QA/Security 팀장 / 이슈 상태 참조 | #562, #499, #497 |
| `docs/pm/departments/release-operations.md` | Release 팀장 / 이슈 상태 참조 | #563, #570 |
| `docs/pm/routines.md`, `docs/automation-plan.md` | 각 담당/PM 취합 / 루틴 대장 | #223, #557; 구현 중단/측정 유지 구분 |
| `docs/ai-handoff-runner.md`, `docs/ai-role-division.md`, `docs/shared-working-rules.md` | 운영 기준 / 현행 main | #296, #486, #571; dispatcher·실행기 검증 |

이 표는 PM/자동 인계 관련 문서 범위다. 전체 docs의 역사적 작업 문서까지 정규화했다고 주장하지 않는다. 전체 정규화에는 작업 문서/참조 문서 분류, 원 이슈 매핑, 현재 담당자의 산출물 확인이 남는다. 읽기 전용 프로젝트 `sources/`는 대상이 아니다.

## 5. 후속 구현 검증 목록 (아직 미실행)

1. 정상 Claude 지시 1건 → 팀장/실행기 식별 → 실제 산출물/완료 리포트 → 후속 팀장 수락까지 추적.
2. 두 선행조건 중 하나 미완료/CI 실패/리뷰 누락/병합 미승인 → 실행 없음. 모두 충족 후 1회만 인계.
3. stale head, review 후 새 commit, 비신뢰 source/marker, PR Refs 불일치, closed/reopened/superseded dependency → 실행 없음.
4. 연속 지시 3건·동일 이벤트 동시 배달·pending run 교체/취소 → 지시 유실과 중복 실행 없음.
5. active/blocked 동안 pending 보존, 해제 이벤트에서 재평가. 무관 댓글/자체 안내문은 runner 실행 없음.
6. label write 실패 → processed 없음; label 성공/marker 실패와 빠른 claim → 재시도 시 중복 실행 없음.
7. 댓글 100건 초과에서도 4회 한도 유지. 한도 도달 시 차단하고 자동 재시도/초기화 없음.
8. API/page/권한 실패 시 안전하게 정지. retry 한도와 운영 복구 경로를 명시.
9. to=codex는 유료 API로 호출하지 않음. 수동 검토 대기를 실제 무인 인계 성공으로 세지 않음.
10. PM/user approval-wait에서 후속 작업·main merge·Production 변경 없음. 필수 CI 이름/보호 규칙 유지.

YAML/actionlint, mock API 실패·경합 테스트, 필요한 회귀 테스트와 반대 AI 독립 리뷰가 필요하다. 실제 E2E는 #573 승인 반영과 #486 성공 전에는 실행하지 않는다. GitHub Actions 분 사용과 AI API 과금은 별개이며 이 감사는 실행기/비용 설정을 변경하지 않았다.

## 6. 재개/인계와 완료 판정

- Engineering: 이 준비 PR 및 23건 inventory 유지, 중복 구현 재확인, dispatcher 요구사항과 보호 파일 변경 범위 확정.
- QA/독립 리뷰: #573 현재 head 검토 완료. head가 바뀐 경우에만 변경 범위를 다시 검토한다. #567 기존 지적의 처리 여부 확인, #571 구현 후 독립 리뷰와 위 검증이 남는다.
- Release/운영: 승인된 #573 main 반영 후 #486 마지막 smoke test 1회 근거 수집. 실패하면 추가 Action 재시도 없이 self-hosted Claude CLI OAuth 대안의 운영 조건부터 검토.
- PM: 선행 완료 근거를 확인하고 담당/순서 조정 및 최종 완료 판정. PM이 구현을 대신하지 않는다.
- 관리자 승인 필요: PM이 현행 CI의 경로 생략 근거를 확인한 뒤 #573 head `fc4abfbdcc454720655b8f7f1cd01decf7c503b3`의 main 병합 승인. 일반적인 계속 진행 지시나 로컬 로그인 완료를 병합 승인으로 간주하지 않는다.
- 관리자 직접 수행 필요: 현재 없음. 로컬 구독 OAuth 로그인은 확인 완료다. GitHub Actions secret 재교체 필요 여부는 미확정이며 예방적으로 교체를 요청하거나 비밀값을 출력하지 않는다.

### 실행 체크리스트 — 담당·증거·승인 조건

아래는 실행 담당자가 재개할 때 사용할 절차다. 이번 준비 작업은 병합·smoke test·라벨 변경을 실행하지 않는다. 각 단계는 해당 원 이슈에 증거를 기록한 뒤에만 완료한다.

| 단계 | 책임/실행 담당 | 필요한 증거와 승인 조건 | 현재 판정 |
| --- | --- | --- | --- |
| 0. #573 검토 확인 | Engineering 팀장 / Codex·Claude 독립 검토 | 위 두 review URL의 commit이 현재 head와 동일; Claude 실제 성공 receipt; 실질 변경 없는 재검토 금지 | 완료 |
| 1. 병합 판단 | PM 조정 + 사용자 승인 / 승인된 병합 담당 | 정확한 head 승인 기록; 필수 `typecheck`, `verify-web`, `database-tests`의 실제 결론 및 경로 skip 근거; 최신 branch protection/mergeability 확인. 변경 시 승인/검토 재평가 | 승인 대기 |
| 2. #573 main 반영 확인 | Release 팀장 / 운영 담당 | PR mergedAt·mergeCommit과 최신 origin/main 포함 여부; 반영된 workflow의 Action pin·allowedTools; 실제 main SHA 기록. 단순 PR closed는 불충분 | 미병합 |
| 3. #486 1회 실행 사전확인 | Release 팀장 / 운영 담당 | 단계 2 증거; PM의 결과 확인 및 1회 재개 배정; 기존 bot cycle 전체 페이지 합산 3/4인지 확인; active/기존 handoff/run 없음; OAuth 실행 경로와 코드 변경 금지 범위 확인 | 선행 미충족, 실행 금지 |
| 4. #486 마지막 1회 | Release 팀장 / Claude OAuth 실행기 | 동일 이슈에서 기존 guard 유지; 단일 run URL·main SHA·인계 번호 기록. 중복 이벤트/수동 재실행/새 smoke issue/카운터 초기화 금지 | 미실행 |
| 5. 성공·실패 판정 | Engineering/Release 보고 + PM 결과 확인 | 실제 인증·Claude 실행 success/is_error=false; 정확한 `AI_HANDOFF_RESULT: COMPLETE`; finalizer 결과; 코드 변경/커밋/원격 브랜치/PR 생성 없음 확인. runner 내부 임시 checkout 브랜치는 원격 산출물과 구분하고 기록 | 증거 없음 |
| 6. 성공 후 담당별 재개 | PM 조정 / 각 부서 팀장 실행 | 아래 대상별 선행조건을 새로 확인하고 작업 1건씩 수락 증거 기록. #486 성공만으로 모든 이슈를 ready로 바꾸지 않음 | 차단 유지 |
| 실패 분기 | Release·Engineering / PM 조정 | 추가 Action 재시도 중단; 실패 run·실제 오류·시도 한도 기록. secret을 제거한 진단 또는 self-hosted 기존 OAuth 대안의 조건 제시; 설치/권한 변경은 별도 승인 | 아직 재시험 안 함 |

성공 후 대상별 재개 순서와 산출물:

- #571 Engineering: #573 main 반영 AND #486 성공 AND PM 확인. 기존 담당/열린 PR/active 재조회 후 기존 구현이 있으면 검토·통합한다. 없을 때만 담당 팀장이 규칙 기반 dispatcher의 focused Draft PR을 만든다. #574 준비 문서를 구현 완료로 세지 않는다.
- #560 Engineering: 기존 실패 run 이후 자체 점검이 다른 세션에서 완료됐는지 먼저 확인한다. 남은 최신 main 핵심 흐름 점검만 수행하고 원 이슈에 근거 보고한다. #486 성공을 #560 자체 점검 완료로 대체하지 않는다.
- #562 QA/Security: #486 성공과 각 부서의 자체 점검 근거를 확인한 뒤 독립 재검증한다. #558/#559/#561의 기존 담당을 재배정하거나 작업을 중복하지 않는다.
- #563 Release: 필요한 부서/QA 보고와 최신 배포·DB·Edge 상태를 읽기 전용으로 확인한다. Production 반영은 별도 사용자 승인 대상이며 Go/Hold는 PM이 판정한다.
- #557/#553 PM: 담당 보고를 취합해 누락·충돌·완료를 판정한다. 기존 #448 active, #492/#552 handoff, 다른 원인으로 blocked인 #475는 자동 일괄 해제 대상이 아니다. 실제 workflow 수락 및 후속 산출물 링크가 생긴 때만 인계 성과로 기록한다.

**완료 판정 요청: blocked 유지.** 준비 문서 PR을 구현 PR로 대체 집계하지 않는다. 구현 PR, 검증 결과, 실제 후속 자동 인계 증거, 잔여 제한이 모두 있어야 완료 후보가 된다. 이번 점검으로 전체 이슈 정규화나 자동 인계가 완료된 것은 아니다.
