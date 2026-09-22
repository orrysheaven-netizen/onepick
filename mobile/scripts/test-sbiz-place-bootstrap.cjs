const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tool = require('./sbiz-place-bootstrap.cjs');

const header = [
  '상가업소번호','상호명','지점명',
  '상권업종대분류명','상권업종중분류명','상권업종소분류명',
  '시도명','시군구명','지번주소','도로명주소','경도','위도',
].join(',');

const csv = '\uFEFF' + [
  header,
  'S-1,원픽곱창,강남점,음식,한식,곱창,서울,강남구,서울 강남구 역삼동 1,서울특별시 강남구 테스트로 1,127.031,37.501',
  'S-2,"쉼표, 식당",,음식,한식,백반,서울특별시,마포구,서울특별시 마포구 공덕동 2,,126.951,37.544',
  'B-1,부산맛집,,음식,한식,국밥,부산광역시,부산진구,부산광역시 부산진구 1,,129.05,35.15',
  'R-1,편의점,,소매,종합소매,편의점,서울특별시,강남구,서울특별시 강남구 2,,127.02,37.50',
  'X-1,좌표없음,,음식,한식,한식,서울특별시,강남구,서울특별시 강남구 3,,127.02,',
].join('\r\n') + '\r\n';

const parsed = tool.parseCsv(csv);
assert.equal(parsed.headers[0], '상가업소번호', 'UTF-8 BOM is removed from the first header');
assert.equal(parsed.rows.length, 5);
tool.validateHeaders(parsed.headers);

const result = tool.buildCandidates(parsed.rows, {
  sourceUpdatedAt: '2026-07-15T00:00:00Z',
  region: '서울',
  limit: 5000,
});

assert.equal(result.candidates.length, 2);
assert.deepEqual(result.candidates.map((row) => row.provider_place_id), ['S-1','S-2']);
assert.equal(result.candidates[0].place_provider, 'sbiz');
assert.equal(result.candidates[0].source_updated_at, '2026-07-15T00:00:00.000Z');
assert.deepEqual(result.candidates[0].payload, {
  name: '원픽곱창',
  branch_name: '강남점',
  road_address: '서울특별시 강남구 테스트로 1',
  address: '서울 강남구 역삼동 1',
  region_1: '서울특별시',
  region_2: '강남구',
  latitude: 37.501,
  longitude: 127.031,
  provider_category: '음식 > 한식 > 곱창',
  business_status: 'open',
});
assert.equal(result.candidates[1].payload.name, '쉼표, 식당', 'quoted CSV commas survive parsing');
assert.equal(result.report.scannedRows, 5);
assert.equal(result.report.skippedRegion, 1);
assert.equal(result.report.skippedNonFood, 1);
assert.equal(result.report.invalidRows, 1);
assert.equal(result.report.reasonCounts.coordinates, 1);
assert.equal(result.report.selectedRows, 2);
assert.equal(result.report.truncated, false);

const duplicateParsed = tool.parseCsv([
  header,
  'D-1,같은식당,,음식,한식,백반,서울특별시,강남구,서울특별시 강남구 1,,127.0,37.5',
  'D-1,다른식당,,음식,한식,백반,서울특별시,강남구,서울특별시 강남구 2,,127.1,37.6',
].join('\n'));

const duplicates = tool.buildCandidates(duplicateParsed.rows, {
  sourceUpdatedAt: '2026-07-15T00:00:00Z',
});
assert.equal(duplicates.candidates.length, 0, 'conflicting provider IDs are blocked instead of silently picking a row');
assert.equal(duplicates.report.duplicateConflicts, 1);
assert.equal(duplicates.report.reasonCounts.duplicate_conflict, 1);

const exactDuplicateParsed = tool.parseCsv([
  header,
  'D-2,같은식당,,음식,한식,백반,서울특별시,강남구,서울특별시 강남구 1,,127.0,37.5',
  'D-2,같은식당,,음식,한식,백반,서울특별시,강남구,서울특별시 강남구 1,,127.0,37.5',
].join('\n'));
const exactDuplicates = tool.buildCandidates(exactDuplicateParsed.rows, {
  sourceUpdatedAt: '2026-07-15T00:00:00Z',
});
assert.equal(exactDuplicates.candidates.length, 1);
assert.equal(exactDuplicates.report.duplicateRows, 1);

assert.throws(
  () => tool.validateHeaders(['상호명','경도','위도','도로명주소','상권업종대분류명']),
  /SBIZ_HEADER_MISSING:providerPlaceId/,
);
assert.throws(
  () => tool.buildCandidates(parsed.rows, { sourceUpdatedAt: '' }),
  /SOURCE_UPDATED_AT_REQUIRED/,
);
assert.deepEqual(tool.parseCoordinate('127.1', -180, 180), { value: 127.1, error: null });
assert.equal(tool.parseCoordinate('999', -180, 180).error, 'range');

const ndjson = tool.toNdjson(result.candidates).trim().split('\n').map(JSON.parse);
assert.equal(ndjson.length, 2);
assert.equal(ndjson[0].payload.name, '원픽곱창');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'onepick-sbiz-'));
const input = path.join(temp, 'sample.csv');
const output = path.join(temp, 'staging.ndjson');
const report = path.join(temp, 'report.json');
fs.writeFileSync(input, csv, 'utf8');

const cli = spawnSync(process.execPath, [
  path.join(__dirname, 'sbiz-place-bootstrap.cjs'),
  '--input', input,
  '--output', output,
  '--report', report,
  '--source-updated-at', '2026-07-15T00:00:00Z',
  '--region', '서울특별시',
  '--limit', '1',
], { encoding: 'utf8' });

assert.equal(cli.status, 0, cli.stderr);
assert.equal(fs.readFileSync(output, 'utf8').trim().split('\n').length, 1);
const cliReport = JSON.parse(fs.readFileSync(report, 'utf8'));
assert.equal(cliReport.selectedRows, 1);
assert.equal(cliReport.truncated, true);

console.log('SBIZ bootstrap checks passed: UTF-8 CSV, Seoul/food filters, coordinates, staging contract, duplicate blocking and CLI output.');
