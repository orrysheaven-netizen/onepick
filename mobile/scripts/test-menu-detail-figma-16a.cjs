const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

const menu = read('src/app/menu/[slug].tsx');
const people = read('src/components/dish-people-picks.tsx');
const row = read('src/components/menu-detail-pick-card.tsx');
const photo = read('src/components/pick-photo.tsx');

assert.match(menu, /<View style=\{styles\.header\}>/);
assert.match(menu, /header:[\s\S]*?height: 56/);
assert.match(menu, /headerSide: \{ width: 48, minHeight: 44, justifyContent: 'center' \}/);
assert.match(menu, /headerTitle: \{ \.\.\.OnePickType\.headline[\s\S]*?textAlign: 'center'/);
assert.match(menu, /maxWidth: 390/);
assert.match(menu, /minHeight: 720/);
assert.match(menu, /paddingHorizontal: OnePickSpace\.gutter/);
assert.match(menu, /paddingTop: OnePickSpace\.sm/);
assert.match(menu, /fixedChannel=\{fromHome \? OnePickMvp\.homeFeedChannels : OnePickMvp\.publicPickChannel\}[\s\S]*?variant="menuDetail"/);
assert.doesNotMatch(menu, /지금 원픽으로 고른 사람들의 한줄평/, 'Figma 16A has no extra intro copy in the primary viewport');
assert.doesNotMatch(menu, /fontWeight:\s*['"](?:800|900)['"]/, 'menu detail uses Foundations typography only');

assert.match(people, /variant\?: 'default' \| 'menuDetail'/);
assert.match(people, /원픽 \{totalPickCountLabel\}/);
assert.match(people, /query\.hasNextPage \? '\+' : ''/, 'partial counts are marked with + instead of pretending to be exact');
assert.match(people, /<MenuDetailPickCard/);
assert.match(people, /onOpenComments=\{\(\) => router\.push\(\{ pathname: '\/pick\/\[pickId\]'/, 'menu comments open the dedicated review conversation');
assert.match(people, /fixedChannel/);

assert.match(row, /<Avatar name=\{pick\.username\} size=\{32\}/);
assert.match(row, /<PickPhoto size=\{64\} compactRadius=\{12\}/);
const menuNameIndex = row.indexOf('<Text numberOfLines={1} style={styles.menuName}>{menuName}</Text>');
const providerIndex = row.indexOf('<View style={styles.providerRow}>');
const reviewIndex = row.indexOf('<Text numberOfLines={2} style={styles.review}>');
assert.ok(menuNameIndex >= 0 && providerIndex > menuNameIndex && reviewIndex > providerIndex,
  'Figma 16A row order is menu → channel/provider → one-line review');
assert.match(row, /personRow: \{ height: 36[\s\S]*?gap: 10/);
assert.match(row, /body: \{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10 \}/);
assert.match(row, /channelBadge:[\s\S]*?height: 28[\s\S]*?paddingHorizontal: 9[\s\S]*?borderRadius: OnePickRadius\.full/);
assert.match(row, /review: \{ \.\.\.OnePickType\.body, color: OnePick\.textPrimary \}/);
assert.match(row, /sharePick\(/);
assert.match(row, /댓글/);
assert.match(row, /공유/);

assert.match(photo, /compactRadius\?: 8 \| 12/);
assert.match(photo, /compact && compactRadius \? \{ borderRadius: compactRadius \} : null/);

console.log('Figma 16A menu detail checks passed: Foundations header, exact viewport geometry, people-first Pick rows, honest counts, and dedicated comment/share actions.');
