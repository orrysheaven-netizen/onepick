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

<!-- vercel preview skip test -->
