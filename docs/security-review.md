# Security review — current status (2026-09-19)

## Current verified state

- **Administrator MFA is server-enforced.** The live `onepick-dev` database has `20260918155548_require_admin_mfa` applied. `private.is_admin_mfa()` requires both the private administrator allowlist and JWT `aal2`. Administrator RLS policies use that gate, and the exposed administrator `SECURITY DEFINER` RPCs re-check it internally. A rollback-only request-context check returned `false` for an allowlisted administrator at AAL1 and `true` at AAL2. The earlier 2026-09-17 note that MFA was not enforced is superseded.
- **TMDB movie/drama search abuse protection is deployed.** PR #31 added a 10-minute server cache and the shared provider request-slot limiter while keeping search public. Movie import now authenticates before any TMDB request and rejects suspended users consistently with drama import. The deployed `movie-catalog` v13 matches `main`; live smoke checks returned 200 for movie/drama search, reused cache on repeat search, and returned 401 for unauthenticated import without consuming a TMDB request slot.
- **Leaked-password protection remains disabled because the current Supabase organization is on the Free plan.** Supabase exposes this feature on paid plans; enable it when the project moves to a plan that supports it rather than treating it as a currently available dashboard toggle.
- **Native session hardening is prepared but not merged.** PR #37 replaces plaintext native Supabase session storage with the Supabase-recommended large encrypted storage pattern: a random AES-256 key in Expo SecureStore and encrypted session bytes in AsyncStorage. The PR also clears legacy plaintext values when no SecureStore key exists. It remains open until Mobile CI/typecheck can execute or a real-device check is completed.
- **The CSP is intentionally partial.** `_headers` currently enforces frame denial, `base-uri 'self'`, `object-src 'none'`, nosniff and a strict referrer policy. `script-src`, `style-src`, `connect-src` and a narrowed image policy are not yet enforced because the exported Expo web bundle and all catalog/image origins need live validation before tightening them.
- **GitHub-hosted Actions are currently blocked before runner assignment.** Recent unrelated `main` and PR jobs end with `runner_id=0` and no steps. PR #35 reduced duplicate Actions usage without reducing substantive checks, but it does not resolve the account-level runner block. Check GitHub Actions usage/budget or other account-level runner restrictions before relying on CI results.

## Remaining release checks

- Restore GitHub-hosted CI execution, then run Mobile CI, Web build and Database Tests on the current `main` and PR #37.
- Verify Kakao OAuth callback behavior in a real HTTPS browser session.
- Perform physical iOS/Android login/session persistence testing before native release; merge PR #37 only after that or equivalent CI/typecheck verification.
- Perform a backup/restore rehearsal appropriate to the final Supabase production plan.
- Verify actual HTTPS response headers on the Cloudflare Pages test host, then tighten CSP incrementally with an allowlist for the Supabase project and catalog image origins.
- Run high-concurrency tests for community/item quota paths before treating the rate limits as load-tested.

---

# Historical security review — 2026-09-17

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

At the time of this 2026-09-17 pass, read-only inspection found an administrator check that used only the private allowlist and did not yet require MFA assurance. This observation is **historical and superseded** by the current-status verification above after `require_admin_mfa` was applied. Leaked-password protection was also disabled at this time.
