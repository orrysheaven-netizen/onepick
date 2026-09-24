# Deployment consistency automation

Automation-plan item E verifies that the tester deployment catches up to each
`main` push without performing a deployment itself.

## What is checked

- Cloudflare Pages: `https://onepick-5cl.pages.dev/deployment.json` must report
  `branch=main` and an exact `commitSha` match with the GitHub `main` HEAD.
- Supabase Edge Functions: only functions whose source changed in the push are
  checked. They must exist, be `ACTIVE`, and have a deployment timestamp no
  older than the main commit. A change under `supabase/functions/_shared` or
  `supabase/config.toml` checks all repository Edge Functions.

The Supabase Management API exposes function status/version/update time but does
not expose a Git commit SHA. The Edge Function part therefore verifies deployment
freshness/status rather than claiming cryptographic source equality. Cloudflare
is the exact SHA check.

The workflow waits up to 12 minutes for asynchronous deploys. A persistent
mismatch creates or updates one open `qa-alert` issue. The workflow has no
deployment, database, secret-management, or repository-content write permission.

## Supabase read-only credential

Edge verification is needed only on pushes that change Edge Functions. Configure
the repository Actions secret:

- `SUPABASE_QA_ACCESS_TOKEN`

Use a Supabase fine-grained token limited to the OnePick project with
`edge_functions_read` only. Do not reuse the DB deployment token. If the secret
is absent on a function-changing push, the check fails visibly and opens the
same `qa-alert` rather than silently claiming success.

No paid service is required for this check.
