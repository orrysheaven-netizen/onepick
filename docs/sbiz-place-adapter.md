# SBIZ place adapter

Offline-first bootstrap validator. It never fetches a network resource and never writes Supabase, `place_catalog`, `places`, `items`, or `picks`.

## Inspect the source first

```bash
python3 tools/sbiz_place_adapter.py seoul.csv --print-header
```

The validation report records the complete `headers` array and `resolved_columns` mapping so provider schema changes cannot silently degrade metadata to null.

## Run

```bash
python3 tools/sbiz_place_adapter.py seoul.csv \
  --source-updated-at 2026-09-01T00:00:00+09:00 \
  --output /tmp/sbiz-seoul.jsonl \
  --report /tmp/sbiz-seoul-report.json
```

Use the actual source snapshot/release timestamp. Future timestamps are rejected. Existing output/report files require `--force`.

For a review sample without editing the source file, use `--limit N`; the report still hashes the original input file.

## Validation gates

Default `--max-missing-ratio 0.2` applies independently to address, region, category, and coordinates. `--max-duplicate-ratio` defaults to 0 for bootstrap: any duplicate row makes the command non-zero until reviewed. Thresholds can be explicitly changed for diagnosis.

Coordinates must be WGS84 inside the Korea bootstrap bounding box: longitude 124–132, latitude 33–39. Blank coordinates and invalid/out-of-range coordinates are reported separately, which helps detect a wrong CRS.

Duplicate provider IDs are deduplicated before JSONL output. Winner selection is deterministic: highest coordinate/address/metadata completeness first; ties keep the earlier CSV row. The report separates `duplicate_provider_id_count`, `duplicate_row_count`, `dropped_duplicate_rows`, `max_occurrences`, and sample IDs.

The report also includes an `identity_churn_collision_count`: distinct provider IDs sharing normalized name + coordinates rounded to four decimals. This is a warning signal for provider-ID regeneration, not an automatic merge rule.

Malformed field-count rows, overlong identity fields, encoding failures, and missing required identity/coordinate headers fail or are counted explicitly. CP949 input is supported with `--encoding cp949`.

## Output contract

JSONL rows match `private.place_import_raw`: `place_provider`, `provider_place_id`, `source_updated_at`, and `payload`. Zero accepted rows produce a truly empty JSONL file.

The report contains source/output paths, source SHA-256, source timestamp, row/rejection counts, schema resolution, coordinate/address quality, duplicate metrics, and category coverage.

## Known limitation

SBIZ bootstrap rows are emitted as `business_status=open`. **Closure detection is not implemented in this adapter.** Closed/closed_at synchronization belongs to the later provider freshness/reconciliation stage.

Database staging and promotion remain a separate reviewed step.
