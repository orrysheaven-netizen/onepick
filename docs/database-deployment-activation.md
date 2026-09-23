# 별도 DB 승인 절차 활성화 준비

2026-09-23 설정 재확인 기준입니다. PR #245의 새 승인 절차는 아직 비활성이고,
운영 DB와 계정 연결은 변경하지 않았습니다.

## 현재 확인한 상태

| 항목 | 확인 결과 | 남은 작업 |
| --- | --- | --- |
| 사람 승인 계정 | `orrysheaven-netizen` / 사용자 ID `329510562` | 사람 승인용으로 유지 |
| 현재 자동화 연결 | CLI와 GitHub 커넥터 모두 위와 같은 계정 | 다른 실행 주체로 전환 |
| main 보호 | 필수 CI 3개, 최신 main 반영, 관리자 우회 금지 | 사람 필수 승인 수가 0명이므로 전환 후 1명 필요 |
| Production 환경 | branch `main`만 허용 | 설정 유지 |
| Production 시크릿 | 비어 있음 | 원본을 안전하게 재등록한 뒤 저장소 복사본 제거 |
| 저장소 시크릿 | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | 환경 이관 검증 후 제거 |
| 승인 기록 DB | PR에 마이그레이션과 테스트 준비 | 사람이 검토한 전체 초기 목록으로 정상 설치 |

`orrysheaven-netizen`을 자동화 계정명으로 다시 입력해도 계정 분리는 이루어지지
않습니다. 사용자가 기존 자동화 계정으로 알려준 이름도 이 계정이었습니다.

## 자동화용 비공개 GitHub App 설정안

[GitHub App 생성 화면](https://github.com/settings/apps/new)에서 다음 설정을
검토합니다. 이 문서가 App을 생성하거나 설치한 것은 아닙니다.

| 설정 | 값 |
| --- | --- |
| 이름 제안 | `onepick-deployment-automation` (중복이면 소유자 식별자를 붙임) |
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
아직 확인되지 않은 ID나 임의 숫자를 `automationActorId`에 넣지 않습니다.

## 전환 순서

1. App을 생성·설치하고 위 권한과 단일 저장소 범위를 확인합니다.
2. 자동화 실행 환경이 App installation token을 사용하도록 전환합니다. 소유자
   명의 토큰을 쓰는 App user authentication은 계정 분리가 아닙니다.
3. 이 에이전트에서 소유자 계정의 CLI·커넥터 쓰기 연결을 제거하거나 전환합니다.
   App 연결을 추가했더라도 기존 소유자 자격 증명으로 승인 댓글을 쓸 수 있으면
   분리가 끝난 것이 아닙니다. 다른 작업의 연결을 끊지 않도록 사용자가 전환 범위를 확인합니다.
4. DB 시크릿을 쓰지 않는 시험 실행과 재실행에서 실제 실행 계정 ID를 확인합니다.
5. App이 작성한 PR을 사람이 승인할 수 있는 경로를 만듭니다. 현재 #245는 소유자
   명의로 작성돼 소유자가 직접 승인할 수 없습니다. 별도 실제 사람 검토자를
   추가하거나, 같은 변경을 자동화 명의의 후속 PR로 옮기고 기존 PR에 연결합니다.
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
