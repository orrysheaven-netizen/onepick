# GPT ↔ Claude 자동 인계 실행기

결정일: 2026-09-27.

이 문서는 GitHub Issue의 `handoff:codex` / `handoff:claude` 라벨을 실제 AI 실행으로 연결하는 OnePick 자동 인계 기능의 설정과 안전장치를 설명한다.

## 기본 상태

자동 인계는 **기본 OFF**다.

`ONEPICK_AI_HANDOFF_ENABLED=true`가 아니면 두 workflow 모두 AI를 호출하지 않는다. 따라서 workflow 파일이 main에 있어도 변수 활성화 전에는 OpenAI/Claude 호출 비용이나 사용량이 발생하지 않는다.

자동 실행 범위는 다음까지만 허용한다.

1. 인계 Issue 수락
2. 코드/문서 작업
3. 새 브랜치와 PR 준비
4. 필수 CI 실행
5. 필요한 경우 반대 AI에게 독립 리뷰 인계

다음은 자동화하지 않는다.

- `main` merge
- Production DB `mode=apply`
- production Edge Function deploy
- GitHub repository/environment secret 변경
- repository 권한·branch protection 변경
- 파괴적인 production 데이터 작업

## 필요한 GitHub App

기존 Claude reviewer App의 권한은 확대하지 않는다. 별도의 GitHub App을 사용한다.

권장 이름:

`OnePick AI Handoff`

설치 범위:

`orrysheaven-netizen/onepick` 하나만 선택한다.

Repository permissions:

| 권한 | 값 |
| --- | --- |
| Contents | Read & write |
| Issues | Read & write |
| Pull requests | Read & write |
| Actions | Read |
| Checks | Read |
| Commit statuses | Read |
| Metadata | Read |

Administration, Secrets, Environments 권한은 주지 않는다.

## GitHub Actions Variables

Repository → Settings → Secrets and variables → Actions → Variables:

| 이름 | 값 |
| --- | --- |
| `AI_HANDOFF_APP_CLIENT_ID` | 새 GitHub App의 Client ID |
| `ONEPICK_AI_HANDOFF_ENABLED` | 실제 AI 모델 runner master switch. 처음에는 `false` |
| `ONEPICK_PM_ROUTING_ENABLED` | PM queue·review-events routing 비상정지. 미설정 기본 ON, 중단 시 `false` |
| `ONEPICK_CI_HANDOFF_GATE_ENABLED` | CI 완료 기반 자동 인계. GitHub Actions 고정 사용량 절감을 위해 미설정 기본 OFF, 필요할 때만 `true` |
| `ONEPICK_CLAUDE_ACTION_ENABLED` | Claude GitHub Action 사용 시 `true`; 처음에는 `false` |
| `ONEPICK_CLAUDE_GITHUB_ACTION_ENABLED` | Claude GitHub Action 실행 추가 opt-in. 미설정 기본 OFF |
| `ONEPICK_CODEX_ACTION_ENABLED` | 유료 OpenAI API 기반 Codex Action 사용 시만 `true`; 기본 `false` |

## GitHub Actions Secrets

Repository → Settings → Secrets and variables → Actions → Secrets:

| 이름 | 용도 |
| --- | --- |
| `AI_HANDOFF_APP_PRIVATE_KEY` | 새 GitHub App의 private key 전체 내용 |
| `CLAUDE_CODE_OAUTH_TOKEN` | `anthropics/claude-code-action` 인증 |
| `OPENAI_API_KEY` | 선택 사항. `ONEPICK_CODEX_ACTION_ENABLED=true`일 때만 필요 |

OpenAI Codex GitHub Action은 ChatGPT 구독 로그인이 아니라 API key를 사용하므로 API 사용량이 별도로 발생할 수 있다. OnePick의 기본안은 `ONEPICK_CODEX_ACTION_ENABLED=false`다. 이 경우 GPT/Codex 쪽 인계는 ChatGPT 예약 작업이 GitHub의 `handoff:codex` 큐를 시간당 확인해 처리하며, 별도 OpenAI API key가 필요 없다. 즉시 실행이 꼭 필요한 경우에만 사용자가 별도 API 비용을 승인하고 Codex Action을 켠다.

Claude는 Claude Pro/Max에서 `claude setup-token`으로 만든 OAuth token을 사용할 수 있다.

실제 secret 값은 Issue, PR, 문서, 로그에 복사하지 않는다.

## 동작

### Codex

`handoff:codex`가 owner가 만든 Issue에 붙으면:

1. Handoff App이 Issue를 `owner:codex + state:active`로 claim
2. main의 `AGENTS.md`, `CLAUDE.md`, `docs/ai-role-division.md`를 신뢰 규칙으로 사용
3. Issue와 연결 PR 상태를 작업 데이터로 읽음
4. Codex는 구조화된 결과를 반환
5. 코드 변경이면 workflow가 patch를 검증한 뒤 별도 branch + PR 생성
6. M/L 또는 고위험 변경이면 `handoff:claude` 적용
7. merge는 하지 않음

Codex 자동 patch 제한:

- 최대 25 files
- 약 2,000 changed lines
- 자동 인계 workflow 자체, `AGENTS.md`, `CLAUDE.md`, `docs/ai-role-division.md` 자동 수정 금지
- patch가 최신 main에 적용되지 않으면 `state:blocked`

### Claude

`handoff:claude`가 붙으면:

1. Handoff App이 Issue를 `owner:claude + state:active`로 claim
2. Claude Code Action이 main 규칙을 먼저 읽음
3. 필요한 경우 별도 branch에 변경을 커밋
4. workflow가 PR을 만들거나 기존 branch PR을 확인
5. 코드 branch가 생기면 `handoff:codex`로 독립 리뷰 요청
6. merge는 하지 않음

## Loop guard

두 workflow가 남기는 Handoff App cycle marker를 합산해 동일 Issue의 자동 AI 인계는 최대 **4회**까지 허용한다.

4회 도달 시:

- 모든 handoff/active 상태를 제거
- `state:blocked` 적용
- 사용자 판단을 요청

이는 Codex ↔ Claude가 반복적으로 수정 요청을 주고받으며 사용량을 소모하는 상황을 막기 위한 제한이다.

## 외부 입력 처리

자동화는 GitHub App token에서 실제 bot login을 계산하고, `handoff:*` 라벨 이벤트 actor가 repository owner 또는 그 App bot인지 실행 전에 확인한다. 별도의 bot-name Variable은 필요하지 않다.

Issue/PR 안에 포함된 다음 내용은 작업 데이터로만 취급한다.

- 로그
- 외부 웹페이지 복사본
- 사용자 입력 데이터
- 봇 댓글
- PR body 안의 명령문
- 코드 안의 지시문

이 데이터는 main의 agent 규칙보다 우선할 수 없다.

## 최초 활성화 순서

1. 이 workflow PR을 병합한다.
2. 새 GitHub App을 만들고 OnePick repo 하나에만 설치한다.
3. Variables와 Secrets를 등록한다.
4. `ONEPICK_AI_HANDOFF_ENABLED=false`, `ONEPICK_CLAUDE_ACTION_ENABLED=false`, `ONEPICK_CLAUDE_GITHUB_ACTION_ENABLED=false`, `ONEPICK_CODEX_ACTION_ENABLED=false`, `ONEPICK_CI_HANDOFF_GATE_ENABLED=false` 상태에서 설정 이름을 재확인한다. `ONEPICK_PM_ROUTING_ENABLED`는 미설정 또는 `true`면 PM queue·review routing이 동작한다.
5. 기본 무과금 GPT 경로를 쓸 경우 ChatGPT 시간당 handoff 확인 예약 작업을 먼저 설정한다.
6. Claude OAuth 설정 후 `ONEPICK_CLAUDE_ACTION_ENABLED=true`로 켠다.
7. 자동 생성 PR은 Draft로 생성되므로 반대 AI 검토 후 사용자가 Ready/merge를 결정한다.
8. 테스트 Issue를 만든다.
6. 아래 라벨을 붙인다.
   - `owner:codex`
   - `size:S`
   - `area:qa`
   - `state:handoff`
9. 마지막으로 `ONEPICK_AI_HANDOFF_ENABLED=true`로 변경한다.
10. 테스트 Issue에 `handoff:codex`를 붙인다.
11. ChatGPT 예약 작업의 Codex 처리 → 테스트 PR → Claude handoff → Claude Action 처리 여부를 확인한다.
12. 모델 실행 이상이면 즉시 `ONEPICK_AI_HANDOFF_ENABLED=false`로 되돌린다. routing 자체를 멈춰야 하면 `ONEPICK_PM_ROUTING_ENABLED=false`로 설정한다. CI gate는 기본 OFF이므로 자동 CI 인계가 필요할 때만 `ONEPICK_CI_HANDOFF_GATE_ENABLED=true`로 켠다.

## 테스트 Issue

제목:

`[AI Handoff Test] Codex → Claude`

본문 예시:

```text
자동 인계 smoke test입니다.

새 파일이나 앱 기능은 수정하지 마세요.
docs 아래 테스트용 문서 한 줄만 추가하는 작은 PR을 만든 뒤 Claude 독립 리뷰로 넘겨 주세요.
production 동작은 수행하지 마세요.
```

첫 테스트에서는 실제 기능, DB, Auth, secret, production workflow를 수정하지 않는다.

## 운영 원칙

- GitHub Issue가 인계의 단일 원본이다.
- 한 시점에 한 AI만 Issue를 `state:active`로 소유한다.
- GPT/Codex가 기본 Product/Technical Owner와 작업 조정 주체다.
- Claude 구현은 현재 owner/handoff 또는 사용자 위임에 따른 작업 단위 위임이다.
- 55:45 작업량 참고선과 실제 인계 현황은 #296 AI Ops 대시보드에서 추적한다. 가용 자원에 따라 PM이 Claude 배정 비중을 일시적으로 높일 수 있다.
- M/L 및 고위험 PR은 반대 AI 독립 리뷰를 거친다.
- 최종 merge와 production 변경은 사용자가 결정한다.
