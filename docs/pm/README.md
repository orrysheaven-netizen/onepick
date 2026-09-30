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
| UX / Figma | **ChatGPT 직접 작업** + Claude 독립 검수 | 기존 화면, Foundations, UX·문구·접근성 |
| Engineering | ChatGPT/Codex 기본 + Claude 위임 구현 | Expo/React Native 앱 구현, 라우팅, API 연결 |
| Data / DB | ChatGPT/Codex 기본 구현 + Claude 독립 리뷰 | Supabase migration, RPC, RLS, 데이터 무결성 |
| QA / Reliability / Security | Claude | QA, Security, E2E, 성능, 독립 리뷰·위임 구현 |
| Release / 운영 | Claude 검증·위임 구현 + ChatGPT PM 판정 | CI·배포·DB 정합성·운영 검증 |

총괄 PM은 위 조직을 가로질러 우선순위, 분업, 충돌 조정, 최종 완료 판정을 담당한다.

### 점검 책임

PM이 각 영역의 세부 점검을 대신 수행하지 않는다.

1. 각 담당 조직이 자기 영역을 1차 점검하고 근거를 원래 작업 Issue에 보고한다.
2. QA/Reliability/Security는 필요한 영역을 독립 재검증한다.
3. Release/운영은 실제 배포·Production 반영 상태를 검증한다.
4. PM은 보고 간 충돌, 누락, 우선순위와 최종 완료 여부만 판정한다.
5. 근거가 부족하면 PM이 직접 대체 점검하기보다 해당 담당자에게 재점검을 돌려보낸다.

현재 MVP 규모에서는 별도 상설 “점검 부서”를 만들지 않는다. QA를 독립 검증 계층으로 사용해 책임 중복과 조직 복잡도를 줄인다.

### 동적 작업 배정

- 작업량 참고선은 **Codex 55 : Claude 45**다.
- 고정 quota가 아니며 PM은 전문성·우선순위·현재 가용 자원에 따라 배정 비중을 조정한다.
- Claude 자원이 여유로운 경우 일반 앱/UI S/M 수정, 성능 개선, QA 자동화, Release tooling을 Claude에 더 배정할 수 있다. **Figma 직접 편집은 기본적으로 ChatGPT가 담당하고 Claude는 검수한다.**
- Product 정책·MVP 범위 결정은 ChatGPT PM이 유지한다.
- DB/RLS/GRANT 등 Data/DB 기본 구현은 ChatGPT/Codex가 유지하며 Claude는 독립 리뷰를 기본으로 한다.
- 위임 구현은 해당 작업 단위에만 적용되며 영구 소유권 변경을 뜻하지 않는다.
- **Figma 직접 작업 원칙**: Figma 화면 생성·수정·정리는 기본적으로 ChatGPT가 수행한다. Claude는 UX 일관성, 접근성, Foundations 준수, 앱-Figma 정합성을 독립 검수한다. Claude의 Figma 직접 편집은 사용자가 명시적으로 예외 위임한 경우에만 허용한다.

## 5. GitHub 역할

- `docs/pm/`: 조직 규칙·현재 우선순위·현재 상태
- `docs/pm/routines.md`: 정기 루틴 업무대장·담당·자동 실행 범위
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


## 10. 관리자 조치 표기

PM 보고에서 사용자가 직접 해야 하는 작업과 승인만 필요한 작업을 구분한다.

- **관리자 승인 필요**: ChatGPT/Claude가 실행 가능하지만, 사용자 승인 게이트 때문에 실행 전 승인이 필요한 작업. 예: main merge, Production DB mode=apply, production Edge Function deploy.
- **관리자 직접 수행 필요**: 계정 소유자만 가능한 UI 조작·인증·비밀값 입력·결제·MFA 등으로 AI가 대신 수행할 수 없는 작업. 예: OAuth token 재발급, GitHub Secret 입력/교체, MFA 완료, 외부 서비스 결제 승인.

상태 보고에는 해당 사항이 있으면 별도 섹션으로 명시한다. 없으면 **관리자 직접 수행 필요: 없음**으로 표시한다.

## 11. PM review queue

### 운영 원칙

- PM은 지시·우선순위·다음 계획을 결정한다.
- 각 담당자는 자신의 범위만 수행한다.
- 담당 완료 후 계획 판단이 필요한 경우 PM review queue로 반환한다.
- PM 판정 전에는 다음 제품 단계로 임의 진행하지 않는다.

### 흐름

담당 완료 → 원래 이슈에 `## 완료 리포트` → `PM_REVIEW_REQUIRED` → `## PM 검토 대기`

구현: `.github/workflows/ai-pm-review-queue.yml`. GitHub 내부 queue만 사용하며 외부 webhook/API는 호출하지 않는다. 새 라벨 없이 bot marker만 사용한다.

### 생성하는 경계

PM review는 계획·우선순위·승인 판단이 필요한 완료 경계에서만 만든다.

| 경계 | 생성 방식 |
| --- | --- |
| 부서/단계 작업 완료 | 담당자가 원래 이슈에 `PM_REVIEW_REQUIRED: reason=stage-complete ...` |
| 독립 리뷰 완료 | 리뷰어가 원래 이슈에 `PM_REVIEW_REQUIRED: reason=review-complete ...` |
| CI 성공 후 사용자 병합 판단 직전 | CI gate가 `next=user` PR의 필수 CI 통과를 기록하면 자동 생성. `PM_REVIEW_REQUIRED: reason=merge-ready ...`로도 요청 가능 |
| release/production 승인 직전 | `PM_REVIEW_REQUIRED: reason=release-approval ...` |

수정 담당이 명확한 Codex↔Claude 인계(`handoff:*`, CI gate `next=claude|codex`, 리뷰 결과 `CHANGES_REQUESTED`/`READY_FOR_REVIEW`)는 기존 handoff 체인만 사용하고 PM queue를 만들지 않는다.

### 요청·판정 줄

원래 작업 이슈 댓글의 **첫 줄**(앞에 빈 줄 없이)에 쓴다.

- `PM_REVIEW_REQUIRED`: 저장소 소유자 계정 또는 handoff App bot이 쓴 줄만 인정한다.
- `PM_REVIEW_DONE`: **저장소 소유자 계정이 쓴 줄만** 인정한다. handoff App은 Codex/Claude 자동 담당 실행과 같은 identity라서, bot이 쓴 판정은 담당자가 스스로 내린 판정과 구분할 수 없으므로 거부한다. drain도 처리 직전에 원 댓글이 소유자 계정의 같은 판정 줄인지 다시 확인하므로, bot이 pending marker를 위조해도 기록되지 않는다.

**남은 신뢰 경계**: 소유자 계정은 여러 수동 세션(ChatGPT PM, 사용자, 수동 Codex/Claude 세션)이 함께 쓸 수 있다. 이 검사는 PM 판정을 handoff App 자동 실행과 분리할 뿐, 소유자 계정으로 쓴 판정이 실제 PM의 판정임을 보증하지 않는다. 또한 bot이 결과 marker(`onepick-pm-review:done`)를 직접 쓰는 것은 막지 못하므로, 이후 단계에서 이 marker를 승인 근거로 소비하려면 별도 PM identity 도입이 선행되어야 한다. 둘째 줄 이후에 인용한 명령 줄은 workflow를 실행하지 않는다.

```text
PM_REVIEW_REQUIRED: reason=<stage-complete|review-complete|merge-ready|release-approval> pr=<N|none> head=<40자리 SHA|none>
PM_REVIEW_DONE: decision=<continue|revise|block|user-approval> pr=<N|none> head=<40자리 SHA|none>
```

### Marker

아래 marker는 handoff App bot이 쓴 경우에만 유효하다. 다른 작성자가 같은 문자열을 써도 무시한다.

```text
<!-- onepick-pm-review:required issue=<N> pr=<N|none> head=<SHA|none> -->
<!-- onepick-pm-review:done issue=<N> pr=<N|none> head=<SHA|none> decision=<continue|revise|block|user-approval> -->
```

| decision | 의미 |
| --- | --- |
| `continue` | 계획대로 다음 단계 진행을 PM이 지시 |
| `revise` | 담당자에게 수정 반환 |
| `block` | `state:blocked` 전환, 사용자/외부 조치 대기 |
| `user-approval` | 사용자 승인 게이트로 전달 (main merge, Production 등) |

`PM_REVIEW_DONE`은 해당 `## PM 검토 대기` 댓글 **이후**에 작성되고, PR의 현재 head를 가리킬 때만 기록한다. 요청 요약보다 먼저 쓴 판정이나 이전 head에 대한 판정은 기록하지 않고 생략 사유를 남긴다. 이 경우 새 요약을 확인한 뒤 판정 줄을 다시 쓴다.

판정 기록은 상태만 남기며, 다음 작업은 PM 지시에 따라 담당자/사용자가 진행한다. 자동으로 handoff 라벨을 붙이거나 다음 단계로 넘어가지 않는다.

### 생성하지 않는 경우

- 이슈가 닫혔거나 `state:blocked`
- `head`가 PR의 현재 head가 아님 (stale), 또는 PR이 해당 이슈를 `Refs #N`으로 참조하지 않음
- 같은 (issue, pr, head)에 PM review가 이미 대기 중이거나 판정이 이미 기록됨
- `handoff:*` 인계가 아직 대기 중
- 신뢰되지 않은 작성자의 요청·marker

### 이벤트 보존 (durable queue)

같은 이슈에 요청·판정·CI gate 결과가 짧은 간격으로 겹쳐도 유실되지 않도록 두 단계로 처리한다.

1. **enqueue** (동시성 제한 없음): 신뢰된 요청·판정·gate 댓글마다 원래 이슈에 bot marker를 한 번만 남긴다.
   `<!-- onepick-pm-queue:pending source=comment-<id> kind=<required|done|gate> arg=<reason|decision> pr=<N|none> head=<SHA|none> -->`
2. **drain** (저장소 단위 직렬화, 취소 없음): 이벤트 이슈와 댓글이 있는 모든 열린 이슈에서 `onepick-pm-queue:processed source=<id>`가 없는 pending marker를 원 댓글 작성 순서대로 처리한다. 결과 댓글(`PM 검토 대기`/`PM 판정 기록`/생략 사유)에 processed marker를 함께 남기므로 결과와 처리 상태가 한 댓글로 기록된다.

- 대기 중인 drain run이 새 run으로 대체되거나 취소되어도 marker가 남아 다음 drain이 회수한다.
- 같은 SOURCE_ID는 한 번만 접수·처리한다.
- 처리 중 API 오류가 나면 항목은 pending으로 남고 `onepick-pm-queue:failed` marker로 시도 횟수를 기록한다. 같은 이슈의 뒤 항목은 순서를 지키기 위해 다음 drain까지 기다린다. **3회** 실패하면 processed로 닫고 "수동 확인 필요"를 남긴다.
- `decision=block`은 `state:blocked`를 추가 방식(전체 라벨 덮어쓰기 아님)으로 먼저 붙인 뒤 판정을 기록한다. 기록이 실패하면 다음 drain이 이미 붙은 라벨을 확인하고 기록만 남긴다(라벨은 한 번만 적용).
- 오프라인 회귀 테스트: `bash .github/scripts/test-pm-review-queue.sh` (mock `gh`, 네트워크·토큰 불필요).


## 12. PM automatic assignment dispatcher

GitHub는 OnePick의 팀장·실행자 자동 배정 원장이다. 로컬 PC, self-hosted runner, 별도 유료 AI API, 채팅 간 직접전송을 필수 경로로 사용하지 않는다.

### 지시 형식

원 작업 이슈의 첫 줄에 다음 형식을 사용한다.

```text
PM_DIRECTIVE: team=<product|ux|engineering|data|qa-security|release> to=<auto|claude|codex> action=execute pr=<N|none> head=<40자리 SHA|none>
```

기존 지시와의 호환을 위해 `team=`이 없는 형식도 읽되, area/title을 기준으로 팀을 보수적으로 추론한다.

### 자동 배정 결과

dispatcher는 검증된 지시를 다음 두 축으로 기록한다.

- 팀장 큐: `team:product`, `team:ux`, `team:engineering`, `team:data`, `team:qa-security`, `team:release`
- 실행자 큐: `owner:codex` 또는 `owner:claude`
- 착수 가능 상태: `state:ready`
- 배정 근거: bot의 `onepick-pm-assignment` marker

`to=auto`의 기본값은 역할 분담을 따른다.

| 팀 | 기본 실행자 |
| --- | --- |
| Product | Codex |
| UX/Figma | Codex |
| Engineering | Codex |
| Data/DB | Codex |
| QA/Reliability/Security | Claude |
| Release/운영 | Claude |

PM은 작업 단위 전문성·가용성에 따라 `to=claude` 또는 `to=codex`로 명시적 예외 배정할 수 있다.

### 실행과 완료

- 팀장 세션은 자신의 `team:*` + `state:ready` 이슈를 본다.
- Claude/Codex 실행 세션은 자신의 `owner:*` + `state:ready` 이슈를 본다.
- 실제 착수 시 `state:active`로 claim하고 `state:ready`를 제거한다.
- `state:blocked`이면 dispatcher는 pending을 유지하고 blocker가 해제될 때 재평가한다.
- `state:active` 또는 `state:review` 중에는 같은 작업을 중복 배정하지 않는다.
- 기존 `handoff:*`는 과거/수동 인계 호환용이며 새 PM 배정의 기본 경로가 아니다.
- 완료 시 원 이슈의 `## 완료 리포트`를 dispatcher가 `state:review` + `PM_REVIEW_REQUIRED`로 연결하고 #567 PM review queue가 이어받는다.

구현: `.github/workflows/ai-pm-dispatch.yml`, `.github/scripts/pm-dispatch.cjs`.

### 수동 요청 원칙

자동화 문제는 먼저 재시도·stale/중복 검증·상태 복구로 해결한다. 사용자에게 수동 작업을 요청하는 것은 아래처럼 자동화가 대신할 수 없는 경우로 제한한다.

- main merge 등 기존 사용자 승인 게이트
- Production DB `mode=apply` / production 배포 승인
- secret/environment/permission 변경
- MFA, OAuth 재인증, 결제 또는 계정 소유자 전용 UI 조작
- GitHub API 상태 반영을 3회 재시도한 뒤에도 실패하고 자동 복구 이벤트도 없는 경우

단순히 다른 ChatGPT 대화방을 깨울 수 없다는 이유만으로 사용자에게 반복 지시를 요청하지 않는다. GitHub의 `team:*` / `owner:*` / `state:ready`를 공식 배정 상태로 사용한다.
