# Place catalog foundation

Provider-scale restaurant records stay separate from both generic `items` and the canonical OnePick `places` table.

## Layers

1. `private.place_import_raw`: service-role-only staging for provider payloads.
2. `private.place_import_runs`: import/checkpoint log.
3. `public.place_catalog`: searchable provider-scale catalog. Normal users only see open businesses.
4. `public.places`: canonical OnePick identity created when a place is selected or approved.
5. `public.item_places + public.items`: category-specific OnePick candidates.

A catalog row never creates an item, canonical place, or Pick by itself.

## Identity rule

`(place_provider, provider_place_id)` is the duplicate key **inside one provider namespace**.

It is not OnePick's permanent identity.

This distinction matters because provider identifiers can change across source revisions. SBIZ has previously regenerated its store identifier, making historical linkage impossible across that change. Therefore:

- OnePick permanent identity: `public.places.id`
- provider catalog identity: `place_provider + provider_place_id`
- names and addresses: matching metadata, never sole identity
- source-ID change: reconcile to the existing `places.id` using address/coordinates/name and admin review when ambiguous

Closed businesses remain in `place_catalog` as `business_status='closed'`; imports do not hard-delete them.

## Import contract

Provider adapters write normalized payloads to `private.place_import_raw`.

Payload keys:

- `name`
- `branch_name`
- `road_address`
- `address`
- `region_1`
- `region_2`
- `latitude / longitude` in WGS84
- `provider_category`
- `business_status`: `open | closed`

`source_updated_at` is a real staging column and controls last-write-wins promotion. Older provider rows cannot overwrite newer catalog state.

The promotion function is `SECURITY DEFINER` in the private schema because staging is not directly exposed. Caller authorization is enforced by PostgreSQL EXECUTE ACL: only `service_role` receives EXECUTE. Do not use `current_user` inside that function to detect the caller because SECURITY DEFINER changes `current_user` to the function owner.

## Provider adapters

### SBIZ

First bootstrap source.

- provider: `sbiz`
- provider ID: current dataset's 상가업소번호
- current official data includes store name, address, category, longitude and latitude
- the source ID is provider-scoped, not permanently stable across every historical dataset revision

The first adapter should read an SBIZ Seoul sample, validate required columns, and stage rows only. It must not write `places`, `items`, or `picks`.

### LOCALDATA

Secondary verification/freshness source.

The official 전국일반음식점 standard data currently documents source coordinates as EPSG:5174. The adapter must convert EPSG:5174 to WGS84 before writing the staging payload.

This foundation does not enable PostGIS yet. Coordinate conversion belongs in the adapter implementation; if PostGIS is chosen later, enable it in the migration that actually uses it.

## Category rule

Provider categories are retained verbatim in `provider_category`.

They do not automatically assign one OnePick leaf because a single physical restaurant may be eligible for several leaves, for example:

```text
OO곱창 강남점
  ├─ 곱창
  ├─ 대창
  └─ 곱창전골
```

Category selection happens only when a canonical place-backed item is created.

## Public read contract

- anon/authenticated: SELECT open `place_catalog` rows only
- authenticated MFA admin: may also read closed rows
- no normal client INSERT/UPDATE/DELETE
- raw staging/run tables: no anon/authenticated access
- promotion: service_role only

Explicit grants are part of the migration; RLS is not treated as a substitute for grants.

## Next implementation

1. SBIZ file adapter + deterministic validation report
2. bootstrap a Seoul sample into `place_import_raw`
3. promote to `place_catalog`
4. measure missing addresses/coordinates, provider-ID duplicates and category coverage
5. LOCALDATA EPSG:5174 adapter and cross-check
6. admin catalog→canonical place approval workflow
7. user place-search provider integration
