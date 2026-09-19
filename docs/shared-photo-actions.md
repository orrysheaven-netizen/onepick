# Existing-item photo actions

## Behavior
- A missing image on a saved, active/discontinued catalog item shows `사진 등록` in its image slot.
- Entry points: home, category TOP 3, common search, Pick search/selection, own/current/history profile and public profile cards. The item detail page has the actual upload form.
- Each entry opens the existing item detail route with `photo=1`, showing a compact empty hero and the shared upload section. It does not create a second upload screen or register a Pick.
- Guests are prompted to sign in; the validated `add_item_photo` intent returns to the same item after login/username setup.
- Selection is previewed and requires confirmation that it is the right product image and may be shared. Cancel and failure preserve existing data; retry preserves the selected file. Duplicate taps are blocked.
- Existing uploaded images and external posters hide the upload action. A load error is not treated as permission to overwrite.
- Draft products and unimported external catalog entries are not upload targets. New-item request photos retain the existing registration flow.
- Successful upload invalidates home, item/search, Pick, profile and exploration caches. The upload page immediately displays the returned saved item.

## Server contract
The additive migration `20260918003000_preserve_existing_item_images.sql` guards both `attach_item_photo_impl` and legacy `register_pick_impl` against replacing an external source image. Existing row locks, upload ownership/type/size checks and function permissions are preserved. Later contributors receive the first winner; unused losing uploads are removed by the existing service.

## Release state
This work is based on main. Hosting consolidation and the existing Cloudflare site release remain paused at the user's request. Do not report this as live on onepick-5cl.pages.dev until that exact site's deployment is verified. Do not apply the migration to the connected live DB during this preparation step.

The work branch's Vercel Git deployment is disabled in both possible project roots. Commit messages use the Cloudflare-only `[CF-Pages-Skip]` prefix; GitHub test workflows are not skipped. No extra site, DB or permanent parallel implementation is required.

## Tests
- `mobile/scripts/test-shared-photo-actions.cjs`: common visibility, exact navigation, login return, detail consent/cancel/retry, duplicate taps, item/account isolation, source-image service guards and shared cache invalidation.
- `supabase/tests/021_existing_item_images.sql`: first contribution, subsequent contributor, source poster protection through both public commands and anonymous denial.
- Run existing full regression, TypeScript, web/route checks and clean database migration tests before release. These are not actual iPhone file-picker or authenticated browser E2E checks.
