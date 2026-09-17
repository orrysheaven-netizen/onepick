# Security review — 2026-09-17

## Verified in this pass

- npm audit, including development dependencies: 0 known advisories (698 total dependencies reported). This is a point-in-time dependency check, not a full security assessment.
- Auth return, auth session and safety regression scripts passed. They cover malformed return parameters, session races, logout/cache cleanup and block/report validation.
- Web export succeeded. Export validation passed for 10 direct routes, 2 assets, callback query and SPA fallback.
- Earlier rollback-only database lifecycle checks are recorded in `two-user-validation.md`. They do not substitute for browser/account testing.

## Change

Added Cloudflare Pages static response headers: nosniff, frame embedding denial, restricted base/object sources and strict-origin-when-cross-origin referrer policy. The CSP intentionally does not yet restrict scripts, styles or network destinations; it is not a complete XSS defense.

Reference: https://developers.cloudflare.com/pages/configuration/headers/

The export contains the updated `_headers` file. Local `serve` does not apply these Cloudflare rules. No hosted deployment or live response-header verification was performed. Verify headers and Kakao login on the actual HTTPS deployment before release; Pages Functions need their own response headers if added later.

## Remaining release checks

- Verify administrator MFA enforcement and recovery on the deployed service.
- Comment/report quotas were subsequently applied and verified below. Local migrations also contain daily item submission limits and an image import quota; high-concurrency load testing remains outstanding.
- Supabase's previous advisor check reported leaked-password protection disabled. Review if password login is enabled; Kakao login alone does not validate this setting.
- Native login persistence currently uses AsyncStorage. Review secure credential storage before a native release. Web localStorage sessions still require XSS prevention.
- Validate backup restoration and deployed HTTPS/security headers.

No remote database schema, auth settings or access policies were changed in this pass. The pending uncategorized-request migration remains unapplied and is excluded from this change.

## Follow-up: community writes (2026-09-17)

Applied `20260917110856_limit_comment_and_report_writes.sql` to onepick-dev. Successful comment creation and body changes share a per-account quota of 10 writes per minute; new reports allow 10 per hour. Windows start with the first successful write, rather than at a calendar minute/hour boundary. Failed writes roll back the quota too. Deleting content does not reset it. Limits are per account, not per IP; they do not prevent account-farming or general network flooding.

The private quota table has two rows at most per account and cascades on account deletion. Clients have no table or function permissions. The trigger validates the signed-in actor, uses an empty search path, and leaves existing ownership/moderation rules in place. A conditional atomic upsert serializes writes to the same account/action. The advisor reports a no-policy INFO for this intentionally inaccessible private table; no client policy should be added merely to silence it.

Rollback-only SQL assertions passed before and after deployment: the 11th comment/report is rejected, edits consume the comment quota, unchanged bodies do not, another user has a separate quota, duplicates remain rejected, deletion cannot restore quota, clients cannot read/reset counters, and an expired window allows new writes. No concurrent-session load test was run. Fixture accounts/content were rolled back.

The report UI now guards rapid repeated taps synchronously and prevents resetting an in-flight submission. Comments/reports display a specific wait-and-retry message when the server returns RATE_LIMITED. Type checking, safety and interaction regression scripts, and web export passed.

Read-only inspection confirms the deployed administrator check uses the private allowlist, but does not require MFA assurance. MFA enrollment/recovery and enforcement remain a separate release task; no administrator login settings were changed. Leaked-password protection remains disabled. The unrelated uncategorized-request migration remains unapplied.
