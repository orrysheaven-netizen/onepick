# Engineering 로컬 Claude 실행기 대안 설계

책임: Engineering 팀장. 실행 담당 후보: Release/운영의 Windows queue controller + 별도 Claude worker. PM: 배정·결과 판정. 원 작업: [#571](https://github.com/orrysheaven-netizen/onepick/issues/571), 산출물: [#574](https://github.com/orrysheaven-netizen/onepick/pull/574). 상태: **QA 지적 보완 / 재검토 대기 / 구현·설치·E2E 미실행 / blocked 유지**.

2026-09-29 확인 기준 main: `3cefe1ae241c6e5c02b9e12539a4aa33bcfca5b3`. 기존 준비 커밋을 보존하고 독립 worktree에 main을 merge했다. 이 문서는 승인 요청용 설계이며 서비스 실행 명세가 이미 배포됐다는 뜻이 아니다. [착수 감사](engineering-handoff-readiness-2026-09-29.md), [23건 이슈 스냅샷](engineering-handoff-open-issues-2026-09-29.md)을 보완한다.

## 1. 추천안과 확인된 사실

**최소 추천안: 현재 personal repository에는 GitHub Actions self-hosted runner를 등록하지 않는다.** GitHub-hosted 제어 workflow가 남긴 durable queue를 전용 로컬 controller가 제한된 GitHub 권한으로 읽고, 별도 SID의 Claude worker에 고정 형식 작업만 전달한다. controller는 Claude 자격 증명을 갖지 않고, worker는 GitHub 자격 증명을 갖지 않는다. 첫 범위는 도구 없는 정적 검토이며 임의 코드 실행/PR head checkout은 포함하지 않는다. 조직 이전·유료 플랜·새 control 저장소를 전제하지 않는다. 이 선택은 설계 제안이며 설치/운영 승인이 아니다.

2026-09-29 API 재확인: owner.type=`User`, private=true. org/enterprise runner group의 workflow allowlist를 이 개인 저장소의 repository runner에 적용할 수 있다고 가정했던 경로를 철회한다. 고유 runner label은 보안 경계가 아니다. [공식 runner group 범위](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access), [workflow 제한](https://docs.github.com/en/enterprise-cloud%40latest/actions/how-tos/manage-runners/self-hosted-runners/manage-access). 비허용 workflow는 로컬에 job을 스케줄할 runner 자체가 없어야 하고, 위조 queue 입력도 worker의 독립 승인 검사에서 거부해야 한다.

| 항목 | GitHub-hosted 실패 경로 | 로컬에서 확인된 성공 경로 | 판단 한계 |
| --- | --- | --- | --- |
| 실행 근거 | [#486 마지막 run](https://github.com/orrysheaven-netizen/onepick/actions/runs/36576712512), 4/4 | [#573 Claude 독립 리뷰 receipt](https://github.com/orrysheaven-netizen/onepick/pull/573#pullrequestreview-5353247852) | 서로 다른 환경·버전·모델·프롬프트 |
| 실행 소프트웨어 | Action `756cc22e19660d20e8cc9496b4f242475a7f7790`, CLI 2.1.283, Ubuntu | Windows 사용자 세션 CLI 2.1.284 | Windows 서비스 계정 실행은 미검증 |
| 모델 | init `claude-sonnet-5` | 응답 `claude-sonnet-5-5` | 모델 차이를 실패 원인으로 확정할 수 없음 |
| 인증 | Actions의 기존 `CLAUDE_CODE_OAUTH_TOKEN` 입력; GitHub App token 성공 | `loggedIn=true`, `authMethod=claude.ai`, `apiProvider=firstParty`, `subscriptionType=max` | GitHub App 성공은 Claude OAuth 성공이 아님 |
| 결과 | is_error=true, 2107ms, 1 turn, modelUsage 비어 있음, COMPLETE 없음 | process 0, is_error=false, 1 turn, 53517ms, output 6671 tokens | 로컬 검토 성공을 자동 인계/서비스 성공으로 대체 불가 |
| 변경 | runner 내부 임시 브랜치 생성, 원격 브랜치/최근 PR 목록 변화 없음 | 읽기 전용 단일 모델 검토 | 마지막 run은 실패 후 finalize 성공으로 blocked 복귀 |

[#573](https://github.com/orrysheaven-netizen/onepick/pull/573)은 정확한 head 승인 후 정상 병합됐다. 문법 변경 후에도 실패했으므로 해결책으로 입증되지 않았다. [실패 보고](https://github.com/orrysheaven-netizen/onepick/issues/486#issuecomment-5891505031)가 현재 기준이다. 토큰 만료, 모델 접근, 서비스 장애 어느 것도 원인으로 확정하지 않는다. 새 모델 호출로 원인을 비교하는 일은 이번 설계 범위 밖이다.

## 2. 구성과 신뢰 경계 — 모델 없는 제어부터

| 단계 | 제안 동작 | 저장 근거 / 금지 사항 |
| --- | --- | --- |
| 이벤트 수신 | GitHub가 issues/review/check/run 이벤트를 수신. main에 고정한 workflow가 필요한 이벤트만 dispatcher 후보로 전달 | 외부 공개 webhook 서버는 초기안에서 불필요. issue 문자열을 shell 명령에 삽입하지 않음 |
| 신뢰 검증 | repository ID, event/action, actor ID/권한, main workflow SHA는 출처 증거로만 검증. 실행 승인은 별도 사용자 receipt와 대조 | 공유 owner identity나 App bot은 사용자 승인 발급자가 아님. 승인 receipt 없으면 manual gate. PR head 실행 금지 |
| 영속 수신함 | 후보 source ID와 입력 hash를 GitHub의 기계용 queue에 기록. #567 계약을 검토·재사용하며 별도 중복 queue 구현 금지 | #567은 아직 미병합. 실패한 쓰기는 처리 완료로 기록하지 않음. 입력 크기 제한·pagination 필수 |
| 현재 상태 평가 | 작업 메타데이터, 복수 dependency AND, 최신 head CI·독립 리뷰·승인, open/blocked/active, 기존 산출물 확인 | unknown/순환/다시 열린 선행/취소/승인 철회이면 보류. closed나 녹색 workflow만으로 완료 판정 금지 |
| 실행권 확보 | 전용 호스트 한 대, controller 한 개. 로컬 영속 journal에 unique task+approval+attempt 키, 트랜잭션 claim, lease와 fencing generation | GitHub 라벨/댓글은 lock이 아님. 다른 runner나 기존 hosted 경로와 동시에 소비하지 않게 이관 승인 필요 |
| 실행 호출 | 승인된 작업과 snapshot hash를 파일로 전달하고 Claude CLI 1회 호출. credential 경로·버전·모델·tool 권한 사전검증 | 큐 정렬·라벨·승인 판정에는 모델 호출 없음. API fallback·무제한 재호출 없음 |
| 결과 검증 | exit code와 구조화 결과, 실제 산출물 diff/CI/리뷰, exact head, 금지 파일·동작 검사 | COMPLETE는 필요 증거 중 하나일 뿐. 모델이 자기 실행 예산·정책을 바꾸지 못함 |
| 보고 및 후속 | 원 이슈에 receipt 게시 → PM 판정/승인 gate → 다음 책임 팀장 inbox에 outbox 전달 → 수락 receipt | 게시 성공과 후속 실행 수락/완료를 각각 기록. bridge 없는 대상은 전달 대기 |

GitHub Actions 자체 전달 채널을 이용하며 별도 webhook을 나중에 추가한다면 HMAC signature, delivery ID, replay window 검증이 추가로 필요하다. 현재 GitHub App/권한을 재사용할 수 있는지는 운영 검토 대상이며 신규 권한을 가정하지 않는다.

로컬 controller는 Actions job listener가 아니라 승인된 queue 소비자다. 운영 시간 내 60초 간격의 제한된 API 확인을 초기 제안으로 두며, pagination·backoff·rate limit·호스트 절전으로 지연될 수 있다. 즉시 실행 SLA를 보장하지 않는다. 이 polling/지속 실행은 설치 승인과 별개로 승인받아야 하고 현재 생성하지 않는다. payload는 repo/task/source ID, 승인 ID, 자료 hash, 결과 outbox ID만 허용한다. shell 문자열·실행파일 경로·임의 인자·환경변수·URL을 queue에서 받아 실행하지 않는다.

사용자 승인 receipt 최소 계약: 사용자 원문 출처/확인 시각, repo·task·검토 SHA와 payload hash, 목적지, 허용 행위·모델·최대 횟수·유효기간, 비용 조건, 철회 상태. controller/모델이 자기 댓글로 이 receipt를 생성할 수 없다. 초기안에서는 사용자가 별도 로컬 승인 절차로 등록한 manifest를 worker가 읽는다. manifest는 worker가 읽을 수 있지만 controller/worker 모두 쓰지 못하는 ACL의 위치에 두며, 설정 담당의 쓰기는 명시적 사용자 승인 후에만 허용한다. 이 수동 절차/검증기 자체도 아직 미구현이다. GitHub의 owner 댓글 또는 PM 전달만 있고 이 독립 확인이 없으면 자동 실행하지 않는다.

## 3. 작업 계약·큐·복구

모든 실행 작업 문서에는 원 이슈를 연결한다. task/reference/dashboard를 구분해 참조 문서를 실행 대상으로 삼지 않는다. 최소 필드: `task_issue`, `department`, `responsible_lead`, `executor`, `state`, `depends_on[]`(요구 상태와 정확한 SHA/증거), `approval_ref`(대상·행위·횟수·유효기간), `deliverables[]`, `next_lead`, `source_id`, `attempt_id`. 필드 누락은 unknown/blocked다. 기존 23건 표는 감사 목록이며 전체 문서·열린 이슈 정규화 완료가 아니다. 일괄 본문 수정은 담당 확인 후 별도 구현 범위로 남는다.

제안 상태: received → pending → eligible → claimed → running → verifying → pm-review → handoff-pending → accepted → complete. blocked/approval-wait/failed/cancelled/unknown-outcome는 별도 상태다. 실행 라벨은 eligible 판정과 단일 claim 확보 후에만 붙인다. dispatch 직전 및 결과 반영 직전에 현재 상태·승인·head를 재조회한다.

**구현 단계 D의 선행조건:** #567의 append-only SOURCE_ID pending 기록, 전체 페이지 재스캔, processed marker 및 쓰기 경합/이벤트 유실 방어를 보강하고 독립 재검토·병합해야 한다. 재조회 시 #567 head는 `490466f3d0ab671b0cd30caa86787e377c6f4161`, OPEN, MERGEABLE이다. 리뷰 당시 mergeable=false는 현재 값과 달라 정정하지만, merge 가능 여부가 queue 결함 해결/승인/병합의 증거는 아니다. 계약 확정 전 controller/worker 구현 착수는 차단한다. 이 PR에서 #567 코드나 다른 queue를 만들지 않는다.

- 중복: transport ID는 run ID+event identity, 의미상 키는 task+source revision+승인 범위. 재배달/run 재실행에서도 같은 model attempt를 재사용해 중복 호출하지 않는다. API로 이미 존재하는 댓글/PR을 조회한 뒤 outbox만 복구한다.
- 복수 선행: dependency별 CI/리뷰/병합/PM 요구 조건의 AND. head 변경 시 해당 증거만 무효화, active 작업에 새 이벤트가 오면 pending에 보존. blocked 해제 이벤트는 재평가 신호이며 승인 대체가 아니다.
- 동시성: controller가 GitHub concurrency pending 슬롯을 queue로 사용하지 않는다. 취소·pending 교체로 wakeup이 유실돼도 영속 입력에서 drain 가능해야 한다. #567의 수신함 기록 경합을 먼저 해결한다. 기록 전 유실은 startup/운영 복구 시 GitHub 이벤트와 변경 시각 watermark를 대조한다. 주기적 복구가 필요하면 모델 없는 저빈도 reconciliation 주기/비용을 별도 승인받으며 현재 cron을 추가하지 않는다.
- 잠금: 모델 시작 직전 journal에 attempt-start를 fsync/commit한 뒤 프로세스를 띄운다. 해당 사이에 crash면 자동 재호출하지 않고 unknown-outcome. lease 만료만으로 다른 프로세스가 재실행하지 않는다. 이전 PID/process tree 종료와 receipt 대조 후 운영자가 복구 판정한다. 두 번째 호스트는 초기 범위에서 금지한다.
- 재시도 제안: 모델 시작 전 읽기 API의 일시 오류만 최대 3회(5/15/45초, Retry-After가 더 길면 pending 보류). 쓰기 응답 유실은 식별자로 결과부터 대조. 모델 호출은 승인된 횟수 내 1회, 실패·timeout·사용량 제한이면 중단. 이 수치는 설계안이며 기존 4회 guard를 변경하지 않는다.
- 취소/재시작: 승인 철회·issue close·운영 중지는 pending 동결 및 실행 자식 프로세스 트리 종료 요청. 이미 발생한 외부 쓰기를 자동 되돌리지 않고 receipt로 보고한다. 재부팅 후 running을 자동 재호출하지 않으며 journal/원격 산출물 조정부터 수행한다. journal 손상·디스크 부족·권한 오류는 전체 실행 차단.
- 중간 완료: 코드 생성 후 테스트/리뷰 전은 review 상태다. 필수 체크 이름 및 현행 path skip 정책을 보존하고 skip을 테스트 통과로 꾸미지 않는다. main merge·Production·DB apply는 사용자 승인 없이는 실행하지 않는다.

## 4. Windows 운영과 자격 증명

전용 비관리자 OS 계정·전용 checkout·controller journal을 사용한다. 개인 primary checkout, 브라우저 프로필, 동기화 폴더, SSH 키, Production 자격 증명을 연결하지 않는다. 계정 분리는 최소 조건이며 같은 계정의 임의 코드 실행을 격리하는 sandbox는 아니다. 향후 코드 실행에는 별도 VM/제한된 작업 환경과 credential 보유 프로세스의 경계 검토가 필요하다. 첫 승인 시험은 도구 없는 읽기 전용 범위로 한정한다.

| 보안 주체 | 허용 | 차단 및 필수 negative test |
| --- | --- | --- |
| controller SID / 별도 프로필 | queue 읽기, 검증된 고정 자료 준비, journal/outbox, 좁은 GitHub 읽기·원 이슈 보고 권한 | Claude profile/config/credential 읽기 실패; worker executable/config/승인 manifest 쓰기 실패; admin/secret/Production 권한 없음 |
| Claude worker SID / 별도 프로필 | 자신의 기존 구독 CLI, 읽기 전용 입력 자료, 제한된 결과 spool | controller의 GitHub credential/journal 접근 불가; GitHub admin/secret/Production 자격 증명 없음; 임의 PR 코드·shell/도구 실행 없음 |
| 사용자 승인 경로 | 작업별 manifest의 등록·철회 | 공유 owner/App 댓글에서 manifest 자동 생성 불가; worker/controller의 위조·scope 변경·만료 승인 모두 거부 |

IPC는 SID ACL을 제한한 named pipe 또는 동등한 구조화 channel로 고정하며 입력 스키마·크기·허용 ID·hash를 양쪽에서 검사한다. worker는 승인 manifest와 횟수를 독립 검증하고 CLI 경로/인자를 고정한다. controller가 침해돼도 새 작업 승인이나 모델 호출 예산을 늘릴 수 없어야 한다. 사용자 프롬프트 자체는 비신뢰 데이터로 취급한다. worker의 credential 파일은 본인 및 필요한 OS 관리 주체만 접근하며, 숨긴 파일이나 경로 이름만으로 격리를 주장하지 않는다. 코드 실행 단계로 확장하려면 credential 없는 별도 VM/환경 설계와 별도 승인이 필요하다.

Windows 로그인과 서비스 세션은 별개의 검증 대상이다. 공식 CLI 문서는 Windows 자격 증명이 사용자 프로필의 `.claude/.credentials.json` 및 프로필 ACL에 의존하고 `CLAUDE_CONFIG_DIR`로 위치가 바뀐다고 설명한다. **이번에는 해당 파일을 열거나 복사하지 않았다.** 실제 서비스의 계정 SID/USERPROFILE/설정 디렉터리·파일 접근권·프록시/네트워크·CLI 경로를 확인한 뒤, 동일 계정에서 사용자 주도로 공식 로그인한다. 현재 orrys 계정 로그인이나 Desktop/Web 세션을 서비스 계정에 사용할 수 있다고 가정하지 않는다. 토큰을 명령줄·queue·GitHub 댓글·artifact·로그에 넣지 않는다. [Claude 인증 문서](https://code.claude.com/docs/en/authentication).

실행 preflight는 인증 메타데이터만 허용 목록으로 추출한다. API key/auth token/base URL/provider env뿐 아니라 user/project/managed 설정의 apiKeyHelper, Console 로그인, hooks/MCP 및 외부 provider 경로를 확인해 유료 경로나 예기치 않은 도구가 있으면 거부한다. 값이나 전체 설정을 출력하지 않는다. `--allowedTools`만으로 보안 sandbox를 구성했다고 주장하지 않는다. 검증된 공식 CLI 직접 호출만 허용하며 OAuth를 자체 HTTP 클라이언트/API 프록시로 변환하지 않는다.

서비스 자격 증명의 refresh·만료·재부팅 후 사용 가능 여부는 미확정이다. 인증 실패면 운영자 재로그인 대기; 토큰 자동 추출/복사나 새 API 키 생성은 없다. 같은 worker SID라도 대화형/서비스 세션은 각각 auth-status와 비용 조건을 검증한다. controller SID의 성공으로 대체하지 않는다. GitHub runner 서비스 설치 절차는 이번 선택안에 적용하지 않는다. 별도 Windows controller/worker 서비스 등록·지속 실행은 단계별 승인 대상이다.

| 운영 조건 | 제안 정책 / 아직 확인할 항목 |
| --- | --- |
| 전원·절전 | 작업 중 절전 방지, AC 전원, 운영 시간 지정. 현재 호스트 전원 정책은 확인·변경하지 않음. 잠들거나 꺼진 동안 즉시 인계를 보장하지 않음 |
| 재부팅·업데이트 | drain 후 정지, journal 보존, startup reconciliation. runner/CLI 버전 변경 시 인증 메타데이터와 승인 시험 기준 재확인 |
| 자원 | 동시 모델 1개, 작업 제한시간 제안 20분, 디스크/네트워크 이상은 claim 금지. runner offline이면 pending과 지연 보고 |
| 접근 | PRIVATE 저장소임을 확인했지만 fork/비신뢰 PR도 위험. PR head checkout·install scripts·PR 제공 actions를 자격 증명 보유 호스트에서 실행 금지 |
| 권한 | 수신/평가 contents/issues/PR/checks/actions read; 보고 issues write; 코드 push/PR write는 별도 구현 단계에만 최소 허용. secrets/admin/Production 권한 불필요 |
| 지속성 | journal·receipt는 작업 checkout 밖 ACL 제한 경로. 비밀 없는 감사 기록만 원 이슈에 게시. credential/전체 모델 로그 backup 및 artifact 업로드 금지 |
| 종료 | 신규 수신 중단→자식 종료 확인→outbox 정리→서비스 중지. 등록 해제/계정 삭제는 필요한 receipt 보존 후 별도 운영 절차 |

GitHub는 self-hosted runner에서 비신뢰 코드가 지속적인 침해를 일으킬 수 있고 private 저장소도 예외가 아니라고 설명한다. 이 때문에 현재 개인 저장소 runner 등록을 선택안에서 제외한다. 향후 org/control-repo 대안을 다시 선택하려면 플랜·workflow allowlist 강제 가능 여부와 비용을 별도로 검증·승인받는다. [GitHub 보안 문서](https://docs.github.com/en/actions/reference/security/secure-use).

## 5. 비용·한도 — 2026-09-29 공식 자료 확인

| 항목 | 확인된 정책 | 이 환경에서 남은 확인 |
| --- | --- | --- |
| Claude 구독 | Pro/Max에서 Claude Code 사용 가능, Claude와 사용량 공유. API key 경로는 별도 청구 | 현재 Max 확인만 있음. 정확한 tier/잔여량·reset 시각·무인 서비스 실행에서의 동일 계정 사용은 미검증 |
| 한도 초과 | 사용 크레딧 기능을 켜면 구독 한도 이후 유료 사용 가능 | 기존 사용자 계정은 추가 사용·자동 충전 OFF 사용자 확인 확보. 새 worker SID/프로필이 그 계정·설정을 실제 사용하는지는 미검증 |
| GitHub self-hosted | 현재 billing 문서는 self-hosted runner Actions 사용을 무료로 명시 | 설치 시 재확인. 전기·장비·운영시간 비용은 별도이며 총비용 0으로 표현하지 않음 |
| GitHub-hosted/저장소 | private 저장소 hosted 분량·artifact/cache 초과는 과금 가능 | 계정 플랜/잔여 allowance/예산 미확인. 새 hosted wakeup·artifact 보관 비용도 승인 범위에서 검토 |

근거: [Claude 구독 사용](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan), [사용 크레딧](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans), [GitHub billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). 과거 self-hosted 분당 과금 발표만으로 현재 요율을 단정하지 않는다.

정책: 새 구독·유료 API·자동 유료 fallback·자동 충전 금지. 계정의 추가 유료 사용이 꺼졌다는 확인 없이는 모델 시험을 시작하지 않는다. 설정 변경이 필요하면 별도 승인받는다. 한도 소진 시 pending/blocked 및 다음 reset 이후 운영 판단; 다른 provider로 전환하지 않는다. CLI cost 출력이나 이번 실패의 cost=0은 계정 청구서 검증이 아니다.

**호출 직전 hard-fail 계약:** worker SID/세션/프로필·CLI hash·모델·승인 자료 hash를 고정하고 (a) API key/Console credential/apiKeyHelper/provider/base-URL override 부재, (b) 실제 subscription 로그인, (c) 같은 구독 계정의 usage credits/추가 사용·자동 충전 OFF 사용자 확인 receipt, (d) 유효한 호출 예산/철회 없음 모두 확인해야 한다. 어느 항목이 unknown/불일치/만료면 spawn 전에 중단, 모델 호출 0회다. 사전 한도 소진 증거가 있으면 0회; 한도 상태를 사전에 알 수 없어 첫 요청이 한도/인증 오류를 반환하면 그 1회 시도만 기록하고 추가 요청 0회로 중단한다. 사후 오류를 사전 0회 호출로 꾸미지 않는다. 설정값·토큰·전체 프로필을 로그에 남기지 않는다. 기존 개인 세션 성공이나 OFF 진술을 새 worker의 실제 인증 연결 증거로 복사하지 않는다.

## 6. 실제 팀장 인계와 bridge의 한계

현재 GitHub workflow는 GitHub 댓글·라벨을 변경할 뿐, PM-2 또는 다른 ChatGPT 대화를 자동 시작하는 bridge가 확인되지 않았다. 이 대화에서 가능한 앱의 thread 메시지 도구가 Windows runner의 사용 가능한 API라는 뜻도 아니다. 브라우저 자동 로그인·UI 클릭으로 이를 대신하지 않는다.

최소안은 `responsible_lead`와 `executor`를 분리해 다음 부서의 영속 inbox/원 이슈에 outbox를 게시하고, 팀장이 수락하거나 승인된 executor가 그 팀장의 위임 범위 내 작업을 시작한 receipt를 남기는 것이다. GitHub 게시만 되면 handoff-pending이며 accepted/complete가 아니다. PM이 직접 구현하는 구조로 바꾸지 않는다.

현재 산출물 명칭은 **로컬 Claude executor 설계**로 한정한다. 원 작업의 팀장방 자동 기동까지 달성했다는 뜻이 아니다. bridge가 확인되지 않은 대상은 `handoff-pending`에 남으며, 사용자가 승인한 수동 전달 뒤 해당 팀장의 task/수락 시각/작업 시작 산출물 receipt가 있어야 accepted로 전환한다. 수동 수락은 무인 자동 bridge의 성공 증거로 집계하지 않는다.

ChatGPT 대화까지 자동 깨우기가 필수이면 공식적으로 사용 가능한 연결 수단·지원 여부·수신 권한·대상 thread ID 매핑·중복 방지·수락 callback을 별도 조사/승인해야 한다. **bridge가 없는 현재 추천안은 실행기 자동화 후보이지, 팀장방 전체 자동 진행 요구의 완성안이 아니다.** 연결이 없으면 실제 인계 증거를 확보할 수 없어 최종 완료를 보류한다. 이미 승인된 후속 작업은 조건 충족 후 자동 후보가 될 수 있지만 PM 판정이 요구된 단계는 승인 대기로 남긴다.

## 7. #486 한도 보존과 단계별 승인 대상

#486은 4/4 실패로 종료된 시험 기록으로 보존하고 blocked를 해제하지 않는다. 기존 marker 삭제·수정, rerun, 새 smoke 티켓, 다른 이슈로 같은 테스트 우회 금지. 대안 경로도 새 승인 없이는 모델 호출 0회다. 향후 사용자가 명시적으로 별도 시험을 승인하면 같은 #486에 `alternative-validation` 기록을 추가하되 기존 counter와 분리해 승인 URL·경로·환경·시험 ID·허용 횟수·만료 시각·결과를 남긴다. 이 별도 예산은 사용자 예외 승인 자체를 근거로 하며 4/4를 0으로 되돌리지 않는다. 기존 handoff 라벨을 붙여 hosted workflow를 재가동하지 않는다.

| 순서 | 최종 승인받을 구체 행위 | 영향 / 통과 조건 |
| --- | --- | --- |
| A | 제안 아키텍처·전용 host/계정·운영 시간·추가 과금 차단 방침 선택 | 이 설계 PR의 수락이며 설치/실행 허가와 구분. bridge 미완성을 명시적으로 수용하거나 선행 과제로 지정 |
| B | controller/worker 두 비관리자 SID·프로필·ACL 및 고정 CLI 준비 | 개인 repo Actions runner 등록은 제외. QA의 접근 경계 재검토 전 설치 금지. controller→worker credential 읽기 실패 등 모델 없는 negative 검증 필요 |
| C | worker의 구독 로그인, controller에만 최소 GitHub 권한 연결 | 사용자 주도 인증; 개인 credential 복사 금지. SID/세션별 hard-fail 비용 preflight. worker에는 GitHub credential 없음 |
| D | 승인된 dispatcher/worker 구현 PR 검토·병합 및 기존 소비자와의 단일 실행 경로 전환 | 반대 AI 독립 리뷰·정적/경합 검증·정확한 head 승인. #567 재사용 및 보호 파일 보강. 현재 문서 PR은 이 구현이 아님 |
| E | 모델 없는 계정/권한/비용 검사 후, 별도 승인된 worker 대화형 감독 시험 1회 | 실패 즉시 중단. #486 alternative 기록에 승인/attempt 연결. 현재 호출 승인 아님 |
| F | E 결과 검토 후 별도 서비스 준비 승인 → 서비스 auth-status/재부팅 확인(모델 없음) → 별도 승인된 서비스 모델 시험 1회 → 취소/복구 검증 | 이후에만 지속 실행·startup·전원 정책의 운영 후보. process-tree 종료 확인 전 같은 작업 재호출 금지; OS job 등 실제 종료 보장 검증 필요 |
| G | 후속 담당 bridge 및 자동 인계 시험 대상·권한·횟수 승인 | 실제 대상 팀장 수락 receipt 필요. 실패/미지원이면 handoff-pending. main/Production 변경은 이 승인에 포함하지 않음 |

각 요청에는 host ID, 계정, 버전, 정확한 구현 head, 대상 작업, 권한, 모델, 호출 상한, 제한시간, 실패 시 중지, 유효기간을 채워 검토 가능하게 만든다. 현재 미정 값을 임의로 확정하거나 사용자의 일반적인 진행 답변을 모든 단계의 일괄 승인으로 확대하지 않는다. 등록/서비스 조작/모델 시험을 지금 수행하지 않았다.

## 8. 검증과 완료 기준

설계 정적 검증: 상대 링크 존재, 기존 이슈 23건 중복 없음, main 대비 변경이 문서로 한정, stale #573/#486 실행 지시를 역사 기록으로 명확히 구분, 요구사항 8개와 각 절의 대응을 확인한다. YAML/actionlint·단위/통합 테스트는 실행 코드가 없어 이번 검증 대상이 아니다. M/L·보안 민감 구현은 향후 반대 AI 독립 리뷰가 필요하며 이번 설계를 Claude가 리뷰했다고 주장하지 않는다.

후속 구현의 필수 mock 시험: 두 dependency의 AND/하나 실패, stale review/head, 위조 owner/marker, active/blocked/closed, 동시 중복 배달, page 100 초과, 입력 저장 전 crash, claim 후 프로세스 시작 전 crash, outbox 쓰기 응답 유실, 취소·재부팅·오래된 lease, 인증 만료·유료 env·추가 사용 설정 미확인, bridge 수락 실패. 각 경우 모델 호출 횟수와 상태/복구 근거를 assert한다.

E2E 완료는 승인 범위 안의 실제 Claude process 성공 + is_error=false + exact COMPLETE + 목표 산출물 검증 + 관련 CI/독립 리뷰 + PM 보고/필요 판정 + 모든 후속 조건 재검증 + 다음 담당에게 실제 전달·수락·작업 시작 증거를 모두 요구한다. run 녹색·댓글·라벨·서비스 등록만으로 완료 처리하지 않는다. 시험 fixture의 산출물과 실서비스 구현 산출물도 구분한다.

현재 산출물은 #574의 설계 문서다. #486/#571 blocked 유지, 실제 자동 인계 완료는 보류. PM에는 추천안 수락 여부와 A–G의 범위를 판정 요청하며, Engineering이 구현·검증 책임을 유지한다.

## 9. QA 지적별 처분 및 재검토 조건

근거: [QA 독립 리뷰 @ 8ceed5cf](https://github.com/orrysheaven-netizen/onepick/pull/574#issuecomment-5891829366). 아래는 지적에 대한 문서 보완이지 negative test를 이미 통과했다는 보고가 아니다. 설치/runner 등록/서비스/자격 증명/권한 변경/모델 시험을 수행하지 않았다.

| 지적 | 처분 및 보완 근거 | 향후 검증 / 미충족 시 상태 |
| --- | --- | --- |
| High 1: 개인 repo workflow 경계 없음 | 수용. owner=User 확인, §1–2에서 Actions runner 미등록 + queue pull controller 안으로 고정. org 이전 대안은 현재 범위에서 제외 | 비허용 workflow의 로컬 job 실행 경로 없음, 악성 queue 입력으로 worker spawn 불가. 재검토 전 B 차단 |
| High 2: 같은 SID의 credential 노출 | 수용. §4 controller/worker SID·프로필·권한 분리 및 구조화 IPC, worker 독립 manifest 검증 | controller→Claude credential read 실패, worker→GitHub/Production credential 부재, 임의 path/args/env·PR payload 거부. 계정 분리만으로 sandbox 통과 주장 금지 |
| Medium 3: owner 댓글과 사용자 승인 혼동 | 수용. §2에 별도 사용자 승인 manifest/receipt 및 manual gate 명시 | 공유 owner 자동 댓글, 위조 App marker, 만료/철회/scope·hash 불일치/동일 승인 재배달에서 모델 호출 0회 |
| Medium 4: #567 queue 미완성 | 수용. §3에서 보강·독립 재검토·병합을 D의 필수 선행으로 지정. mergeable=false는 현재 MERGEABLE로 사실 갱신하되 blocker 결론 유지 | 연속 3개 이벤트, pending replacement/cancel, 동일 SOURCE_ID, 기록 전/후 crash, pagination 100+에서 유실/중복 처리 없음 |
| Medium 5: OAuth와 비용 조건 별개 | 수용. §5의 worker 세션별 hard-fail과 기존 개인 OFF 확인의 적용 한계 명시 | API key·Console/provider 주입, 추가 사용/자동충전 receipt 부재, 알려진 한도 소진은 호출 0회. 실행 중 한도 오류는 후속 호출 0회 |
| Medium 6: 팀장 bridge 부재 | 수용. §6 산출물은 local executor 설계로 제한. 수동 전달과 무인 bridge를 구분 | 실제 수락/시작 receipt 없으면 handoff-pending; 공식 bridge 증거 전 #571 완료 불가 |

잠금/복구 보강도 수용한다. claim 뒤/프로세스 spawn 직전/실행 중 controller crash, lease 만료+이전 PID 생존, 취소/승인 철회 중 자식 존재, 재부팅 running 기록, outbox 응답 유실을 mock 및 승인된 OS 시험으로 검증해야 한다. 자식 프로세스 트리 종료 증거 없이는 재호출하지 않는다. §7 F의 감독 시험→별도 서비스 준비/무모델 확인→별도 서비스 시험→지속 운영 후보 순서를 유지한다.

**재검토 요청:** 문서상 High 2건과 Medium 4건을 반영했는지 QA가 확인해야 한다. 지적을 문서에 반영했다는 이유로 운영 blocker를 해제하지 않는다. #575 코드와 테스트는 이번 보완에서 수정하지 않았다.

### 이번 문서 검증 기록

상대 링크 6개가 모두 존재하고, inventory의 원 이슈 23개가 중복 없이 유지됨을 확인했다. 요구사항 대응: 모델 없는 제어(2–3절), 서비스 인증(4절), Windows 운영/보안/복구(3–4절), 4/4 보존(7절), 실패/성공 근거 구분(1절), 비용/한도(5절), 승인 단계(7절), 실제 인계·bridge·성공 기준(6·8절). 실행 코드 변경·모델 호출·신규 이슈/PR 생성은 없다. 이 기록은 정적 문서 검증이며 E2E·독립 보안 리뷰 통과를 뜻하지 않는다.
