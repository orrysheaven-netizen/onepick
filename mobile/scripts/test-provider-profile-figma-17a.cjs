const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

const screen = read('src/app/provider/[providerId].tsx');
const service = read('src/services/providerProfileService.ts');
const home = read('src/app/(tabs)/index.tsx');
const dish = read('src/components/dish-people-picks.tsx');
const menu = read('src/app/menu/[slug].tsx');
const own = read('src/app/(tabs)/(profile)/profile.tsx');
const pub = read('src/app/(tabs)/(profile)/u/[username].tsx');

assert.match(screen, /<View style=\{styles\.storeHeader\}>/);
assert.match(screen, /storeHeader:[\s\S]*?height: 56/);
assert.match(screen, /storeHeaderSide: \{ width: 48, minHeight: 44, justifyContent: 'center' \}/);
assert.match(screen, /storeHeaderTitle: \{ \.\.\.OnePickType\.headline[\s\S]*?textAlign: 'center'/);
assert.match(screen, /storeContent:[\s\S]*?maxWidth: 390[\s\S]*?minHeight: 720[\s\S]*?paddingHorizontal: OnePickSpace\.gutter[\s\S]*?paddingTop: OnePickSpace\.sm[\s\S]*?gap: OnePickSpace\.md/);

assert.match(screen, /query\.data\.brandLogoUrl \?/);
assert.match(screen, /storeLogoPlaceholder:[\s\S]*?width: 64[\s\S]*?height: 64[\s\S]*?borderRadius: 20/);
assert.match(screen, /로고\{"\\n"\}미등록/);
assert.match(screen, /storeChannelBadge:[\s\S]*?height: 28[\s\S]*?paddingHorizontal: 9[\s\S]*?borderRadius: OnePickRadius\.full/);
assert.match(screen, /storeName: \{ \.\.\.OnePickType\.title/);
assert.match(screen, /\[query\.data\.branchName, query\.data\.subtitle\]\.filter\(Boolean\)\.join\(' · '\)/);

assert.match(screen, /query\.data\.link \? <View style=\{styles\.storeLinks\}>/, 'external links are conditional');
assert.match(screen, /지도 링크 ↗/);
assert.doesNotMatch(screen, />SNS</, 'unregistered SNS is not invented');
assert.match(screen, /storeLinkButton:[\s\S]*?minHeight: 41[\s\S]*?paddingHorizontal: 14[\s\S]*?paddingVertical: 9/);

assert.match(screen, /storeSectionTitle[\s\S]*?이곳의 원픽/);
assert.match(screen, /storeMenuRow:[\s\S]*?minHeight: 72/);
assert.match(screen, /storeMenuCopy:[\s\S]*?minHeight: 62[\s\S]*?gap: 2/);
assert.match(screen, /<Text numberOfLines=\{1\} style=\{styles\.storeMenuName\}>\{item\.menuName\}<\/Text>/);
assert.match(screen, /원픽 \{item\.pickCount\.toLocaleString\(\)\}/);
assert.match(screen, /item\.latestReview \? <Text numberOfLines=\{1\} style=\{styles\.storeReview\}>/);
assert.match(screen, /pathname: '\/item\/\[itemId\]'/, 'store menu rows open item detail');
assert.match(screen, /이곳에서 원픽 등록하기/);
assert.match(screen, /pathname: '\/pick\/new'[\s\S]{0,140}providerId: query\.data\.id/,
  'empty offline store profile passes providerId into registration');

assert.match(service, /latestReview: string \| null/);
assert.match(service, /select\('id,item_id,one_line_review,started_at'\)/);
assert.match(service, /order\('id', \{ ascending: true \}\)[\s\S]*?range\(/, 'Pick stats pagination uses a stable unique order before range');
assert.match(service, /latestReviews\.get\(item\.id\)\?\.review \?\? null/);
assert.match(service, /from\('brands'\)[\s\S]*?select\('id,name,logo_path,is_active'\)/);

// #757: profile rows no longer link the store directly; the Pick detail they open does.
for (const source of [own, pub]) assert.doesNotMatch(source, /pathname: '\/provider\/\[providerId\]'/);
for (const [label, source] of [['Home', home], ['menu detail', dish]]) {
  assert.match(source, /pathname: '\/provider\/\[providerId\]'[\s\S]{0,180}scope: 'provider'/,
    label + ' provider-name navigation must open the store profile rather than the brand aggregate');
}

assert.match(screen, /scope: 'provider'/, 'brand branch rows still enter store scope');
assert.match(screen, /브랜드 전체/, 'brand profile remains available');
assert.match(menu, /내 \$\{name\} 원픽 등록하기/);
assert.match(menu, /pathname: '\/pick\/new'[\s\S]{0,180}menuName: name[\s\S]{0,120}categoryId/,
  'menu detail passes the validated menu/category prefill into the same registration flow');
assert.doesNotMatch(screen, /fontWeight:\s*['"](?:800|900)['"]/, 'Figma 17A work does not introduce non-Foundations heavy weights');

console.log('Figma 17A provider checks passed: store header, identity, registered links, menu rows/reviews, item drill-down and store-scope navigation.');
