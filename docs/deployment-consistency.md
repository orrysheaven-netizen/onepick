# Deployment consistency automation

Automation-plan item E verifies that the tester deployment catches up to each
`main` push without performing a deployment itself.

## What is checked

- Cloudflare Pages: `https://onepick-5cl.pages.dev/deployment.json` must report
  `branch=main` and an exact `commitSha` match with the GitHub `main` HEAD.
- Supabase Edge Functions: only functions whose source changed in the push are
  checked. They must exist, be `ACTIVE`, and have a deployment timestamp no
  older than the main commit. A change under `supabase/functions/_shared` or
  other private/shared directories or function-root dependency files checks all
  repository Edge Functions (including deleted/renamed paths).
- `supabase/config.toml` is parsed with Python 3.11+ `tomllib`: only changed
  `functions.<slug>` tables select that function. Added/removed keys and tables
  count, including `verify_jwt`, `entrypoint`, and `import_map`. Storage/Auth/DB
  settings and comments/formatting alone do not select functions. Global
  `edge_runtime` changes select all functions. Invalid TOML or missing Git
  history fails detection rather than silently skipping verification.
- Checkout includes full history so multi-commit pushes compare the exact
  event `before` SHA. Manual runs compare HEAD with its first parent; initial
  commits conservatively select all functions. This is a per-push freshness
  check, not an audit of historical production drift.

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


## Offline regression checks

```sh
python3 -m unittest discover -s tools/qa -p test_detect_edge_function_changes.py
node tools/qa/check-deployment-consistency.test.mjs
```
