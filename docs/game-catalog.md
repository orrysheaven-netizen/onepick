# Game catalog MVP

Status: source/CI preparation only. Do not deploy until Twitch/IGDB application credentials are created, stored as Supabase secrets, and live samples are verified.

## Scope
- Category: 콘텐츠 → 게임.
- Selectable unit: one IGDB Game record, not one platform-specific release.
- Identity: `external_source='igdb_game'` + numeric IGDB Game ID.
- Search excludes records with `version_parent`, which removes editions/versions such as collector editions.
- Remakes, remasters, DLC/expansions and other separately modeled IGDB games are not title-merged. If IGDB gives them a distinct game ID, OnePick keeps them distinct.
- Search never writes item rows. Only a user-selected IGDB Game ID is imported; import alone never creates a Pick.
- The normal `/pick/choose` flow collects the user's own one-line reason and saves the Pick.
- Imported shared metadata: title, first release year, primary developer/publisher fallback, platform list, IGDB URL and remote IGDB cover URL.

## Provider and credentials
IGDB uses Twitch application credentials. Create a Twitch Developer application with 2FA enabled and Client Type set to Confidential. IGDB does not use the OAuth redirect URL; its docs currently instruct using localhost when registering the app.

Store only these server-side Supabase secrets:
- `IGDB_CLIENT_ID`
- `IGDB_CLIENT_SECRET`

The Edge Function obtains a Twitch client-credentials access token itself and keeps the token in the existing service-role-only external catalog cache. No access token, client ID or client secret is sent to the Expo client.

IGDB does not support direct browser/mobile-JavaScript requests because that would expose the access token, so OnePick always calls it through the Supabase Edge Function.

## Rate/cache policy
IGDB documents 4 requests/second and at most 8 open requests. OnePick serializes provider starts at 650ms and uses a 5s IGDB timeout, plus:
- 6h exact search cache
- 24h selected-game detail cache
- 10m client exact-query cache
- 250ms client debounce

Provider cache and OAuth-token cache remain service-role-only.

## Images and attribution
IGDB supplies `cover.image_id`. OnePick constructs the documented `images.igdb.com` cover URL and stores only that remote URL; the image binary is not copied into OnePick Storage. IGDB notes that replaced/removed images remain for about 30 days, so future refresh/correction handling is still required.

IGDB's current docs say local storage/caching is allowed and preferred. Commercial/monetized integrations require the commercial partnership process and visible user-facing attribution to IGDB.com. Public monetization must not launch until that review is completed.

## Release gate
Before deployment:
1. Create the Twitch Developer application and IGDB credentials.
2. Store `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` as Supabase secrets. Do not put them in source, Expo public variables, URLs or chat.
3. Verify real samples: Korean/English search, same title across releases, remaster/remake, edition exclusion, platforms and cover URLs.
4. Verify token refresh, 401 retry, 429 behavior and concurrent-user perceived latency.
5. Re-run TypeScript, full regression suite, web export, DB tests and Edge Function checks.
6. Deploy migration + game-catalog Edge Function + app together.
