# Shared product registration

Users enter a product name, select an existing suggestion or add a new name/type, and leave a review. An image is optional. Picks refer to one product image pair: a representative image and a smaller thumbnail.

## Identity rules

| Category | Same product | Separate products |
| --- | --- | --- |
| Ramen | Bag/cup, package size and quantity | Taste or product line |
| Beer / soju | Can/bottle, volume and quantity | Product line, nonalcoholic variant |
| Snacks | Package weight and quantity | Taste or product line |

The initial selectable categories are ramen, beer, soju and snacks. Alcohol is a non-selectable parent of beer and soju. Existing products are reused after whitespace/case normalization and the category rules above. This is not semantic alias resolution: brand prefixes, misspellings and alternative names may still require later moderation.

## Images

- Existing product images are reused; registering another pick cannot overwrite them.
- Missing images can be imported from the exact manufacturer hosts listed in `imageImport.ts`, or selected locally.
- Imported images are previewed before registration. A public URL does not itself confer reuse permission.
- JPEG/PNG imports have a 2 MiB download limit, 16 megapixel limit, HTTPS host allowlist, validated redirects, and no forwarded user credentials. HTML pages are limited to 512 KiB.
- Both imported and local photos are converted to JPEG on the device: up to 1200 px / 768 KiB for the representative image and 320 px / 96 KiB for the thumbnail.
- Only the two optimized images are uploaded. Original image bytes and base64 are not stored in database rows.
- Images are public and immutable. The product row stores object paths and an optional source URL.
- A successful registration attempts to remove uploads that lost a concurrent race; storage policies protect referenced images, including images used by hidden products.
- Before a later upload, the client attempts to clean unreferenced uploads older than 24 hours among its oldest 100 files. This is best-effort cleanup, not a scheduled garbage collector.
- Storage insertion checks recent retained uploads (20 objects per user/day); registration limits new products to 20 per user/day. The image-import quota is an atomic 10 requests per user/hour.
- For 10,000 illustrated products, maximum image bytes are about 8.24 GiB before storage overhead. Adding users or picks for the same products does not add another image pair. Image delivery bandwidth remains a separate scaling consideration.

## Server rollout

The migration `20260916221838_add_shared_product_registration.sql` adds three nullable product fields, indexes, the initial categories, a public `product-photos` bucket with authenticated upload policies, a protected private quota table, and authenticated registration/import quota functions. It does not change existing pick rows. Its filename matches the version recorded by the hosted migration service when applied to `onepick-dev`.

1. Apply the reviewed migration to the intended Supabase project.
2. Deploy `import-product-image` with JWT verification enabled. The handler additionally validates the authenticated user and consumes the per-user quota.
3. Refresh generated database types and run the security advisors.
4. Verify image-free registration, image import/upload, thumbnail delivery and cross-user reuse with disposable test accounts. Preserve existing real picks.

The mobile flow uses Screen → Hook → Service → Repository → Supabase. The Edge Function is the authenticated server boundary for outbound image fetching. No service-role credential is used.

## Validation

`npm run typecheck` and `npm test` cover the app and registration/import regressions. Database Tests applies all migrations to a disposable CI database and runs the pgTAP tests, including product deduplication, optional images, shared-image ownership/protection, rollback, distinct tastes and the import quota. The workflow also runs `deno check` for the Edge Function.

A JavaScript export covers web, Android and iOS routing/bundling. It does not substitute for a physical-device test, a Hermes/native build, or the post-rollout end-to-end upload test.

## onepick-dev rollout — 2026-09-17 KST

- Applied migration `20260916221838`; deployed `import-product-image` version 1 with JWT verification enabled.
- Verified all four selectable categories, the non-selectable alcohol parent, and the public JPEG bucket with its file-size limit.
- A transaction on the hosted database verified image-free registration, quantity normalization/reuse and rejection of missing image objects. All test writes were rolled back. The existing real pick and review were unchanged.
- The deployed HTTP endpoint returned 204 for browser preflight and 401 for missing/invalid user sessions.
- Refreshed generated database types. A separate type override preserves PostgreSQL's nullable `p_product_id` input, which generated RPC types cannot infer.
- Security advisors reported an intentionally closed private quota table ([RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)) and the existing [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) setting. No client permissions were added to the quota table. Unused-index notices require no action for this rollout.
- Authenticated image fetching and upload in the browser remain unverified after deployment: the previously authenticated Chrome browser was no longer connected. No real pick was changed for testing.
