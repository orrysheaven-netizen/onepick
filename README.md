# OnePick

OnePick is a mobile-first social favorites item where each user keeps exactly one current favorite per category.

## Item principle

- One current Pick per category.
- Every Pick has a short one-line reason.
- Items come from a shared item master whenever possible.
- Missing items are submitted as pending requests and reviewed by Admin.
- Old Picks remain history.
- Comments belong to Picks.
- Public profiles show a user's current taste collection.

## Architecture

```text
Screen
  → Query / Mutation Hook
  → Service
  → Repository Interface
  → Supabase Repository
  → Supabase / PostgreSQL
```

Read-heavy social screens use a dedicated `ReadRepository` to fetch Pick + Item + Category + Profile data together and avoid N+1 requests.

## Current MVP capabilities

- Home with real Pick data and logged-in personalization.
- Explore recent Picks with pagination.
- Item-first Pick registration.
- Missing item requests with Admin approval / merge / rejection.
- Item detail, Pick detail, comments, Pick sharing and profile sharing.
- My Profile and public profiles.
- Admin Category / Brand / Item management.
- Item aliases and trigram-backed search.
- Account settings, account deletion, user blocking and content reporting.
- Admin report moderation.

## Account safety

- Blocking is enforced by PostgreSQL RLS for authenticated profile, Pick and comment reads.
- Reports support profile, Pick and comment targets.
- The database derives the real target owner and prevents self / duplicate active reports.
- Admin report resolution records resolver and resolution time.
- Account deletion is handled by an authenticated Edge Function.
- On account deletion, Profile / Picks / Comments / blocks are removed through Auth-linked cascade rules.
- Approved item master records remain; their `created_by` link is cleared.
- User-owned item images still referenced by master items are preserved under a catalog-owned storage path before the user's storage folder is removed.

## Search and performance

- `item_aliases` keeps alternate search phrases mapped to one canonical `item_id`.
- PostgreSQL `pg_trgm` + GIN indexes support scalable fuzzy / contains search.
- `search_items()` ranks canonical exact, alias exact, prefix, contains and similarity matches.
- Home / Explore / Profile / Pick Detail / Item Detail / Comments avoid per-item hydration queries.
- Explore and Comments load 20 items at a time.

## Validation

The project has separate Mobile and Database CI workflows. Current feature work is kept on `feature/pick-core` and reviewed through Draft PR #1 before merge.

See `docs/development-start.md` for local setup and `docs/shared-item-registration.md` for the item-master workflow.

See [MVP web deployment](docs/web-deployment.md) for production web builds,
SPA routing, hosting environment, OAuth callbacks and release verification.
