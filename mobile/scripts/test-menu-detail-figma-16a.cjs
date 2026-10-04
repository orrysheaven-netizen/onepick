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
assert.match(menu, /fixedChannel=\{OnePickMvp\.publicPickChannel\} variant="menuDetail"/);
assert.doesNotMatch(menu, /지금 원픽으로 고른 사람들의 한줄평/, 'Figma 16A has no extra intro copy in the primary viewport');
assert.doesNotMatch(menu, /fontWeight:\s*['"](?:800|900)['"]/, 'menu detail uses Foundations typography only');

assert.match(people, /variant\?: 'default' \| 'menuDetail'/);
assert.match(people, /원픽 \{totalPickCountLabel\}/);
assert.match(people, /query\.hasNextPage \? '\+' : ''/, 'partial counts are marked with + instead of pretending to be exact');
assert.match(people, /<MenuDetailPickCard/);
assert.match(people, /onOpenComments=\{\(\) => router\.push\(\{ pathname: '\/pick\/\[pickId\]'/, 'menu comments open the dedicated review conversation');
assert.match(people, /fixedChannel/);

// Figma 45: photo left; @아이디 → [매장] 매장명 (menu not repeated) → 지역 › → 한줄평; "원픽 N  댓글 N  공유".
assert.match(row, /<Avatar name=\{pick\.username\} size=\{24\}/);
assert.match(row, /<PickPhoto size=\{64\} compactRadius=\{12\}/);
const photoIndex = row.indexOf('<PickPhoto size={64}');
const personIndex = row.indexOf('>@{pick.username}</Text>');
const titleIndex = row.indexOf('{providerName ?? menuName}');
const regionIndex = row.indexOf('{region} ›');
const reviewIndex = row.indexOf('<Text numberOfLines={2} style={styles.review}>');
assert.ok(photoIndex >= 0 && personIndex > photoIndex && titleIndex > personIndex && regionIndex > titleIndex && reviewIndex > regionIndex,
  'Figma 45 row order is photo → @아이디 → 매장명 → 지역 › → 한줄평');
assert.match(row, /commentCount \? `댓글 \$\{commentCount\}` : '댓글'/);
assert.doesNotMatch(row, /styles\.separator/, 'footer has no "·" separators');
assert.match(people, /최근 고른 순 누가 어느 집을 왜 골랐는지 볼 수 있어요\./);
assert.match(people, /action=\{onRegister \? \{ label: `\$\{categoryName\} 원픽 등록하기`/, '45-2 empty state registers the menu');
assert.match(menu, /categoryId && name && !empty \? <View style=\{styles\.registerFooter\}>/, 'no fixed footer on the empty state');
assert.match(row, /channelBadge:[\s\S]*?height: 28[\s\S]*?paddingHorizontal: 9[\s\S]*?borderRadius: OnePickRadius\.full/);
assert.match(row, /review: \{ \.\.\.OnePickType\.body, color: OnePick\.textPrimary \}/);
assert.match(row, /sharePick\(/);
assert.match(row, /댓글/);
assert.match(row, /공유/);

assert.match(photo, /compactRadius\?: 8 \| 12/);
assert.match(photo, /compact && compactRadius \? \{ borderRadius: compactRadius \} : null/);

console.log('Figma 16A menu detail checks passed: Foundations header, exact viewport geometry, people-first Pick rows, honest counts, and dedicated comment/share actions.');
