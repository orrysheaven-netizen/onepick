# Pokémon catalog

## Scope
- Category: 캐릭터 → 포켓몬.
- Selectable unit: one PokéAPI Pokémon species.
- Identity: numeric Pokémon Species ID under `external_source='pokeapi_species'`.
- Search never writes OnePick item rows; only a signed-in user's explicit selection imports one species.
- No automatic Pokémon artwork/sprites are used in OnePick. PokéAPI notes that Pokémon and Pokémon character names are Nintendo trademarks, so this MVP keeps imagery user-contributed/blank rather than copying official sprites.

## Search architecture
PokéAPI REST does not provide localized free-text species search. The public GraphQL v1beta2 endpoint does, but it is beta and rate-limited.

OnePick therefore makes one GraphQL index request, caches the Korean/English species-name index for 24 hours, and performs subsequent searches locally in the Edge Function. If refresh fails, a cache up to 7 days old may be used as a temporary fallback.

Selected species details are fetched from the REST `/api/v2/pokemon-species/{id}/` endpoint and cached for 30 days. This follows PokéAPI's fair-use request to cache requested resources.

## Search
- Korean and English localized names.
- Numeric dex search such as `25` or `#25`.
- Exact, prefix, then contains ranking.
- Up to 20 results.

## Import
- Requires a real Supabase user JWT.
- Reuses an existing imported species by external ID.
- Saves localized Korean name where available, English localized name as `original_name`, and no provider image URL.
- Continues through the standard OnePick `/pick/choose` one-line-review flow.

## Provider notes
Official docs checked 2026-09-19:
- REST API: no authentication; static hosting removed normal rate limiting, but clients are asked to limit request frequency.
- GraphQL v1beta2: beta, 100 calls/hour/IP, and fair-use requires local caching.
- Pokémon and Pokémon character names are Nintendo trademarks.

No API key or new secret is required.
