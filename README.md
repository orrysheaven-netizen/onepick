# OnePick

OnePick is a mobile-first social favorites product where each user keeps exactly one current favorite per category.

## Product principle

- One current Pick per category.
- Every Pick has a short one-line reason.
- Products come from a shared product master whenever possible.
- Missing products are submitted as pending requests and reviewed by Admin.
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

Read-heavy social screens use a dedicated `ReadRepository` to fetch Pick + Product + Category + Profile data together and avoid N+1 requests.

## Current MVP capabilities

- Home with real Pick data and logged-in personalization.
- Explore recent Picks with pagination.
- Product-first Pick registration.
- Missing product requests with Admin approval / merge / rejection.
- Product detail, Pick detail, comments, Pick sharing and profile sharing.
- My Profile and public profiles.
- Admin Category / Brand / Product management.
- Product aliases and trigram-backed search.
- Account settings, account deletion, user blocking and content reporting.
- Admin report moderation.

## Account safety

- Blocking is enforced by PostgreSQL RLS for authenticated profile, Pick and comment reads.
- Reports support profile, Pick and comment targets.
- The database derives the real target owner and prevents self / duplicate active reports.
- Admin report resolution records resolver and resolution time.
- Account deletion is handled by an authenticated Edge Function.
- On account deletion, Profile / Picks / Comments / blocks are removed through Auth-linked cascade rules.
- Approved product master records remain; their `created_by` link is cleared.
- User-owned product images still referenced by master products are preserved under a catalog-owned storage path before the user's storage folder is removed.

## Search and performance

- `product_aliases` keeps alternate search phrases mapped to one canonical `product_id`.
- PostgreSQL `pg_trgm` + GIN indexes support scalable fuzzy / contains search.
- `search_products()` ranks canonical exact, alias exact, prefix, contains and similarity matches.
- Home / Explore / Profile / Pick Detail / Product Detail / Comments avoid per-item hydration queries.
- Explore and Comments load 20 items at a time.

## Validation

The project has separate Mobile and Database CI workflows. Current feature work is kept on `feature/pick-core` and reviewed through Draft PR #1 before merge.

See `docs/development-start.md` for local setup and `docs/shared-product-registration.md` for the product-master workflow.
