# SBIZ place adapter

The first bootstrap step is intentionally offline and deterministic. It does not fetch a provider URL and it does not write Supabase.

## Input

Download the current official SBIZ 상가(상권)정보 CSV and start with the Seoul file/sample. Keep the downloaded source outside git.

Required columns:

- 상가업소번호
- 상호명
- 경도
- 위도

Optional metadata consumed when present:

- 지점명, 도로명주소, 지번주소, 시도명, 시군구명
- 상권업종소분류명 (fallback: 상권업종중분류명)

## Run

```bash
python3 tools/sbiz_place_adapter.py seoul.csv \
  --source-updated-at 2026-09-01T00:00:00+09:00 \
  --output /tmp/sbiz-seoul.jsonl \
  --report /tmp/sbiz-seoul-report.json
```

The timestamp must represent the downloaded snapshot/release, not the time the adapter happened to run.

## Outputs

The JSONL file matches the `private.place_import_raw` contract. The report records the input SHA-256 and deterministic quality metrics:

- total / accepted / rejected rows
- missing address count
- missing coordinate count
- duplicate provider IDs
- distinct and top provider categories

Review the report before staging any rows. Duplicate provider IDs or unexpectedly high missing-field counts are stop conditions for bootstrap until the source is inspected.

## Safety

This adapter never writes `place_catalog`, `places`, `items`, or `picks`. Database staging is a separate reviewed step.
