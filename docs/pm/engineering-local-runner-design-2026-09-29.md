# Engineering 로컬 Claude 실행기 대안 설계

책임: Engineering 팀장. 실행 담당 후보: Release/운영의 전용 Windows runner + Claude CLI. PM: 배정·결과 판정. 원 작업: [#571](https://github.com/orrysheaven-netizen/onepick/issues/571), 산출물: [#574](https://github.com/orrysheaven-netizen/onepick/pull/574). 상태: **설계 완료 후보 / 구현·설치·E2E 미실행 / blocked 유지**.

2026-09-29 확인 기준 main: `3cefe1ae241c6e5c02b9e12539a4aa33bcfca5b3`. 기존 준비 커밋을 보존하고 독립 worktree에 main을 merge했다. 이 문서는 승인 요청용 설계이며 서비스 실행 명세가 이미 배포됐다는 뜻이 아니다. [착수 감사](engineering-handoff-readiness-2026-09-29.md), [23건 이슈 스냅샷](engineering-handoff-open-issues-2026-09-29.md)을 보완한다.

## 1. 추천안과 확인된 사실

**추천: 단일 전용 Windows 호스트에서 신뢰된 main의 결정적 dispatcher와 공식 Claude CLI를 분리하고, 한 작업씩 실행한다.** 최초 검증은 전용 계정의 대화형 세션에서 감독하에 하고, 같은 계정의 서비스 세션에서 인증·재부팅 복구를 검증한 뒤에만 상시 운영 후보로 본다. 기존 개인 계정의 자격 증명을 서비스 계정에 복사하지 않는다. runner 등록 자체는 검증 완료가 아니다.

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
| 신뢰 검증 | repository ID, 허용 event/action, actor ID와 권한, main workflow SHA를 API로 검증. owner 승인 계약 또는 지정 App의 증거만 사용 | 댓글의 PM 표제/author 표시/COMPLETE 문자열만으로 권한 부여 금지. PR head의 workflow·스크립트 실행 금지 |
| 영속 수신함 | 후보 source ID와 입력 hash를 GitHub의 기계용 queue에 기록. #567 계약을 검토·재사용하며 별도 중복 queue 구현 금지 | #567은 아직 미병합. 실패한 쓰기는 처리 완료로 기록하지 않음. 입력 크기 제한·pagination 필수 |
| 현재 상태 평가 | 작업 메타데이터, 복수 dependency AND, 최신 head CI·독립 리뷰·승인, open/blocked/active, 기존 산출물 확인 | unknown/순환/다시 열린 선행/취소/승인 철회이면 보류. closed나 녹색 workflow만으로 완료 판정 금지 |
| 실행권 확보 | 전용 호스트 한 대, controller 한 개. 로컬 영속 journal에 unique task+approval+attempt 키, 트랜잭션 claim, lease와 fencing generation | GitHub 라벨/댓글은 lock이 아님. 다른 runner나 기존 hosted 경로와 동시에 소비하지 않게 이관 승인 필요 |
| 실행 호출 | 승인된 작업과 snapshot hash를 파일로 전달하고 Claude CLI 1회 호출. credential 경로·버전·모델·tool 권한 사전검증 | 큐 정렬·라벨·승인 판정에는 모델 호출 없음. API fallback·무제한 재호출 없음 |
| 결과 검증 | exit code와 구조화 결과, 실제 산출물 diff/CI/리뷰, exact head, 금지 파일·동작 검사 | COMPLETE는 필요 증거 중 하나일 뿐. 모델이 자기 실행 예산·정책을 바꾸지 못함 |
| 보고 및 후속 | 원 이슈에 receipt 게시 → PM 판정/승인 gate → 다음 책임 팀장 inbox에 outbox 전달 → 수락 receipt | 게시 성공과 후속 실행 수락/완료를 각각 기록. bridge 없는 대상은 전달 대기 |

GitHub Actions 자체 전달 채널을 이용하며 별도 webhook을 나중에 추가한다면 HMAC signature, delivery ID, replay window 검증이 추가로 필요하다. 현재 GitHub App/권한을 재사용할 수 있는지는 운영 검토 대상이며 신규 권한을 가정하지 않는다.

## 3. 작업 계약·큐·복구

모든 실행 작업 문서에는 원 이슈를 연결한다. task/reference/dashboard를 구분해 참조 문서를 실행 대상으로 삼지 않는다. 최소 필드: `task_issue`, `department`, `responsible_lead`, `executor`, `state`, `depends_on[]`(요구 상태와 정확한 SHA/증거), `approval_ref`(대상·행위·횟수·유효기간), `deliverables[]`, `next_lead`, `source_id`, `attempt_id`. 필드 누락은 unknown/blocked다. 기존 23건 표는 감사 목록이며 전체 문서·열린 이슈 정규화 완료가 아니다. 일괄 본문 수정은 담당 확인 후 별도 구현 범위로 남는다.

제안 상태: received → pending → eligible → claimed → running → verifying → pm-review → handoff-pending → accepted → complete. blocked/approval-wait/failed/cancelled/unknown-outcome는 별도 상태다. 실행 라벨은 eligible 판정과 단일 claim 확보 후에만 붙인다. dispatch 직전 및 결과 반영 직전에 현재 상태·승인·head를 재조회한다.

- 중복: transport ID는 run ID+event identity, 의미상 키는 task+source revision+승인 범위. 재배달/run 재실행에서도 같은 model attempt를 재사용해 중복 호출하지 않는다. API로 이미 존재하는 댓글/PR을 조회한 뒤 outbox만 복구한다.
- 복수 선행: dependency별 CI/리뷰/병합/PM 요구 조건의 AND. head 변경 시 해당 증거만 무효화, active 작업에 새 이벤트가 오면 pending에 보존. blocked 해제 이벤트는 재평가 신호이며 승인 대체가 아니다.
- 동시성: controller가 GitHub concurrency pending 슬롯을 queue로 사용하지 않는다. 취소·pending 교체로 wakeup이 유실돼도 영속 입력에서 drain 가능해야 한다. #567의 수신함 기록 경합을 먼저 해결한다. 기록 전 유실은 startup/운영 복구 시 GitHub 이벤트와 변경 시각 watermark를 대조한다. 주기적 복구가 필요하면 모델 없는 저빈도 reconciliation 주기/비용을 별도 승인받으며 현재 cron을 추가하지 않는다.
- 잠금: 모델 시작 직전 journal에 attempt-start를 fsync/commit한 뒤 프로세스를 띄운다. 해당 사이에 crash면 자동 재호출하지 않고 unknown-outcome. lease 만료만으로 다른 프로세스가 재실행하지 않는다. 이전 PID/process tree 종료와 receipt 대조 후 운영자가 복구 판정한다. 두 번째 호스트는 초기 범위에서 금지한다.
- 재시도 제안: 모델 시작 전 읽기 API의 일시 오류만 최대 3회(5/15/45초, Retry-After가 더 길면 pending 보류). 쓰기 응답 유실은 식별자로 결과부터 대조. 모델 호출은 승인된 횟수 내 1회, 실패·timeout·사용량 제한이면 중단. 이 수치는 설계안이며 기존 4회 guard를 변경하지 않는다.
- 취소/재시작: 승인 철회·issue close·운영 중지는 pending 동결 및 실행 자식 프로세스 트리 종료 요청. 이미 발생한 외부 쓰기를 자동 되돌리지 않고 receipt로 보고한다. 재부팅 후 running을 자동 재호출하지 않으며 journal/원격 산출물 조정부터 수행한다. journal 손상·디스크 부족·권한 오류는 전체 실행 차단.
- 중간 완료: 코드 생성 후 테스트/리뷰 전은 review 상태다. 필수 체크 이름 및 현행 path skip 정책을 보존하고 skip을 테스트 통과로 꾸미지 않는다. main merge·Production·DB apply는 사용자 승인 없이는 실행하지 않는다.

## 4. Windows 운영과 자격 증명

전용 비관리자 OS 계정·전용 checkout·controller journal을 사용한다. 개인 primary checkout, 브라우저 프로필, 동기화 폴더, SSH 키, Production 자격 증명을 연결하지 않는다. 계정 분리는 최소 조건이며 같은 계정의 임의 코드 실행을 격리하는 sandbox는 아니다. 향후 코드 실행에는 별도 VM/제한된 작업 환경과 credential 보유 프로세스의 경계 검토가 필요하다. 첫 승인 시험은 도구 없는 읽기 전용 범위로 한정한다.

Windows 로그인과 서비스 세션은 별개의 검증 대상이다. 공식 CLI 문서는 Windows 자격 증명이 사용자 프로필의 `.claude/.credentials.json` 및 프로필 ACL에 의존하고 `CLAUDE_CONFIG_DIR`로 위치가 바뀐다고 설명한다. **이번에는 해당 파일을 열거나 복사하지 않았다.** 실제 서비스의 계정 SID/USERPROFILE/설정 디렉터리·파일 접근권·프록시/네트워크·CLI 경로를 확인한 뒤, 동일 계정에서 사용자 주도로 공식 로그인한다. 현재 orrys 계정 로그인이나 Desktop/Web 세션을 서비스 계정에 사용할 수 있다고 가정하지 않는다. 토큰을 명령줄·queue·GitHub 댓글·artifact·로그에 넣지 않는다. [Claude 인증 문서](https://code.claude.com/docs/en/authentication).

실행 preflight는 인증 메타데이터만 허용 목록으로 추출한다. API key/auth token/base URL/provider env뿐 아니라 user/project/managed 설정의 apiKeyHelper, Console 로그인, hooks/MCP 및 외부 provider 경로를 확인해 유료 경로나 예기치 않은 도구가 있으면 거부한다. 값이나 전체 설정을 출력하지 않는다. `--allowedTools`만으로 보안 sandbox를 구성했다고 주장하지 않는다. 검증된 공식 CLI 직접 호출만 허용하며 OAuth를 자체 HTTP 클라이언트/API 프록시로 변환하지 않는다.

서비스 자격 증명의 refresh·만료·재부팅 후 사용 가능 여부는 미확정이다. 인증 실패면 운영자 재로그인 대기; 토큰 자동 추출/복사나 새 API 키 생성은 없다. 서비스 세션의 읽기 전용 auth-status 검사도 별도 계정/서비스 준비 승인 후 실시한다. [Windows runner 서비스 공식 절차](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application?platform=windows)는 등록/구성 단계에서 서비스 선택을 요구하므로 계정과 실행 모드를 먼저 확정한다.

| 운영 조건 | 제안 정책 / 아직 확인할 항목 |
| --- | --- |
| 전원·절전 | 작업 중 절전 방지, AC 전원, 운영 시간 지정. 현재 호스트 전원 정책은 확인·변경하지 않음. 잠들거나 꺼진 동안 즉시 인계를 보장하지 않음 |
| 재부팅·업데이트 | drain 후 정지, journal 보존, startup reconciliation. runner/CLI 버전 변경 시 인증 메타데이터와 승인 시험 기준 재확인 |
| 자원 | 동시 모델 1개, 작업 제한시간 제안 20분, 디스크/네트워크 이상은 claim 금지. runner offline이면 pending과 지연 보고 |
| 접근 | PRIVATE 저장소임을 확인했지만 fork/비신뢰 PR도 위험. PR head checkout·install scripts·PR 제공 actions를 자격 증명 보유 호스트에서 실행 금지 |
| 권한 | 수신/평가 contents/issues/PR/checks/actions read; 보고 issues write; 코드 push/PR write는 별도 구현 단계에만 최소 허용. secrets/admin/Production 권한 불필요 |
| 지속성 | journal·receipt는 작업 checkout 밖 ACL 제한 경로. 비밀 없는 감사 기록만 원 이슈에 게시. credential/전체 모델 로그 backup 및 artifact 업로드 금지 |
| 종료 | 신규 수신 중단→자식 종료 확인→outbox 정리→서비스 중지. 등록 해제/계정 삭제는 필요한 receipt 보존 후 별도 운영 절차 |

GitHub는 self-hosted runner에서 비신뢰 코드가 지속적인 침해를 일으킬 수 있고 private 저장소도 예외가 아니라고 설명한다. runner label은 권한 경계가 아니며, 저장소/runner group/workflow 접근 제한을 실제 플랜에서 강제할 수 있는지 확인해야 한다. 불가능하면 등록 보류 또는 별도 격리 host/control 저장소의 추가 승인이 필요하다. [GitHub 보안 문서](https://docs.github.com/en/actions/reference/security/secure-use).

## 5. 비용·한도 — 2026-09-29 공식 자료 확인

| 항목 | 확인된 정책 | 이 환경에서 남은 확인 |
| --- | --- | --- |
| Claude 구독 | Pro/Max에서 Claude Code 사용 가능, Claude와 사용량 공유. API key 경로는 별도 청구 | 현재 Max 확인만 있음. 정확한 tier/잔여량·reset 시각·무인 서비스 실행에서의 동일 계정 사용은 미검증 |
| 한도 초과 | 사용 크레딧 기능을 켜면 구독 한도 이후 유료 사용 가능 | extra usage/credits·자동 충전 설정 미확인. OAuth라는 이유만으로 추가 과금 없음 보장 불가 |
| GitHub self-hosted | 현재 billing 문서는 self-hosted runner Actions 사용을 무료로 명시 | 설치 시 재확인. 전기·장비·운영시간 비용은 별도이며 총비용 0으로 표현하지 않음 |
| GitHub-hosted/저장소 | private 저장소 hosted 분량·artifact/cache 초과는 과금 가능 | 계정 플랜/잔여 allowance/예산 미확인. 새 hosted wakeup·artifact 보관 비용도 승인 범위에서 검토 |

근거: [Claude 구독 사용](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan), [사용 크레딧](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans), [GitHub billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). 과거 self-hosted 분당 과금 발표만으로 현재 요율을 단정하지 않는다.

정책: 새 구독·유료 API·자동 유료 fallback·자동 충전 금지. 계정의 추가 유료 사용이 꺼졌다는 확인 없이는 모델 시험을 시작하지 않는다. 설정 변경이 필요하면 별도 승인받는다. 한도 소진 시 pending/blocked 및 다음 reset 이후 운영 판단; 다른 provider로 전환하지 않는다. CLI cost 출력이나 이번 실패의 cost=0은 계정 청구서 검증이 아니다.

## 6. 실제 팀장 인계와 bridge의 한계

현재 GitHub workflow는 GitHub 댓글·라벨을 변경할 뿐, PM-2 또는 다른 ChatGPT 대화를 자동 시작하는 bridge가 확인되지 않았다. 이 대화에서 가능한 앱의 thread 메시지 도구가 Windows runner의 사용 가능한 API라는 뜻도 아니다. 브라우저 자동 로그인·UI 클릭으로 이를 대신하지 않는다.

최소안은 `responsible_lead`와 `executor`를 분리해 다음 부서의 영속 inbox/원 이슈에 outbox를 게시하고, 팀장이 수락하거나 승인된 executor가 그 팀장의 위임 범위 내 작업을 시작한 receipt를 남기는 것이다. GitHub 게시만 되면 handoff-pending이며 accepted/complete가 아니다. PM이 직접 구현하는 구조로 바꾸지 않는다.

ChatGPT 대화까지 자동 깨우기가 필수이면 공식적으로 사용 가능한 연결 수단·지원 여부·수신 권한·대상 thread ID 매핑·중복 방지·수락 callback을 별도 조사/승인해야 한다. **bridge가 없는 현재 추천안은 실행기 자동화 후보이지, 팀장방 전체 자동 진행 요구의 완성안이 아니다.** 연결이 없으면 실제 인계 증거를 확보할 수 없어 최종 완료를 보류한다. 이미 승인된 후속 작업은 조건 충족 후 자동 후보가 될 수 있지만 PM 판정이 요구된 단계는 승인 대기로 남긴다.

## 7. #486 한도 보존과 단계별 승인 대상

#486은 4/4 실패로 종료된 시험 기록으로 보존하고 blocked를 해제하지 않는다. 기존 marker 삭제·수정, rerun, 새 smoke 티켓, 다른 이슈로 같은 테스트 우회 금지. 대안 경로도 새 승인 없이는 모델 호출 0회다. 향후 사용자가 명시적으로 별도 시험을 승인하면 같은 #486에 `alternative-validation` 기록을 추가하되 기존 counter와 분리해 승인 URL·경로·환경·시험 ID·허용 횟수·만료 시각·결과를 남긴다. 이 별도 예산은 사용자 예외 승인 자체를 근거로 하며 4/4를 0으로 되돌리지 않는다. 기존 handoff 라벨을 붙여 hosted workflow를 재가동하지 않는다.

| 순서 | 최종 승인받을 구체 행위 | 영향 / 통과 조건 |
| --- | --- | --- |
| A | 제안 아키텍처·전용 host/계정·운영 시간·추가 과금 차단 방침 선택 | 이 설계 PR의 수락이며 설치/실행 허가와 구분. bridge 미완성을 명시적으로 수용하거나 선행 과제로 지정 |
| B | 버전 고정 runner/CLI 설치, 전용 계정·폴더/ACL 생성, 해당 repo runner 등록 | 로컬 디스크·OS 계정·GitHub 관리 상태 변경. runner 토큰을 로그에 노출하지 않고 최소 scope/접근 통제 검증 |
| C | 전용 계정의 기존 구독 로그인·credential 연결, 필요한 최소 GitHub 권한 부여 | 사용자 주도 인증; 기존 계정의 파일 복사 금지. 유료 사용 설정은 확인 후 필요한 변경만 별도 승인 |
| D | 승인된 dispatcher/worker 구현 PR 검토·병합 및 기존 소비자와의 단일 실행 경로 전환 | 반대 AI 독립 리뷰·정적/경합 검증·정확한 head 승인. #567 재사용 및 보호 파일 보강. 현재 문서 PR은 이 구현이 아님 |
| E | 먼저 감독하의 전용 사용자 세션 시험 1회, 성공 후 별도 승인된 서비스 세션 시험 1회 | 각각 실제 모델 호출/구독량 사용. 실패 즉시 정지. #486 alternative 기록에 개별 승인/attempt 연결. 지금 두 회차를 승인받은 것으로 간주하지 않음 |
| F | Windows 서비스 지속 실행, startup·전원 정책 변경, 재부팅/취소 복구 시험 | 백그라운드 실행·전력·네트워크·자원 사용. 재부팅 후 모델 재호출은 별도 예산 필요. 인증검사만 성공해도 E2E 통과 아님 |
| G | 후속 담당 bridge 및 자동 인계 시험 대상·권한·횟수 승인 | 실제 대상 팀장 수락 receipt 필요. 실패/미지원이면 handoff-pending. main/Production 변경은 이 승인에 포함하지 않음 |

각 요청에는 host ID, 계정, 버전, 정확한 구현 head, 대상 작업, 권한, 모델, 호출 상한, 제한시간, 실패 시 중지, 유효기간을 채워 검토 가능하게 만든다. 현재 미정 값을 임의로 확정하거나 사용자의 일반적인 진행 답변을 모든 단계의 일괄 승인으로 확대하지 않는다. 등록/서비스 조작/모델 시험을 지금 수행하지 않았다.

## 8. 검증과 완료 기준

설계 정적 검증: 상대 링크 존재, 기존 이슈 23건 중복 없음, main 대비 변경이 문서로 한정, stale #573/#486 실행 지시를 역사 기록으로 명확히 구분, 요구사항 8개와 각 절의 대응을 확인한다. YAML/actionlint·단위/통합 테스트는 실행 코드가 없어 이번 검증 대상이 아니다. M/L·보안 민감 구현은 향후 반대 AI 독립 리뷰가 필요하며 이번 설계를 Claude가 리뷰했다고 주장하지 않는다.

후속 구현의 필수 mock 시험: 두 dependency의 AND/하나 실패, stale review/head, 위조 owner/marker, active/blocked/closed, 동시 중복 배달, page 100 초과, 입력 저장 전 crash, claim 후 프로세스 시작 전 crash, outbox 쓰기 응답 유실, 취소·재부팅·오래된 lease, 인증 만료·유료 env·추가 사용 설정 미확인, bridge 수락 실패. 각 경우 모델 호출 횟수와 상태/복구 근거를 assert한다.

E2E 완료는 승인 범위 안의 실제 Claude process 성공 + is_error=false + exact COMPLETE + 목표 산출물 검증 + 관련 CI/독립 리뷰 + PM 보고/필요 판정 + 모든 후속 조건 재검증 + 다음 담당에게 실제 전달·수락·작업 시작 증거를 모두 요구한다. run 녹색·댓글·라벨·서비스 등록만으로 완료 처리하지 않는다. 시험 fixture의 산출물과 실서비스 구현 산출물도 구분한다.

현재 산출물은 #574의 설계 문서다. #486/#571 blocked 유지, 실제 자동 인계 완료는 보류. PM에는 추천안 수락 여부와 A–G의 범위를 판정 요청하며, Engineering이 구현·검증 책임을 유지한다.

### 이번 문서 검증 기록

상대 링크 6개가 모두 존재하고, inventory의 원 이슈 23개가 중복 없이 유지됨을 확인했다. 요구사항 대응: 모델 없는 제어(2–3절), 서비스 인증(4절), Windows 운영/보안/복구(3–4절), 4/4 보존(7절), 실패/성공 근거 구분(1절), 비용/한도(5절), 승인 단계(7절), 실제 인계·bridge·성공 기준(6·8절). 실행 코드 변경·모델 호출·신규 이슈/PR 생성은 없다. 이 기록은 정적 문서 검증이며 E2E·독립 보안 리뷰 통과를 뜻하지 않는다.
