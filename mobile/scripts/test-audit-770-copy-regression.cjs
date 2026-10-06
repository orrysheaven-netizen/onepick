const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

const explore = read('src/app/(tabs)/explore.tsx');
for (const sentence of [
  '아직 공개된 메뉴가 없어요.',
  '최근 원픽을 불러오지 못했어요.',
  '아직 원픽된 곳이 없어요.',
  '원픽을 불러오지 못했어요.',
  '아직 선택된 원픽이 없어요.',
]) {
  assert.ok(explore.includes(sentence), `explore sentence keeps terminal period: ${sentence}`);
}
for (const bare of [
  'title="아직 공개된 메뉴가 없어요"',
  'title="최근 원픽을 불러오지 못했어요"',
  'title="아직 원픽된 곳이 없어요"',
  'title="원픽을 불러오지 못했어요"',
  'title="아직 선택된 원픽이 없어요"',
]) {
  assert.ok(!explore.includes(bare), `explore does not regress to bare sentence: ${bare}`);
}

const itemSearch = read('src/components/item-search.tsx');
assert.ok(itemSearch.includes('<Text style={styles.description}>검색하고 있어요.</Text>'));
assert.ok(!itemSearch.includes('<Text style={styles.description}>검색하고 있어요</Text>'));

console.log('PASS #770 restores #716 sentence punctuation in explore/search copy');
