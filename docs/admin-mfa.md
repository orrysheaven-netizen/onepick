# Administrator MFA enrollment

## Current stage

The `/auth/admin-security` page is linked from the administrator screen. It supports TOTP enrollment by QR/manual key, six-digit verification, selecting an existing verified authenticator, and cancelling unverified enrollments. Opening the page only reads state; creating a factor requires pressing Register. Secrets are held in screen memory, excluded from query caches/logs/storage and rendered without image caching. No recovery codes are generated and no verified factors can be removed by this UI.

This is enrollment preparation, **not server-side MFA enforcement**. Existing administrator authorization still uses the private allowlist. No auth settings, administrator memberships or factors were changed by the coding agent. Real enrollment requires the account owner and their authenticator. Tests mock the Auth API and do not prove a real device enrollment.

Reference: https://supabase.com/docs/guides/auth/auth-mfa/totp

## Activation sequence

1. Have the administrator register their authenticator and verify a real code on this page. Check backup/restore of the chosen authenticator before removing or replacing a device.
2. Prepare a separate membership-only enrollment check. The current enrollment service calls `current_user_is_admin`; once its underlying check requires AAL2 this call must be replaced, or users with AAL1 would be locked out of enrollment/challenge.
3. Add a guard covering all administrator routes and enforce AAL2 on the server's administrator authorization. UI redirects alone are bypassable. Review policy/function call sites, and add rollback-only tests for an allowlisted AAL1 user, allowlisted AAL2 user, ordinary AAL2 user and anonymous caller. Update existing administrator fixtures to explicitly model AAL2.
4. Verify login, enrollment, expired-session challenge, permission revocation and recovery with real accounts before public release. Do not claim enforcement until this phase is deployed and verified.

## Lost-device recovery runbook (manual, project owner only)

- First try the authenticator's own backup/restore or another already verified factor.
- If unavailable, an authorized Supabase project owner must independently verify the administrator's identity. A request from a logged-in first-factor session alone is not sufficient proof.
- Before resetting factors, suspend the affected account's administrator membership and revoke its sessions through the supported administrative APIs/dashboard. Do not rely solely on deleting a factor to revoke existing access tokens.
- Use the supported Supabase Auth factor administration facility for the confirmed user, not direct deletion of Auth schema rows. Record the actor, account ID, time and reason without passwords, seeds, QR codes or OTPs.
- Require fresh login and new verified enrollment before restoring administrator membership. Confirm server AAL2 checks and session behavior. Do not expose this privileged reset as a public RPC or client-side service-key operation.
- These steps are documented, not executed or validated end-to-end in this stage. No project-owner recovery credentials are stored in the application.
