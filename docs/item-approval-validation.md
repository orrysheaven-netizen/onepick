# Item approval verification

Verified on 2026-09-17 against `onepick-dev` and covered by
`supabase/tests/008_item_approval_flow.sql`.

## Database lifecycle

The test creates three isolated fixture accounts: two ordinary submitters and one
allowlisted administrator. The administrator creates a new selectable category,
so the test does not depend on the initial category list or existing user Picks.

The same flow exercises real RPCs and RLS using `authenticated` and `anon` roles:

- New submissions stay pending; repeated own submissions reuse the same request.
- A request does not create a Pick.
- Submitters cannot approve their own requests or directly insert active items.
- Other users cannot see a private pending request.
- An administrator can approve, merge or reject pending requests.
- An outdated moderation update with `status = pending` cannot overwrite an approval.
- Pending, merged and rejected items cannot be selected as Picks.
- Submitters can read their approval, merge target and rejection results.
- Repeated selection of the same approved item updates the review and retains one current Pick.
- Two users can select one shared `item_id` with independent reviews.
- Later submissions reuse the approved item instead of creating another master.
- Anonymous users can discover approved items and public Picks, without seeing moderated request rows.

All fixture writes run inside a transaction that is rolled back. The hosted smoke
check executes the test's `DO $flow$` body with assertions enabled; it does not
install pgTAP, create schema objects, mint login tokens or change browser sessions.
After the hosted run, the fixture user/category/item/Pick counts were zero and
the existing `onepick_qa` Pick was unchanged.

The pgTAP wrapper runs the same body in Database CI and reports the failing
assertion if the lifecycle regresses. Mobile CI separately covers request
confirmation routes, refreshed approval status, canonical merge destinations,
error recovery and hiding cached requests after logout.

## Browser verification boundary

The web flow has been checked through item search and missing-item request
entry, including preservation of the search name and selected category. The
authenticated request → Admin approval → Pick selection browser flow still
requires the user to finish Kakao login. Database role tests do not substitute
for that browser authentication or for iOS/Android device testing.
