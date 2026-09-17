# Shared development status

Last updated: 2026-09-17.

The shared code baseline is `feature/pick-core` in Draft PR #1. Work from the
`onepick_main` conversation and the local Home/UI conversation is integrated on
that branch. Conversation messages are not automatically synchronized; check the
latest available conversation context and GitHub branch before starting work,
and reconcile intervening commits before updating the branch without force.

## Integrated work

- Personalized Home, shared product requests, Admin category/product management.
- Joined read models, Explore/comment pagination, aliases and indexed product search.
- Account settings/deletion, blocking, reporting and Admin report moderation.
- The clean MVP mockup design, request follow-up routes and profile refresh.
- Database approval lifecycle verification, including merge/rejection and shared products.

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

## Deferred verification

The user deferred Kakao login until the evening. Authenticated browser verification
of request → Admin approval → Pick selection remains pending, as does physical
iOS/Android device testing. Database role tests and mocked UI tests do not replace
those checks.
