const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '..', 'src', 'app', 'u', '[username].tsx'), 'utf8');

assert.match(
  source,
  /'code' in query\.error[^]*code\?: string[^]*PROFILE_NOT_FOUND/,
  'Only PROFILE_NOT_FOUND should select the missing-profile state',
);
assert.match(source, /isProfileNotFound[^]*프로필을 찾을 수 없어요/);
assert.match(source, /query\.isError && !isProfileNotFound[^]*tone="danger"/);
assert.match(source, /title="프로필을 불러오지 못했어요"/);
assert.match(source, /label: query\.isFetching \? '다시 불러오는 중…' : '다시 불러오기'/);
assert.match(source, /void query\.refetch\(\)/, 'Recoverable profile errors expose refetch');

console.log('Public profile error states passed: not-found is distinct from retryable load failures.');
