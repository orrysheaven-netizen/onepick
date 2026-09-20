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
supabase db reset
supabase test db
```

`supabase db start` only applies migrations the first time it creates the
`supabase_db_onepick` Docker volume. On every later run it prints
`Starting database from backup...` and restores that volume as-is, so any
migration that landed after the volume was created (for example after a
`git pull` or a branch switch) is **not** applied and pgTAP suites for the new
schema fail. `supabase db reset` (which needs the database running) rebuilds
the schema from `supabase/migrations` and re-applies `supabase/seed.sql`;
run it whenever migrations changed. `supabase stop --no-backup` discards the
volume entirely for the same effect.

A stale volume typically surfaces as a trigger or function raising for input
the current migrations accept, e.g. `033_category_hierarchy_editorial.sql`
failing with `CATEGORY_INVALID` from a two-level-only
`private.validate_category_tree()`. Compare
`select version from supabase_migrations.schema_migrations` against the files
in `supabase/migrations` to confirm.

Database CI recreates the project from migrations and runs every pgTAP suite under `supabase/tests`.

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

Feature work currently lives on `feature/pick-core` in Draft PR #1. Keep the PR draft until the active milestone has both Mobile CI and Database Tests green and actual-device release checks are complete.
