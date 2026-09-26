# Vercel preview policy

The Vercel Hobby plan has a daily deployment quota. When every PR push created a
preview, the quota ran out most days and the `Vercel` PR check failed with
"Deployment rate limited" whether or not the code was fine.

Roles:

- GitHub Actions decide whether a PR can merge. `main` requires `typecheck`,
  `verify-web` and `database-tests`. The `Vercel` check is not required and
  should stay that way.
- Vercel builds a preview only when the web build could change.
- `main` always gets a production deployment.

## How it works

Both `vercel.json` (repository root) and `mobile/vercel.json` set
`ignoreCommand` to run [`tools/vercel-ignore-build.sh`](../tools/vercel-ignore-build.sh).
Only one of the two is used, depending on the Vercel project's Root Directory
setting, so both files point at the same script. Vercel reads the exit code as
follows: 0 skips the deployment (it shows as "Canceled" / "Ignored Build Step"),
and 1 builds it.

1. Production (`VERCEL_ENV=production` or branch `main`) always builds.
2. A commit message containing `[vercel deploy]` forces a preview. Use this when
   a DB/API-only change needs screen QA on a preview.
3. Otherwise the script lists the files changed since the base commit, which is
   the first of these that is available:
   - `VERCEL_GIT_PREVIOUS_SHA`, the branch's last deployed commit. Skipped
     commits are then counted together with the next push.
   - The merge base with `origin/main`.
   - `HEAD~1`.
   If no base is available, it builds.
4. The preview is skipped only when **every** changed file matches:
   - `supabase/**` (migrations, pgTAP tests, Edge Functions, RLS/security SQL)
   - `docs/**`
   - `.github/**`
   - `*.md` anywhere

   Any other file builds the preview. That includes `mobile/**`, `package.json`,
   lockfiles, `vercel.json` and `tools/**`.

The script fails open: when it is unsure, it builds. A wrong guess therefore
costs quota and never hides a UI change.

Before this change, `git.deploymentEnabled` was set to `{"main": true, "*": false}`.
It did not stop previews, most likely because `*` does not match branch names
that contain `/`, such as `feat/...`. It has been removed, and the script above
is the single source of the policy.

## Checking it

- Vercel dashboard → Deployments: a skipped push appears as "Canceled", and its
  build log shows `vercel-ignore-build: SKIP - ...`.
- Locally, from a branch checkout:

  ```bash
  VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=feat/x VERCEL_GIT_PREVIOUS_SHA=<base> bash tools/vercel-ignore-build.sh; echo $?
  ```

## 도입 기록 (2026-09-26, Claude Code)

ChatGPT/Codex 인계용 요약입니다.

- **원인:** #299의 `deploymentEnabled` 설정(`"*": false`)이 `feat/…`처럼 `/`가 들어간 브랜치와 매칭되지 않았습니다. 그래서 PR push마다 Preview가 만들어졌고, Hobby 플랜의 하루 배포 한도를 넘겨 `Vercel` 체크가 "rate limited"로 실패했습니다. 09-26 하루에만 #368, #370, #371이 이렇게 실패했습니다.
- **조치:** #374에서 위 `ignoreCommand` 스크립트를 도입했습니다. 비용이 드는 방법(Pro 업그레이드)은 쓰지 않았습니다.
- **바뀌지 않은 것:** 필수 체크(`typecheck`, `verify-web`, `database-tests`), `main` Production 배포, Supabase는 그대로입니다. Vercel은 필수 체크가 아니며 앞으로도 필수로 만들지 않습니다.
- **실제 Vercel 검증 (병합 후):**
  - #379 (`docs/` Markdown만 변경): "Canceled by Ignored Build Step". Preview를 건너뛰었고 체크는 통과로 표시됐습니다.
  - #380 (`mobile/src/app/(tabs)/_layout.tsx` 변경): "Deployment has completed". Preview가 정상 생성됐습니다.
  - 두 PR 모두 확인 후 닫았습니다.
- **남은 위험과 후속:**
  - 건너뛴 배포도 Vercel 배포 기록으로 남습니다. 이것이 하루 한도에 포함되는지는 확인하지 못했습니다.
  - `mobile/**`을 바꾸는 PR은 계속 Preview를 만듭니다.
  - 이 정책을 적용한 뒤에도 며칠간 "rate limited" 실패가 이어지면, 다음 단계는 PR Preview를 끄는 것입니다. 스크립트가 production이 아닐 때 항상 exit 0으로 끝나게 하면 됩니다. 테스터 화면은 Cloudflare Pages가 `main`에서 배포하므로 Preview가 없어도 QA는 가능합니다.
  - 원격의 `fix/vercel-deployment-policy` 브랜치는 이미 병합된 #299의 브랜치입니다. 이번 작업과 상관없고 지워도 됩니다.
