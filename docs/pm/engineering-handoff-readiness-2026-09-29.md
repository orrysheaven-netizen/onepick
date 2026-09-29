# Engineering 자동 인계 착수 점검 — 2026-09-29

원래 작업: [#571](https://github.com/orrysheaven-netizen/onepick/issues/571). 책임: Engineering 팀장. PM 조정: PM-2 / #553. 상태: **blocked — 준비 자료 작성, 구현·실제 인계 미완료**.

기준 main: `eada433f0c63a547928c0387cb0cd4843d622d4b`. 최신 origin/main을 fetch한 뒤 독립 worktree에서 점검했다. 공유 primary checkout의 작업 파일은 수정하지 않았다. 이 문서는 실행 명령이나 새로운 담당 배정이 아니라 시점별 감사 기록이다. 후속 착수 시 최신 이슈·PR·head를 다시 확인한다.

## 1. 선행조건과 중복 확인

| 대상 | 확인 결과 | 다음 조건 |
| --- | --- | --- |
| #571 | open, owner:claude, state:blocked. 인계 수락·구현 PR 확인 안 됨 | #573 반영 → #486 성공 → PM 결과 확인. 실행 전 기존 담당 착수 재확인 |
| #573 | open, non-draft, head `fc4abfbdcc454720655b8f7f1cd01decf7c503b3`; 현재 head reviews 0건 | 현재 head 독립 검토 및 사용자 병합 승인 |
| #486 | blocked, bot cycle 기록 3/4, 마지막 실행 실패 | #573 병합 후 기존 한도 내 마지막 1회. marker 삭제·초기화 금지 |
| #567 | open, head `490466f3d0ab671b0cd30caa86787e377c6f4161`; PM review queue 기존 구현 있음 | 중복 구현 금지. 기존 리뷰의 이벤트 유실·runner 비용·보호 목록 지적 처리 확인 |
| #564 | #573과 같은 allowedTools 수정의 이전 PR | 새 수정 PR을 만들지 않음. #573 처리 후 기존 담당이 superseded 정리 |

열린 PR 전체 6건(#573/#567/#564/#473/#466/#464)을 확인했다. #571 dispatcher에 해당하는 열린 구현 PR은 없었다. 이것은 로컬/미게시 작업 부재의 증명은 아니므로 실제 착수 직전에 다시 확인한다. #448의 active 작업, #492/#552 인계와 UI/DB 작업은 이 감사에서 실행하지 않는다. [열린 이슈 23건의 담당·상태·선행·산출물 점검표](engineering-handoff-open-issues-2026-09-29.md)를 함께 작성했다.

### CI와 실제 실행 근거

- #573: `changes` 3개 job SUCCESS; `typecheck`, `verify-web`, `database-tests`는 각각 SKIPPED. 현재 main의 경로별 gate에서 handoff workflow만 바뀐 PR의 앱/DB heavy job을 생략한 결과다. 실제 테스트 실행 성공으로 표기하지 않는다. Vercel은 build rate limit FAILURE이며 코드 실패와 구분한다.
- #573 변경은 allowedTools 한 줄이다. #564의 이전 head 리뷰를 새 head 리뷰 완료로 대체하지 않는다. 이 변경만으로 Claude 오류가 해결된다고 단정할 수 없다.
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
- QA/독립 리뷰: #573 현재 head 검토; #567 기존 지적의 처리 여부 확인. #571 구현 후 독립 리뷰와 위 검증.
- Release/운영: 승인된 #573 main 반영 후 #486 마지막 smoke test 1회 근거 수집. 실패하면 추가 Action 재시도 없이 self-hosted Claude CLI OAuth 대안의 운영 조건부터 검토.
- PM: 선행 완료 근거를 확인하고 담당/순서 조정 및 최종 완료 판정. PM이 구현을 대신하지 않는다.
- 관리자 승인 필요: #573 등 검토가 끝난 정확한 head의 main 병합. 현재는 검토 미완료이므로 병합 승인 요청 단계가 아니다.
- 관리자 직접 수행 필요: 현재 새로 확정된 항목 없음. OAuth secret 재교체 필요 여부는 실패 원인 분리 후 판단하며 비밀값을 요청/출력하지 않는다.

**완료 판정 요청: blocked 유지.** 준비 문서 PR을 구현 PR로 대체 집계하지 않는다. 구현 PR, 검증 결과, 실제 후속 자동 인계 증거, 잔여 제한이 모두 있어야 완료 후보가 된다. 이번 점검으로 전체 이슈 정규화나 자동 인계가 완료된 것은 아니다.
