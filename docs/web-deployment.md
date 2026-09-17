# MVP web deployment

Source of truth: `orrysheaven-netizen/onepick`, branch `feature/pick-core`, Draft PR #1.
Hosting provider and public domain have not been selected. The changes here prepare
and verify the build; they do not publish a site or change OAuth provider settings.

## Build and preview

Use Node 22.13.1 or a compatible supported version. Run from `mobile/`:

```sh
npm ci
npm run typecheck
npm test
npm run build:web
npm run check:web
npm run preview:web
```

The build output is `mobile/dist`. Preview runs at `http://127.0.0.1:4173`.
`dist` is generated and ignored by Git; source and the lockfile stay in GitHub.
The pinned `serve` development dependency is used only for local/CI verification.

## Build-time environment

For local builds, fill `mobile/.env.local` from `.env.example`. For hosted builds,
set these in the host's build environment **before** running `build:web`:

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | The selected Supabase project's HTTPS URL |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | That project's public publishable key |
| `EXPO_PUBLIC_SHARE_BASE_URL` | Optional canonical HTTPS origin, with no subpath |

Public variables are included in browser JavaScript. Never put a service-role key,
database password, Kakao secret or private credential in them. Rebuild after a
configuration change. Web shares default to the current origin, so preview links
remain on the preview site; native shares retain `onepick://` unless a canonical
web origin is configured. A native release should set the public web origin once
it is available, so people without the app can open shared links.

## Hosting contract

The MVP uses Expo's `web.output: "single"`. New Picks, products and usernames are
resolved by the client router without a build for each newly created ID.
Serve existing JS, CSS and image files normally, then internally rewrite page
requests to `/index.html` with HTTP 200 while preserving the original URL/query.
Use HTTPS and host at the domain root. Do not redirect all URLs to `/` with 301/302.

- Hosts supporting `_redirects` can use the file copied from `mobile/public/`.
- On other hosts, configure an equivalent SPA fallback after existing files.
- Set the project/root directory to `mobile`, install with `npm ci`, build with
  `npm run build:web`, and publish `dist` relative to that root.
- Revalidate HTML on new releases; avoid long-lived caching of `index.html`.

The SPA choice does not generate per-Pick search-engine/social-preview HTML.
Rich link previews and server rendering are separate follow-up work.

References: [Expo web publishing](https://docs.expo.dev/guides/publishing-websites/),
[Expo static rendering](https://docs.expo.dev/router/web/static-rendering/).

## OAuth and sharing on the chosen domain

Once the domain is decided, set the Supabase Auth Site URL to its HTTPS origin and
allow the app's `/auth/callback` URL. OnePick adds return-intent query parameters;
verify both the bare callback and a callback with `action`/`productId` on that
exact host. Keep preview allowances specific to previews the team controls.

Kakao's provider callback is a separate URL: use the Supabase Auth callback shown
for that project (`https://<project-ref>.supabase.co/auth/v1/callback`). Do not
replace it with the app's `/auth/callback`. Existing nickname-only scope is kept.

References: [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls),
[Kakao provider setup](https://supabase.com/docs/guides/auth/social-login/auth-kakao).

## CI and release verification

Mobile CI now has a `web-build` job in addition to typecheck/regression tests. It
uses intentionally non-working CI-only Supabase values, exports the production
bundle, and checks 10 direct routes and the referenced assets over a loopback
HTTP server. It does not execute browser JavaScript or access the live database.
Do not deploy a CI fixture build; the host must build with the selected project's
real public settings.

Before inviting testers, verify on the actual HTTPS deployment:

- Open a product, Pick and public profile link directly in a fresh browser and
  reload each page. A newly created item must work without rebuilding.
- Complete Kakao login from both Home and a product action and return to the
  expected screen. Test sign-out and a second account separately.
- Submit a photo/request, approve it in Admin, and select the approved product.
- Share a Pick/profile and open the copied HTTPS link on another device.
- Confirm private routes request login and unavailable content shows its normal
  error state. Check network failures and refresh recovery.
- Retain the previous working deployment for rollback. Review and merge the
  release through PR #1 after the agreed checks pass.

Actual hosting, domain configuration, authenticated browser flow and physical
device verification remain pending until those environments are available.
