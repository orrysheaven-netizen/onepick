# Pokémon catalog

## Scope
- Category: 캐릭터 → 포켓몬.
- Selectable unit: one PokéAPI Pokémon species.
- Identity: numeric Pokémon Species ID under `external_source='pokeapi_species'`.
- Search never writes OnePick item rows; only a signed-in user's explicit selection imports one species.
- MVP visual validation displays PokéAPI's remote official-artwork URL. OnePick does not download or copy the image binary into OnePick Storage.
- User-uploaded OnePick photos remain higher-priority than the provider image fallback.
- Before any commercial/monetized launch, re-review Pokémon artwork copyright, character/trademark rights, PokéAPI terms, attribution needs, and whether remote artwork display may continue.

## Search architecture
PokéAPI REST does not provide localized free-text species search. The public GraphQL v1beta2 endpoint does, but it is beta and rate-limited.

OnePick therefore makes one GraphQL index request, caches the Korean/English species-name index for 24 hours, and performs subsequent searches locally in the Edge Function. If refresh fails, a cache up to 7 days old may be used as a temporary fallback.

Selected species details are fetched from the REST `/api/v2/pokemon-species/{id}/` endpoint and cached for 30 days. This follows PokéAPI's fair-use request to cache requested resources.

## Search
- Korean and English localized names.
- Numeric dex search such as `25` or `#25`.
- Exact, prefix, contains, then one-character typo-tolerant ranking for queries of 3+ characters.
- Up to 20 results.

## Import
- Requires a real Supabase user JWT.
- Reuses an existing imported species by external ID.
- Saves localized Korean name where available, English localized name as `original_name`, and the PokéAPI remote official-artwork URL as `image_source_url`.
- Existing Pokémon items are backfilled with the same remote artwork URL so previously selected Picks gain images without re-import.
- Continues through the standard OnePick `/pick/choose` one-line-review flow.

## Provider notes
Official docs checked 2026-09-19:
- REST API: no authentication; static hosting removed normal rate limiting, but clients are asked to limit request frequency.
- GraphQL v1beta2: beta, 100 calls/hour/IP, and fair-use requires local caching.
- Pokémon and Pokémon character names are Nintendo trademarks.
- PokéAPI's sprite repository states that image contents are Copyright The Pokémon Company; its CC0 text does not waive trademark rights and disclaims clearing third-party rights.

## Commercialization gate
Before enabling ads, subscriptions, affiliate revenue, sponsorships, paid features, or otherwise treating OnePick as a commercial launch:
1. Re-check current PokéAPI and PokeAPI/sprites terms.
2. Re-check The Pokémon Company/Nintendo copyright and trademark requirements for artwork/character display.
3. Decide whether to keep remote artwork, obtain permission/license, replace the provider, or remove the images.
4. Re-check attribution and caching/storage behavior.

This is a release blocker for commercialization, not for the current MVP feature-validation phase.

No API key or new secret is required.
