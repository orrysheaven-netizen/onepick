# MVP web deployment

Cloudflare Pages serves the tester site at https://onepick-5cl.pages.dev.
Project: `onepick`; production branch `main`; preview branch builds enabled.
Supabase Site URL and the two app callback patterns point to this origin.
See [배포 설정과 확인 기록](test-hosting.md) for the verified configuration and remaining device checks.

## Which branch the tester site is built from

`main`. The Cloudflare Pages production branch was switched to `main` on 2026-09-20,
after `feature/pick-core` was merged back into `main` (PR #128) and retired. Preview
branch builds are enabled, so every pull request gets its own URL.

A change is on the tester site once it is merged into `main` and the resulting Pages
build finishes. `https://onepick-5cl.pages.dev/deployment.json` shows which commit
and branch the site is currently serving; `branch` must be `main`.

Do not point Cloudflare at any branch other than `main`, and do not call another
branch the source of truth — that wording is what let `main` and the tester site
drift apart by 100+ commits before.

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
set these in the host's build environment **before** running `build:web:release`:

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

## Release preflight and output

Run from `mobile/` once the public settings are supplied:

```sh
npm run check:web:release-env
npm run build:web:release
npm run preview:web:release
```

`check:web:release-env` only checks configuration. `build:web:release` runs that
same check, exports to **`mobile/dist-release`**, then verifies the 10 direct
routes and the actual JS/CSS assets over a temporary loopback server. It exits
with a nonzero status if any stage fails. The release preview is available at
`http://127.0.0.1:4174`. Generated output is ignored by Git.

Release commands use Expo's production dotenv precedence (including
`.env.production.local` and `.env.local`); host-provided environment variables
take precedence. `EXPO_NO_DOTENV=1` disables local dotenv files when the host
supplies every setting. See [Expo environment variables](https://docs.expo.dev/guides/environment-variables/).

The preflight rejects missing settings, the CI `.invalid` URL/placeholder key,
local or example hosts, non-HTTPS URLs, URL credentials/query/fragments/subpaths,
and non-publishable keys. This release path requires a modern `sb_publishable_`
key; secret/service-role keys and legacy JWT keys are rejected. Error messages
identify variable names without printing their values. See
[Supabase API keys](https://supabase.com/docs/guides/api/api-keys).

These are **offline format checks**, not proof that a key belongs to the chosen
project, remains active, or that OAuth is configured. They do not contact
Supabase or modify data. Actual site/login verification below is still required.
The regular `build:web` / `check:web` pair continues to use `dist` for CI fixtures;
only deploy the successful release output built with the intended project's
public settings. Do not use `dist` from Mobile CI for publication.

## Hosting contract

The MVP uses Expo's `web.output: "single"`. New Picks, items and usernames are
resolved by the client router without a build for each newly created ID.
Serve existing JS, CSS and image files normally, then internally rewrite page
requests to `/index.html` with HTTP 200 while preserving the original URL/query.
Use HTTPS and host at the domain root. Do not redirect all URLs to `/` with 301/302.

- Cloudflare Pages uses its built-in SPA fallback when no top-level `404.html`
  exists. `_redirects` deliberately contains comments only: a catch-all Pages
  rewrite also matches existing JS/CSS/image assets and must not be used here.
- On other hosts (including Netlify), configure the provider's equivalent SPA
  fallback after existing files. Do not assume identical `_redirects` behavior.
- `_headers` requests `noindex` for Pages test/preview domains. This is crawler
  guidance, not an access restriction. Local `serve` does not interpret this
  provider-specific file; verify its actual response header after hosting.
- `_headers` also sets the Content-Security-Policy. Its `img-src` allowlist must
  name every external host that catalog Edge Functions store in
  `image_source_url` (TMDB, IGDB, Cover Art Archive and its `archive.org`
  redirect targets, PokeAPI sprites on `raw.githubusercontent.com`, YouTube
  thumbnails on `ytimg.com` / channel avatars on `yt3.ggpht.com`). Adding a
  catalog with a new image host requires extending that directive, otherwise the
  browser blocks the images with a CSP violation.
- `img-src` must also keep `blob:`. On web, `expo-image-picker` returns the
  chosen file as a `blob:` object URL and `expo-image-manipulator` decodes it
  through an `<img>` element; without `blob:` every photo upload fails as
  `PHOTO_INVALID` ("이미지를 읽지 못했어요"). `npm run check:web` asserts it.
- Set the project/root directory to `mobile`, install with `npm ci`, build with
  `npm run build:web:release`, and publish `dist-release` relative to that root.
- Revalidate HTML on new releases; avoid long-lived caching of `index.html`.

The SPA choice does not generate per-Pick search-engine/social-preview HTML.
Rich link previews and server rendering are separate follow-up work.

References: [Expo web publishing](https://docs.expo.dev/guides/publishing-websites/),
[Expo static rendering](https://docs.expo.dev/router/web/static-rendering/),
[Pages SPA defaults](https://developers.cloudflare.com/pages/configuration/serving-pages/),
[Pages redirects](https://developers.cloudflare.com/pages/configuration/redirects/).

## OAuth and sharing on the chosen domain

Once the domain is decided, set the Supabase Auth Site URL to its HTTPS origin and
allow the app's `/auth/callback` URL. OnePick adds return-intent query parameters;
verify both the bare callback and a callback with `action`/`itemId` on that
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
real public settings. Regression tests also check release preflight failures,
production dotenv precedence, host overrides and redacted error output without
contacting the live database.

Before inviting testers, verify on the actual HTTPS deployment:

- Open an item, Pick and public profile link directly in a fresh browser and
  reload each page. A newly created item must work without rebuilding.
- Complete Kakao login from both Home and an item action and return to the
  expected screen. Test sign-out and a second account separately.
- Submit a photo/request, approve it in Admin, and select the approved item.
- Share a Pick/profile and open the copied HTTPS link on another device.
- Confirm private routes request login and unavailable content shows its normal
  error state. Check network failures and refresh recovery.
- Retain the previous working deployment for rollback. Review and merge the
  release through PR #1 after the agreed checks pass.

Hosting, exact test URL configuration and an existing Kakao account's authenticated
browser flow were verified on 2026-09-17. First signup with a different Kakao account
and physical device photo/share flows remain to be checked by a participant.
