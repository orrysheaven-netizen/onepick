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
- Review atomic rate limits for comments/reports. Local migrations contain daily item submission limits and an image import quota; this pass did not load-test or verify deployed concurrency behavior.
- Supabase's previous advisor check reported leaked-password protection disabled. Review if password login is enabled; Kakao login alone does not validate this setting.
- Native login persistence currently uses AsyncStorage. Review secure credential storage before a native release. Web localStorage sessions still require XSS prevention.
- Validate backup restoration and deployed HTTPS/security headers.

No remote database schema, auth settings or access policies were changed in this pass. The pending uncategorized-request migration remains unapplied and is excluded from this change.
