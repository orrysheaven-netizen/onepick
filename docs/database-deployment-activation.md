# 별도 DB 승인 절차 활성화 준비

2026-09-23 설정 재확인 기준입니다. PR #245에서 준비한 새 승인 절차는 아직
비활성입니다. 이 브랜치는 해당 구현을 최신 main에 통합해 App 명의로 검토받는
후속 PR을 위한 것입니다. 운영 DB에는 적용하지 않았습니다.

## 현재 확인한 상태

| 항목 | 확인 결과 | 남은 작업 |
| --- | --- | --- |
| 사람 승인 계정 | `orrysheaven-netizen` / 사용자 ID `329510562` | 사람 승인용으로 유지 |
| App 작업 연결 | `onepick-deployment-automation[bot]` / 사용자 ID `332931387` | App 설치 토큰으로 PR 작성·병합·실행 |
| 기존 사용자 연결 | CLI와 GitHub 커넥터에 승인자 연결이 남아 있음 | 전환 범위를 확인하고 제거·분리 |
| main 보호 | 필수 CI 3개, 최신 main 반영, 관리자 우회 금지 | 사람 필수 승인 수가 0명이므로 전환 후 1명 필요 |
| Production 환경 | branch `main`만 허용 | 설정 유지 |
| Production 시크릿 | 비어 있음 | 원본을 안전하게 재등록한 뒤 저장소 복사본 제거 |
| 저장소 시크릿 | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | 환경 이관 검증 후 제거 |
| 승인 기록 DB | PR에 마이그레이션과 테스트 준비 | 사람이 검토한 전체 초기 목록으로 정상 설치 |

`orrysheaven-netizen`을 자동화 계정명으로 다시 입력해도 계정 분리는 이루어지지
않습니다. 사용자가 기존 자동화 계정으로 알려준 이름도 이 계정이었습니다.

## 생성·설치한 자동화용 비공개 GitHub App

[App 설정](https://github.com/settings/apps/onepick-deployment-automation)에서
다음 구성을 확인했습니다. App ID는 `5046807`, 설치 ID는 `164051563`입니다.
사용자가 저장한 개인키로 인증했고, 단일 저장소로 제한한 임시 설치 토큰을
작업마다 발급해 사용 후 폐기했습니다. 비밀값은 로그·PR·저장소에 기록하지 않습니다.

| 설정 | 값 |
| --- | --- |
| 이름 | `onepick-deployment-automation` |
| Homepage URL | `https://github.com/orrysheaven-netizen/onepick` |
| 설치 가능 계정 | Only on this account |
| 설치 대상 | Only select repositories → `onepick` |
| Webhook | Active 해제; 이벤트 수신 불필요 |
| 사용자 대신 OAuth 인증 | 사용하지 않음; installation token 사용 |
| Contents | Read and write — 작업 브랜치 수정 |
| Workflows | Read and write — 워크플로 파일 수정 |
| Pull requests | Read and write — PR 작성과 갱신 |
| Actions | Read and write — 미리보기·적용 실행과 재실행 |
| Issues | Read-only — 사람 승인 댓글 조회 |
| Metadata | Read-only — 기본 조회 |
| 나머지 권한 | No access; Administration·Environments·Secrets 관리 권한 불필요 |

App의 개인 키와 설치 토큰은 안전한 자격 증명 저장소에서 관리합니다. 채팅,
PR, 로그나 저장소 파일에 넣지 않습니다. **App ID, client ID, installation ID와
봇 사용자 ID는 다릅니다.** 설정에 넣을 숫자는 `<app-slug>[bot]`의 사용자 ID이며,
비밀값 없는 시험 실행의 `actor.id`와 `triggering_actor.id`로 실제 동작을 확인합니다.
확인된 ID라도 전체 준비 조건을 충족하기 전까지 활성화 설정에 반영하지 않습니다.

## 확인한 사람 승인과 App 실행 경로

- [PR #246](https://github.com/orrysheaven-netizen/onepick/pull/246)은 App이 작성했습니다.
- 사용자가 본인 계정으로 [승인 기록](https://github.com/orrysheaven-netizen/onepick/pull/246#pullrequestreview-5291461067)을
  제출했고, 승인한 커밋 `5cadf01`과 필수 CI 성공을 확인한 뒤 App이 정상 PR 병합을 수행했습니다.
- 병합 커밋은 `d03969b3243a62938355429f86428a9bd97eb413`입니다.
- DB 비밀값을 사용하지 않는 Mobile CI의 [수동 실행](https://github.com/orrysheaven-netizen/onepick/actions/runs/35866087697)으로
  첫 시도와 [재실행](https://github.com/orrysheaven-netizen/onepick/actions/runs/35866087697/attempts/2)이 모두 성공했습니다.
  두 시도의 `actor.id`와 `triggering_actor.id`는 모두 `332931387`입니다.
- 이 증거는 App 인증 및 실행 경로 검증입니다. 기존 승인자 연결 제거,
  운영 비밀값 이관, 실제 DB 승인·적용 흐름을 대신하지 않습니다.
  `enabled`, `identitySeparated`, `humanFlowVerified` 등 준비 플래그는 false로 유지합니다.

## 전환 순서

1. App 생성·설치, 위 권한과 단일 저장소 범위 확인은 완료했습니다.
2. 이 작업의 PR 작성·병합·실행은 App installation token을 사용합니다. 소유자
   명의 토큰을 쓰는 App user authentication은 계정 분리가 아닙니다.
3. 이 에이전트에서 소유자 계정의 CLI·커넥터 쓰기 연결을 제거하거나 전환합니다.
   App 연결을 추가했더라도 기존 소유자 자격 증명으로 승인 댓글을 쓸 수 있으면
   분리가 끝난 것이 아닙니다. 다른 작업의 연결을 끊지 않도록 사용자가 전환 범위를 확인합니다.
4. DB 시크릿을 쓰지 않는 시험 실행과 재실행의 실제 계정 ID 확인은 완료했습니다.
5. App이 작성한 PR을 사람이 승인하는 경로는 #246에서 확인했습니다. #245는 소유자
   명의이므로 같은 구현을 최신 main에 통합해 App 명의의 후속 PR로 옮깁니다.
   기존 PR에 후속 링크를 남기고, 최종 활성화 전까지 Draft 상태를 유지합니다.
   후속 PR이 준비되기 전에 기존 PR을 닫거나 필수 승인 수를 올려 막지 않습니다.
6. 그 경로가 준비되면 사람 필수 승인 수를 1명으로 설정합니다. 기존 필수 CI,
   관리자 우회 금지, 오래된 승인 취소, 최신 main 요구 조건은 보존합니다.
7. 배포 비밀값은 [Production 설정](https://github.com/orrysheaven-netizen/onepick/settings/environments)에서
   원본을 안전하게 입력합니다. 등록 확인 후 저장소 범위 복사본을 제거합니다.
   GitHub에 저장된 값은 복호화해 복사할 수 없습니다. 원본이 없으면 사용 중인
   연동을 확인한 별도 교체 계획이 필요하며, DB 비밀번호를 임의 재설정하지 않습니다.
8. 읽기 전용 QA 자격 증명, 승인 기록 초기 설치, 독점적 DB 변경 시간,
   폐기 가능한 대상의 전체 적용 검증, 최종 사람 검증을 완료합니다.
9. 실제 증거를 기록한 별도 PR로 준비 조건과 자동화 ID를 갱신하고 활성화합니다.

로컬 DB의 동시성 테스트가 통과해도 원격 아티팩트·Supabase 적용·사람 승인까지
검증된 것은 아닙니다. 준비 플래그를 자동으로 켜거나 운영 승인 댓글을 대신
작성하지 않습니다.

## 근거

- [GitHub App 권한 선택](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [설치된 App으로 인증](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- [워크플로 수동 실행 API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
- [App 봇 사용자 ID 확인](https://github.com/actions/create-github-app-token#create-a-git-committer-string-for-an-app-installation)
- [자기 PR 승인 제한](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)
