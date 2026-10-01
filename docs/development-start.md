# OnePick development start

## Mobile

```bash
cd mobile
npm ci
npm run typecheck
npm test
```

The app follows:

```text
Screen → Hook → Service → Repository Interface → Supabase Repository → Supabase/PostgreSQL
```

Keep Supabase access out of screens and services. Read-heavy social views use `ReadRepository` so related Pick / Item / Category / Profile data can be fetched together.

## Environment

Copy the values represented in `mobile/.env.example` into the local environment. Do not commit secrets.

The mobile client only uses the public Supabase URL / publishable key. Admin secrets and service-role capabilities must stay server-side.

For the web build and deployment workflow, see [MVP web deployment](web-deployment.md).

## Database

From the repository root:

```bash
supabase db start
supabase migration up --local --include-all
supabase test db
```

An existing local database can be behind the migration files after a pull or branch change. Before running pgTAP locally, `supabase migration up --local --include-all` applies migration files that are missing from the local `supabase_migrations.schema_migrations` history. The `--include-all` flag also permits older pending migrations when a newer migration is already present in that history.

Use `supabase migration list --local` when you need to inspect what is pending. Avoid `supabase stop --no-backup` merely to catch up migrations because it removes local database data.

Database CI recreates the project from migrations and runs every pgTAP suite under `supabase/tests`.

### Applying migrations to the linked project

Merging a PR deploys neither its migrations nor its Edge Functions to the linked
Supabase project; the Cloudflare build ships only the web bundle. Deploy from
GitHub Actions, which always checks out `main`.

Production Environment configuration used by these workflows:
- secret `SUPABASE_ACCESS_TOKEN`: scoped PAT used by the Edge Function deployment workflow.
- secret `SUPABASE_DB_PASSWORD`: the existing database password used by DB migration and Edge apply preflight. Edge dry-run does not receive this secret.
- the non-secret Session pooler host is pinned in the deployment workflows as
  `aws-0-ap-northeast-2.pooler.supabase.com` for the current `onepick-dev` project.
  The workflow URL-encodes the existing password and constructs port `5432` Session
  mode with `sslmode=require` itself. No GitHub environment variable is required for the host.
GitHub-hosted runners are IPv4-only, so deployment workflows must not rely on the
direct `db.<project-ref>.supabase.co` IPv6 endpoint. No paid IPv4 add-on is required.

1. **Deploy Database Migrations**: run with `mode=dry-run`, review the pending
   list, then run again with `mode=apply`.
2. **Deploy Edge Functions**: run with `mode=dry-run` (the summary lists each
   function's deployed version, `verify_jwt`, and whether `main` changed since),
   then `mode=apply`. `functions` is `all` or a comma-separated list of slugs.
   `verify_jwt` comes from `supabase/config.toml`. Apply refuses to run while
   migrations are pending, so always deploy the database first.

Local fallback, only when Actions is unavailable:

```bash
git checkout main && git pull
supabase migration list --linked
supabase db push
supabase functions deploy <slug> --project-ref ygoipwzakzdnkaaxyrgb
```

Push only from a `main` checkout. Pushing from a feature branch records that branch's
migrations in the remote history before they exist on `main`, and the next `db push`
from `main` then refuses to run ("remote migration versions not found in local
migrations directory"). If that has already happened, either bring the migration to
`main` in a PR, or — when the remote entry duplicates one `main` already has — drop it
from the history with `supabase migration repair --status reverted <version>`; that
edits only the history table, not the schema.

Current database coverage includes:

- Pick replacement / review / removal.
- Comments and RLS.
- Shared item requests and Admin approval.
- Category hierarchy validation.
- Item aliases and search.
- Account deletion cascade rules.
- User blocking visibility.
- Profile / Pick / Comment reporting and Admin moderation.

## Edge Functions

Database CI also runs `deno check` against:

- `supabase/functions/import-item-image`
- `supabase/functions/delete-account`

`delete-account` uses `@supabase/server` with user authentication inside the function. It preserves item-master images still referenced by approved items, removes the user's storage folder, then deletes the Auth user.

## Safety model

Blocking is enforced in RLS for authenticated Profile, Pick and Comment reads, not only hidden in the UI.

Report inserts are protected by both RLS and database triggers. The client submits only the target type / ID and reason; PostgreSQL derives the target owner so a client cannot forge the reported user.

Account deletion is server-side because deleting an Auth user requires an admin/secret-key capability. The mobile app invokes the authenticated `delete-account` Edge Function and then clears the local session and query cache.

## Pull request workflow

`main` is the single trunk (see `CLAUDE.md`). Branch from `main`, open a PR against `main`, and merge once Mobile CI and Database Tests are green. `main` is also what the Cloudflare Pages tester site and the Supabase deploy workflows build from, so there is no separate integration branch to keep in sync. A PR that adds a migration or changes an Edge Function additionally needs the **Deploy Database Migrations** and/or **Deploy Edge Functions** workflow run with `mode=apply` after the merge (see [Applying migrations to the linked project](#applying-migrations-to-the-linked-project)).
