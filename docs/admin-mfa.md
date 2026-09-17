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

## Email-less Kakao enrollment prerequisite

The first real enrollment attempt failed before producing a factor. Read-only inspection showed the administrator has no Auth email, no confirmed email and zero TOTP factors. Kakao sign-in intentionally requests only profile_nickname. Upstream Supabase Auth TOTP enrollment passes the account email to the OTP generator; empty-email accounts cannot complete that generation path. The generic error handler initially hid this prerequisite. The captured SDK error had no structured code; no server log or raw error body was available, so other provider-side errors have not been ruled out.

The screen now checks a server-verified user for a confirmed email before enabling enrollment. It offers email linking through `auth.updateUser`, only after the user enters an address and presses Send confirmation email. It refuses to replace an existing email. The confirmation link returns through the existing auth callback; the user then returns to this screen and refreshes status. Sending mail does not count as confirming it. Confirmation delivery, callbacks and real-device enrollment still require the user and have not been verified end-to-end. SMTP restrictions/rate limits are reported without showing raw Auth error payloads.

Regression coverage includes missing/unconfirmed email, invalid addresses, no email replacement, mail-provider rejection, and sanitized enrollment errors. No email was invented or written directly to the Auth database, and email verification was not bypassed.

References: https://github.com/supabase/auth/blob/master/internal/api/mfa.go and https://supabase.com/docs/reference/javascript/auth-updateuser
