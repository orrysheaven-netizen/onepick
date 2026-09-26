# Place catalog foundation

Provider-scale restaurant records stay separate from both generic `items` and the canonical OnePick `places` table.


## Current coverage (2026-09-26)

**매장 (place) search covers Seoul and Gyeonggi restaurants**: SBIZ 상가(상권)정보
2026-06-30, 상권업종대분류명=음식 — 서울특별시 141,126 + 경기도 185,804 open rows.
Other regions cannot be selected yet; users see "매장 등록은 현재 서울·경기 음식점만
가능해요" and can send a store request instead. The app copy comes from
`PLACE_COVERAGE_REGIONS` in `mobile/src/lib/items/pickChannel.ts` — update it together
with each new region load.

Gyeonggi was staged with `supabase db query --linked -f` (Management API, no DB
password) in 93 files of 4×500 rows, then `select private.promote_place_imports('sbiz')`.
Rows with the same `source_updated_at` are not rewritten, so re-promoting leaves Seoul
untouched.

Size (free plan, 500 MB database limit): before Gyeonggi the database was 162 MB
(`place_catalog` ≈0.49 KB/row, `private.place_import_raw` ≈0.53 KB/row); Seoul +
Gyeonggi is estimated at ≈350 MB. Remaining regions (음식 rows): 인천 40,973;
nationwide 840,255 would need the Pro plan (8 GB disk).

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


## SBIZ Seoul food bootstrap

The first production bootstrap is intentionally limited to **Seoul + the SBIZ large
category `음식`**. Nationwide import is a separate change.

1. Normalize and measure the reviewed source snapshot:

```bash
python tools/sbiz_place_adapter.py <SBIZ_SEOUL_CSV> \
  --output tmp/sbiz-seoul-food.jsonl \
  --report tmp/sbiz-seoul-food-report.json \
  --source-updated-at <SOURCE_SNAPSHOT_TIMESTAMP> \
  --region-1 서울특별시 \
  --large-category 음식
```

The report records the source SHA-256, scanned/in-scope/accepted counts, missing
address/region/category/coordinate counts, duplicate provider IDs, dropped
duplicate rows, and identity-churn collisions. Review this report before any DB
write. Do not use `--force` to bypass a failed quality gate.

2. Validate the load plan without connecting:

```bash
python tools/load_place_import_jsonl.py tmp/sbiz-seoul-food.jsonl --dry-run
```

3. Stage the reviewed JSONL. Keep the database connection URL only in the local
environment; never commit it or a service-role key.

```bash
export SUPABASE_DB_URL='<Supabase database connection URL>'
python tools/load_place_import_jsonl.py tmp/sbiz-seoul-food.jsonl
```

The URL is split into libpq variables (`PGHOST`, `PGUSER`, `PGPASSWORD`, …) and
never placed in argv. psql does not expand a URL given through `PGDATABASE`, so
do not rely on that. Remote hosts default to `sslmode=require`.

Without a local `psql`, run the container's psql instead; variables are
forwarded by name only:

```bash
python tools/load_place_import_jsonl.py tmp/sbiz-seoul-food.jsonl --psql-docker supabase_db_onepick
```

The loader uses `SET ROLE service_role` and calls the existing
`private.stage_place_import_batch(...)` function in batches of at most 500.
Each execution creates and finishes a row in `private.place_import_runs`.
Replaying the same provider ID + source timestamp is idempotent.

4. After the staging counts and report are reviewed, promote:

```bash
python tools/load_place_import_jsonl.py tmp/sbiz-seoul-food.jsonl --promote
```

The `--promote` path calls:

```sql
select private.promote_place_imports('sbiz');
```

Re-running the same snapshot is safe: staging reports the rows as existing and
promotion returns zero unless a newer source timestamp is present.

5. Verify after production promotion:

```sql
select count(*)
from public.place_catalog
where business_status='open';

select region_1, count(*)
from public.place_catalog
where place_provider='sbiz' and business_status='open'
group by region_1
order by count(*) desc;
```

For the first bootstrap, all newly imported SBIZ rows must be Seoul food rows.
Do not run `db push`, deploy functions, or perform the real production import
from CI or an agent session; the repository owner performs those steps after
review.
