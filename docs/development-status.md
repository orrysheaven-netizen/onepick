# Shared development status

Last updated: 2026-09-17.

The shared code baseline is `feature/pick-core` in Draft PR #1. Work from the
`onepick_main` conversation and the local Home/UI conversation is integrated on
that branch. Conversation messages are not automatically synchronized; check the
latest available conversation context and GitHub branch before starting work,
and reconcile intervening commits before updating the branch without force.

## Integrated work

- Personalized Home, shared item requests, Admin category/item management.
- Joined read models, Explore/comment pagination, aliases and indexed item search.
- Account settings/deletion, blocking, reporting and Admin report moderation.
- The clean MVP mockup design, request follow-up routes and profile refresh.
- Database approval lifecycle verification, including merge/rejection and shared items.

## Admin queue performance

`AdminService.getDashboard()` now obtains submitter profiles through
`ProfileRepository.getByIds()`. The Supabase implementation deduplicates IDs and
reads batches of at most 100 UUIDs to keep request URLs bounded.

For the existing limit of 500 pending requests, author lookups change from up to
500 individual reads to at most five batch reads. Repeated authors use one lookup;
an empty queue or only deleted authors needs none. This is a request-count result,
not a measured end-to-end latency claim. Other dashboard reads are unchanged.

The response keeps the moderation queue's order. Missing or RLS-filtered profiles
remain `null`, failed batches propagate through the existing error/retry UI, and
the admin check still runs before dashboard data reads. Screen → Hook → Service →
Repository → Supabase remains the boundary; no schema or policy change is needed.

`mobile/scripts/test-admin-dashboard.cjs` checks the 500-author budget, deduplication,
unordered/missing results, deleted accounts, error recovery and authorization.

## Feed and comment pagination

Explore and comments now continue from the last visible row's timestamp plus UUID,
instead of a positional offset. Equal timestamps have deterministic ID ordering,
and PostgreSQL microseconds are kept intact. Each read requests one extra row to
decide whether more data is available, with a default page size of 20.

Inserting or removing rows before the cursor does not shift the next page. A
deleted cursor row still works because its sort values are carried in the cursor.
This is not a frozen database snapshot: refreshing the list starts at the beginning
to pick up newer items and current visibility rules. Existing RLS still applies.

Failed additional loads retain visible content and offer a retry of that page.
The load-more action does not interrupt background refreshes. Cursor-shaped query
keys are separate from old offset caches. Regression tests exercise the real
Supabase query builder and TanStack infinite-query behavior with changing fixtures.

## Private profile lists

My Profile loads previous Picks and item registration requests in separate,
account-scoped infinite queries, 20 items per page. The previous limits of 50
history items and 20 requests no longer make older entries inaccessible. Both
lists reuse the timestamp/UUID cursor convention; requests use immutable
`created_at` ordering so moderation status changes do not reorder pages.

The basic profile query only loads the profile and current Picks. Other screens
that use it no longer fetch history or requests they do not display. A list
failure leaves the basic profile and the other list usable. Each list provides
loading, empty and error states, retains loaded cards after failed refresh/more
actions, and offers the appropriate retry. Refresh updates all three queries;
additional loading cannot interrupt an in-flight refresh. Counts describe loaded
items instead of implying a database total. Existing Pick/item detail routes,
including canonical targets after request merges, are preserved.

Private query keys include the account ID and remain under the existing profile
invalidation prefix. The screen hides these lists while the session is loading
or after logout. No database, RLS, authentication or image-storage change is made.

`test-pagination.cjs` exercises 61 historical Picks and 45 requests through the
real Supabase query builder and TanStack query client with a mocked HTTP boundary.
It covers equal timestamps, deleted cursor rows, new rows, moderation changes,
owner/status filters, account cache isolation and retry. `test-request-status.cjs`
checks the rendered controls, independent failures, routes and privacy states.

## Home and Explore refresh recovery

Home and Explore provide an explicit refresh action on web and native, plus a
native pull-to-refresh control. Home retains its loaded cards and routes when a
data refresh fails; Explore now distinguishes a refresh failure from a failed
additional page. Both show a cached-data notice and let the user retry. Initial
load errors still show the full error state instead of empty success content.

Refresh uses the existing query hooks, preserving the current account/category
key and loaded infinite-query pages. Fetching guards and `cancelRefetch: false`
prevent refresh and load-more actions from cancelling one another. Home still
hides private cards while the session is being checked, on session errors and
after logout. This is recovery for loaded in-memory data, not persistent offline
storage or offline writes. No API, database or package changes are needed.

The Home and interaction regression checks cover cached versus initial errors,
both refresh controls, pending-request guards, retry recovery and session privacy.

## Deferred verification

Web deployment preparation is documented in [MVP web deployment](web-deployment.md).
The web output is now an SPA with a host fallback rule for dynamic item/Pick/
profile URLs. Web shares default to the current origin; native deep-link behavior
is preserved. Mobile CI exports the web bundle and checks direct routes/assets
with isolated CI configuration. Hosting/domain selection and publication remain
separate from these build checks.

`build:web:release` now checks real public configuration before exporting to the
separate, ignored `dist-release` directory, then runs the direct-route/asset
checks. Missing/example settings, non-HTTPS origins and non-publishable keys fail
before export. Expo production dotenv precedence and host overrides are reused;
errors omit configuration values. The preflight is offline and does not establish
OAuth readiness or the validity of credentials. Hosting/domain selection remains
pending by the user's choice; no site or Auth configuration was published.

The user deferred Kakao login until the evening. Authenticated browser verification
of request → Admin approval → Pick selection remains pending, as does physical
iOS/Android device testing. Database role tests and mocked UI tests do not replace
those checks.
