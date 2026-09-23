# Product analytics ingestion

Clients send events through `public.capture_product_event`, an invoker wrapper
around `private.consume_analytics_event`. Direct inserts by `anon` and
`authenticated` are revoked. The private definer function atomically reserves a
quota slot and inserts the event with the JWT user ID and database timestamp.
Clients cannot supply `user_id`, `id`, or `created_at`. Existing event-name,
length, and foreign-key constraints remain in force.

## Quotas

- Authenticated: 60 accepted events per user per one-minute window.
- Anonymous: 120 accepted events across all anonymous callers per one-minute window.
- The window starts with the first accepted event and renews when at least one
  minute has elapsed. Excess calls raise `P0001` / `RATE_LIMITED` without inserting.
- Quota reservation and event insertion roll back together on invalid input.
- A unique bucket and atomic UPSERT serialize competing calls. There is one
  anonymous bucket and at most one bucket per authenticated user; deleting an
  auth user also removes their quota row.

The anonymous cap is deliberately shared: direct PostgREST calls have no verified
session identity, and this repository does not establish a trusted client-IP
header at that boundary. Accepting an arbitrary header or client-chosen session
ID would allow quota bypass and unbounded quota rows. This conservative cap can
drop legitimate anonymous analytics during a traffic spike or abuse. If separate
anonymous quotas are needed, move ingestion behind an authenticated server/Edge
boundary that derives a trusted, hashed client IP; do not trust an RPC argument.

These are client-reported events, not authoritative evidence that a Pick or login
actually completed. Rate limiting bounds ingestion but does not prove event truth.

## Reads and rollout

Only admins with AAL2 can read the event table. The new migration uses
`ALTER POLICY` to retain that requirement (already introduced on main by
`20260919004417_require_mfa_for_product_analytics_select.sql`).

Apply the new migration before deploying the updated client. Older clients that
still use direct inserts lose analytics after the migration; the observability
service treats capture failures as best effort, so core actions still succeed.
No fallback to direct inserts is permitted.

`supabase/tests/067_product_analytics_hardening.sql` covers quota boundaries,
expiry using explicitly aged timestamps, independent user buckets, payload
constraints, database privileges, and AAL1/AAL2 reads. RPC quota cases use JWT
claims; role changes are limited to actual privilege/RLS boundary checks.
