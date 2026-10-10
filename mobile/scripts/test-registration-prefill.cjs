const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const service = read('src/services/storeFirstService.ts');
const hook = read('src/hooks/useStoreFirst.ts');
const screen = read('src/app/pick/new.tsx');

assert.match(service, /async providerStore\(providerId: string\)/);
assert.match(service, /from\('providers'\)[\s\S]*?\.eq\('id', providerId\)/, 'provider ID is re-read from the database');
assert.match(service, /provider\.kind !== 'offline_branch'/, 'only an active offline provider can prefill the store step');
assert.match(service, /from\('places'\)[\s\S]*?\.eq\('id', provider\.place_id\)/, 'provider place identity is re-read');
assert.match(service, /from\('place_catalog'\)[\s\S]*?\.eq\('place_provider', place\.place_provider\)[\s\S]*?\.eq\('provider_place_id', place\.provider_place_id\)[\s\S]*?\.eq\('business_status', 'open'\)/,
  'prefill is accepted only when the linked public catalog entry is still open');
assert.match(hook, /useProviderStorePrefill/);
assert.match(screen, /!restoredDraftRef\.current/, 'a restored account draft wins over entry prefill');
assert.match(screen, /providerPrefill\.data \?\? null/);
assert.match(screen, /매장 메뉴명으로 고쳐 써도 돼요/);
assert.match(screen, /매장 메뉴명을 적어주세요/);
assert.doesNotMatch(screen, /카테고리는 앱이 자동으로 분류해요/);
assert.match(screen, /prefilledCategoryOption/);
assert.match(screen, /관리자 검수 후 \$\{pickDisplayName\}/, 'photo copy reflects the current first-photo review policy');
assert.match(screen, /borderStyle: 'dashed'/);
assert.match(screen, /label="사진 빼기"/);
assert.doesNotMatch(screen, /사진 삭제/);

console.log('Registration prefill checks passed: ID revalidation, draft priority, menu/category prefill and reviewed first-photo copy.');
