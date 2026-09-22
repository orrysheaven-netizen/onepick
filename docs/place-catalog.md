# Place catalog foundation

Restaurant place ingestion keeps provider-scale records outside `items` and outside the canonical `places` table.

## Layers

1. `private.place_import_raw`: service-role-only staging for provider payloads.
2. `public.place_catalog`: searchable provider-scale catalog. Public clients only see open businesses.
3. `public.places`: canonical OnePick place identity created only when a place is actually selected/approved.
4. `public.item_places` + `public.items`: category-specific OnePick candidates.

A catalog record never creates an item or pick by itself.

## Provider identity

`(place_provider, provider_place_id)` is the stable catalog key. Names and addresses are metadata and never deduplication keys.

Closed businesses are retained with `business_status='closed'`; import code never deletes them.

## Import contract

The importer writes normalized provider payloads to `private.place_import_raw` with these JSON keys:

- name
- branch_name
- road_address
- address
- region_1
- region_2
- latitude / longitude (WGS84)
- provider_category
- business_status: open or closed

`source_updated_at` is stored as a real staging column and controls last-write-wins promotion. Older provider rows cannot overwrite newer catalog state.

Coordinate-system conversion belongs at the provider adapter boundary. LOCALDATA's source CRS must be confirmed from the actual downloaded specification before the adapter converts it to WGS84. PostGIS is enabled for that adapter work, but this foundation migration does not guess an EPSG code.

## Category rule

Provider categories are retained verbatim in `provider_category`. The catalog does not assign a single OnePick category because one physical restaurant may be eligible for multiple leaf categories. Category selection happens when a canonical place-backed item is created.

## Next PR

The next PR adds the LOCALDATA Edge Function, incremental windows/checkpoints, anomaly detection, bootstrap tooling, and scheduled GitHub Actions invocation.
