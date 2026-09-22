#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REGION = '서울특별시';
const DEFAULT_LIMIT = 5000;

const HEADER_ALIASES = {
  providerPlaceId: ['상가업소번호', '상가업소ID', '상가업소아이디'],
  name: ['상호명', '상호'],
  branchName: ['지점명', '지점'],
  categoryLarge: ['상권업종대분류명', '상권업종대분류'],
  categoryMid: ['상권업종중분류명', '상권업종중분류'],
  categorySmall: ['상권업종소분류명', '상권업종소분류'],
  standardCategory: ['표준산업분류명'],
  region1: ['시도명', '시도'],
  region2: ['시군구명', '시군구'],
  address: ['지번주소', '소재지전체주소', '주소'],
  roadAddress: ['도로명주소', '도로명 주소'],
  longitude: ['경도', '경도값', 'longitude', 'Longitude'],
  latitude: ['위도', '위도값', 'latitude', 'Latitude'],
};

const trim = (value) => String(value ?? '').trim();
const collapseSpaces = (value) => trim(value).replace(/\s+/g, ' ');

function parseCsv(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index++) {
    const character = source[index];

    if (quoted) {
      if (character !== '"') {
        cell += character;
        continue;
      }
      if (source[index + 1] === '"') {
        cell += '"';
        index++;
        continue;
      }
      quoted = false;
      continue;
    }

    if (character === '"' && cell === '') {
      quoted = true;
      continue;
    }
    if (character === ',') {
      endCell();
      continue;
    }
    if (character === '\r') continue;
    if (character === '\n') {
      endRow();
      continue;
    }
    cell += character;
  }

  if (quoted) throw new Error('CSV_QUOTE_UNCLOSED');
  if (cell !== '' || row.length > 0) endRow();

  const headers = (rows.shift() ?? []).map((name) => trim(name));
  const objects = rows
    .filter((values) => values.some((value) => trim(value) !== ''))
    .map((values, rowIndex) => ({
      __rowNumber: rowIndex + 2,
      ...Object.fromEntries(headers.map((name, index) => [name, trim(values[index])])),
    }));

  return { headers, rows: objects };
}

function firstValue(row, aliases) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias) && trim(row[alias]) !== '') {
      return trim(row[alias]);
    }
  }
  return '';
}

function resolveHeader(headers, aliases) {
  return aliases.find((alias) => headers.includes(alias)) ?? null;
}

function validateHeaders(headers, { foodOnly = true } = {}) {
  const required = [
    ['providerPlaceId', HEADER_ALIASES.providerPlaceId],
    ['name', HEADER_ALIASES.name],
    ['longitude', HEADER_ALIASES.longitude],
    ['latitude', HEADER_ALIASES.latitude],
  ];
  for (const [label, aliases] of required) {
    if (!resolveHeader(headers, aliases)) {
      throw new Error(`SBIZ_HEADER_MISSING:${label}`);
    }
  }

  const hasAddress = resolveHeader(headers, HEADER_ALIASES.roadAddress)
    || resolveHeader(headers, HEADER_ALIASES.address);
  if (!hasAddress) throw new Error('SBIZ_HEADER_MISSING:address');

  if (foodOnly) {
    const categoryHeaders = [
      ...HEADER_ALIASES.categoryLarge,
      ...HEADER_ALIASES.categoryMid,
      ...HEADER_ALIASES.categorySmall,
      ...HEADER_ALIASES.standardCategory,
    ];
    if (!resolveHeader(headers, categoryHeaders)) {
      throw new Error('SBIZ_HEADER_MISSING:category');
    }
  }
}

function normalizeRegion1(value) {
  const region = collapseSpaces(value);
  const compact = region.replace(/\s+/g, '');
  if (compact === '서울' || compact === '서울시' || compact === '서울특별시') return '서울특별시';
  if (compact === '부산' || compact === '부산시' || compact === '부산광역시') return '부산광역시';
  if (compact === '대구' || compact === '대구시' || compact === '대구광역시') return '대구광역시';
  if (compact === '인천' || compact === '인천시' || compact === '인천광역시') return '인천광역시';
  if (compact === '광주' || compact === '광주시' || compact === '광주광역시') return '광주광역시';
  if (compact === '대전' || compact === '대전시' || compact === '대전광역시') return '대전광역시';
  if (compact === '울산' || compact === '울산시' || compact === '울산광역시') return '울산광역시';
  if (compact === '세종' || compact === '세종시' || compact === '세종특별자치시') return '세종특별자치시';
  if (compact === '제주' || compact === '제주도' || compact === '제주특별자치도') return '제주특별자치도';
  return region;
}

function addressParts(value) {
  return collapseSpaces(value).split(' ').filter(Boolean);
}

function deriveRegion(row) {
  const roadAddress = firstValue(row, HEADER_ALIASES.roadAddress);
  const address = firstValue(row, HEADER_ALIASES.address);
  const fallback = roadAddress || address;
  const parts = addressParts(fallback);

  const explicitRegion1 = firstValue(row, HEADER_ALIASES.region1);
  const explicitRegion2 = firstValue(row, HEADER_ALIASES.region2);

  return {
    region1: normalizeRegion1(explicitRegion1 || parts[0] || ''),
    region2: collapseSpaces(explicitRegion2 || parts[1] || ''),
    roadAddress: collapseSpaces(roadAddress),
    address: collapseSpaces(address),
  };
}

function parseCoordinate(value, min, max) {
  const text = trim(value);
  if (!text) return { value: null, error: 'missing' };
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return { value: null, error: 'invalid' };
  const number = Number(text);
  if (!Number.isFinite(number) || number < min || number > max) {
    return { value: null, error: 'range' };
  }
  return { value: number, error: null };
}

function providerCategory(row) {
  const values = [
    firstValue(row, HEADER_ALIASES.categoryLarge),
    firstValue(row, HEADER_ALIASES.categoryMid),
    firstValue(row, HEADER_ALIASES.categorySmall),
  ].filter(Boolean);

  if (values.length > 0) return [...new Set(values)].join(' > ');
  return firstValue(row, HEADER_ALIASES.standardCategory);
}

function isFoodRow(row) {
  const values = [
    firstValue(row, HEADER_ALIASES.categoryLarge),
    firstValue(row, HEADER_ALIASES.categoryMid),
    firstValue(row, HEADER_ALIASES.categorySmall),
    firstValue(row, HEADER_ALIASES.standardCategory),
  ].filter(Boolean);

  return values.some((value) => /음식|식당|음식점/.test(value));
}

function stablePayloadKey(candidate) {
  return JSON.stringify({
    name: candidate.payload.name,
    branch_name: candidate.payload.branch_name,
    road_address: candidate.payload.road_address,
    address: candidate.payload.address,
    region_1: candidate.payload.region_1,
    region_2: candidate.payload.region_2,
    latitude: candidate.payload.latitude,
    longitude: candidate.payload.longitude,
    provider_category: candidate.payload.provider_category,
    business_status: candidate.payload.business_status,
  });
}

function buildCandidates(rows, {
  sourceUpdatedAt,
  region = DEFAULT_REGION,
  limit = DEFAULT_LIMIT,
  foodOnly = true,
} = {}) {
  const date = new Date(sourceUpdatedAt);
  if (!sourceUpdatedAt || Number.isNaN(date.getTime())) {
    throw new Error('SOURCE_UPDATED_AT_REQUIRED');
  }
  if (!Number.isInteger(limit) || limit < 1) throw new Error('LIMIT_INVALID');

  const targetRegion = normalizeRegion1(region);
  const candidateById = new Map();
  const blockedIds = new Set();
  const errorSamples = [];
  const reasonCounts = {};
  const bump = (reason) => {
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  };
  const sampleError = (row, reason) => {
    bump(reason);
    if (errorSamples.length < 20) {
      errorSamples.push({ row: row.__rowNumber ?? null, reason });
    }
  };

  const stats = {
    scannedRows: 0,
    skippedRegion: 0,
    skippedNonFood: 0,
    invalidRows: 0,
    duplicateRows: 0,
    duplicateConflicts: 0,
  };

  for (const row of rows) {
    stats.scannedRows++;

    const regionInfo = deriveRegion(row);
    if (targetRegion && regionInfo.region1 !== targetRegion) {
      stats.skippedRegion++;
      continue;
    }
    if (foodOnly && !isFoodRow(row)) {
      stats.skippedNonFood++;
      continue;
    }

    const providerPlaceId = firstValue(row, HEADER_ALIASES.providerPlaceId);
    const name = collapseSpaces(firstValue(row, HEADER_ALIASES.name));
    const branchName = collapseSpaces(firstValue(row, HEADER_ALIASES.branchName));
    const longitude = parseCoordinate(firstValue(row, HEADER_ALIASES.longitude), -180, 180);
    const latitude = parseCoordinate(firstValue(row, HEADER_ALIASES.latitude), -90, 90);

    let invalidReason = null;
    if (!providerPlaceId || providerPlaceId.length > 200) invalidReason = 'provider_place_id';
    else if (!name || name.length > 200) invalidReason = 'name';
    else if (!regionInfo.roadAddress && !regionInfo.address) invalidReason = 'address';
    else if (longitude.error || latitude.error) invalidReason = 'coordinates';

    if (invalidReason) {
      stats.invalidRows++;
      sampleError(row, invalidReason);
      continue;
    }

    const candidate = {
      place_provider: 'sbiz',
      provider_place_id: providerPlaceId,
      source_updated_at: date.toISOString(),
      payload: {
        name,
        branch_name: branchName || null,
        road_address: regionInfo.roadAddress || null,
        address: regionInfo.address || null,
        region_1: regionInfo.region1 || null,
        region_2: regionInfo.region2 || null,
        latitude: latitude.value,
        longitude: longitude.value,
        provider_category: providerCategory(row) || null,
        business_status: 'open',
      },
    };

    if (blockedIds.has(providerPlaceId)) {
      stats.duplicateConflicts++;
      sampleError(row, 'duplicate_conflict');
      continue;
    }

    const existing = candidateById.get(providerPlaceId);
    if (existing) {
      if (stablePayloadKey(existing) === stablePayloadKey(candidate)) {
        stats.duplicateRows++;
        continue;
      }
      candidateById.delete(providerPlaceId);
      blockedIds.add(providerPlaceId);
      stats.duplicateConflicts++;
      sampleError(row, 'duplicate_conflict');
      continue;
    }

    candidateById.set(providerPlaceId, candidate);
  }

  const allCandidates = [...candidateById.values()];
  const candidates = allCandidates.slice(0, limit);

  return {
    candidates,
    report: {
      provider: 'sbiz',
      sourceUpdatedAt: date.toISOString(),
      region: targetRegion,
      foodOnly,
      limit,
      ...stats,
      eligibleRows: allCandidates.length,
      selectedRows: candidates.length,
      truncated: allCandidates.length > limit,
      reasonCounts,
      errorSamples,
    },
  };
}

function toNdjson(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}

function parseArgs(argv) {
  const args = {
    region: DEFAULT_REGION,
    limit: DEFAULT_LIMIT,
    foodOnly: true,
  };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--all-categories') {
      args.foodOnly = false;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`ARG_UNKNOWN:${token}`);
    const key = token.slice(2);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`ARG_VALUE_REQUIRED:${key}`);
    if (key === 'input') args.input = value;
    else if (key === 'output') args.output = value;
    else if (key === 'report') args.report = value;
    else if (key === 'source-updated-at') args.sourceUpdatedAt = value;
    else if (key === 'region') args.region = value;
    else if (key === 'limit') args.limit = Number(value);
    else throw new Error(`ARG_UNKNOWN:${token}`);
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node mobile/scripts/sbiz-place-bootstrap.cjs \\',
    '    --input <sbiz.csv> \\',
    '    --output <staging.ndjson> \\',
    '    --report <report.json> \\',
    '    --source-updated-at <ISO timestamp> [--region 서울특별시] [--limit 5000]',
    '',
    'Default: 서울특별시 + 음식 관련 업종만, 최대 5,000개 후보.',
    'Use --all-categories only for diagnostics; restaurant bootstrap should keep the food filter.',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.input || !args.output || !args.report || !args.sourceUpdatedAt) {
    throw new Error(usage());
  }

  const input = fs.readFileSync(path.resolve(args.input), 'utf8');
  const parsed = parseCsv(input);
  validateHeaders(parsed.headers, { foodOnly: args.foodOnly });

  const result = buildCandidates(parsed.rows, {
    sourceUpdatedAt: args.sourceUpdatedAt,
    region: args.region,
    limit: args.limit,
    foodOnly: args.foodOnly,
  });

  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
  fs.writeFileSync(path.resolve(args.output), toNdjson(result.candidates), 'utf8');
  fs.writeFileSync(path.resolve(args.report), JSON.stringify(result.report, null, 2) + '\n', 'utf8');

  process.stdout.write(JSON.stringify(result.report, null, 2) + '\n');
  if (result.report.duplicateConflicts > 0) process.exitCode = 2;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = {
  HEADER_ALIASES,
  buildCandidates,
  deriveRegion,
  isFoodRow,
  normalizeRegion1,
  parseArgs,
  parseCoordinate,
  parseCsv,
  providerCategory,
  toNdjson,
  validateHeaders,
};
