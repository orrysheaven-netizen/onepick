const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readSrc = (relative) => fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8');
// #757: the own profile composes shared profile components; check the screen with them.
const own = ['app/(tabs)/(profile)/profile.tsx', 'components/profile-identity.tsx', 'components/profile-current-pick-row.tsx',
  'components/profile-tabs.tsx', 'components/profile-records.tsx'].map(readSrc).join('\n');
const pub = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/(profile)/u/[username].tsx'), 'utf8');

for (const [label, source] of [['own profile', own], ['public profile', pub]]) {
  assert.match(source, /OnePickType\./, label + ' must use the shared type scale');
  assert.match(source, /OnePickSpace\.gutter/, label + ' must use the shared gutter');
  assert.match(source, /OnePickRadius\./, label + ' must use the shared radius scale');
  assert.match(source, /OnePick\.(?:bgDefault|textPrimary|textSecondary|borderDefault)/, label + ' must use semantic colors');
  assert.doesNotMatch(source, /fontWeight:\s*['"](?:800|900)['"]/, label + ' must not use 800/900 font weights');
}

assert.match(pub, /backgroundColor:\s*OnePick\.bgOverlay/, 'public profile login sheet must use the shared overlay token');
assert.match(pub, /로그인하면 바로 팔로우되고 이 프로필로 돌아와요/, 'follow login intent copy must remain intact');
assert.match(pub, /autoFollow=\{autoFollow && Boolean\(user\)\}/, 'automatic follow resume must remain intact');

console.log('Profile Foundations checks passed: own/public profile styles unified without changing follow intent.');
