# Commercialization rights gate

This checklist is a release blocker before OnePick moves from MVP validation into monetized/commercial operation.

## Trigger
Run this review before enabling any of the following:
- advertising
- subscriptions or paid features
- affiliate revenue
- sponsorships or brand partnerships
- paid API/data redistribution
- any launch that materially changes OnePick into a commercial service

## Provider review
Re-check the current terms, attribution, caching, image reuse, trademark, and commercial-use requirements for every external catalog used at that time, including:
- TMDB
- MusicBrainz
- IGDB
- YouTube Data API
- PokéAPI / PokeAPI sprites
- National Library of Korea book data, once enabled
- any provider added later

## Pokémon-specific gate
The MVP may display PokéAPI official-artwork as a remote URL for feature validation. Before commercialization:
1. Re-check PokéAPI and PokeAPI/sprites terms.
2. Re-check The Pokémon Company / Nintendo copyright and trademark requirements for artwork and character display.
3. Decide whether to keep remote artwork, obtain permission/license, replace the image source, or remove provider artwork.
4. Re-check attribution requirements.
5. Confirm OnePick still does not copy provider image binaries into Storage unless the rights review explicitly permits it.

The MVP image decision is not approval for commercial use.
