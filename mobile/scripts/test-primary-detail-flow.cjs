const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

const home = read('src/app/(tabs)/index.tsx');
const explore = read('src/app/(tabs)/explore.tsx');
const owner = read('src/app/(tabs)/(profile)/profile.tsx');
const publicProfile = read('src/app/(tabs)/(profile)/u/[username].tsx');
const menu = read('src/app/menu/[slug].tsx');
const dish = read('src/components/dish-people-picks.tsx');
const provider = read('src/app/provider/[providerId].tsx');
const constants = read('src/constants/onepick.ts');

// Home popular cards are one store's menu (10-05), so they open that item's detail.
assert.match(home, /<RecentItemCard key=\{item\.itemId\} item=\{item\} onOpen=\{\(\) => openItem\(item\.itemId\)\} \/>/,
  'Home store×menu cards open the item detail');
assert.doesNotMatch(home, /pathname: '\/ranking\/\[slug\]'/, 'Home must not bypass Figma 16A with the ranking surface');
assert.match(explore, /accessibilityLabel=\{\`\$\{category\.name\} 메뉴 원픽 보기\`\}[\s\S]*?pathname: '\/menu\/\[slug\]'/,
  'Explore menu discovery must open the same Figma 16A route');

// Figma 16A is the offline-only menu-detail surface and owns people-first drill-downs.
assert.match(menu, /fixedChannel=\{OnePickMvp\.publicPickChannel\} variant="menuDetail"/,
  'Menu detail must use the production 16A people-Pick variant');
assert.match(constants, /publicPickChannel: 'offline' as const/,
  'Primary food flow remains offline-only during MVP');
assert.match(dish, /renderMenuDetailCard[\s\S]*?pathname: '\/u\/\[username\]'/,
  'A person on 16A must open Figma 40 public profile');
assert.match(dish, /renderMenuDetailCard[\s\S]*?pathname: '\/provider\/\[providerId\]'[\s\S]*?scope: 'provider'/,
  'A provider on 16A must open Figma 17A store scope');
assert.match(dish, /renderMenuDetailCard[\s\S]*?pathname: '\/item\/\[itemId\]'/,
  'A Pick body on 16A must retain item-detail drill-down');
assert.match(dish, /renderMenuDetailCard[\s\S]*?pathname: '\/pick\/\[pickId\]'/,
  'Comments on 16A must open the dedicated Pick conversation');

// Figma 03 owner profile can inspect Figma 40 and both profiles use Figma 17A for store names.
assert.match(owner, /const openPublicProfile = \(\) => router\.push\(\{ pathname: '\/u\/\[username\]'/,
  'Owner profile must open its public Figma 40 representation');
assert.match(owner, /onPress=\{openPublicProfile\}[\s\S]*?공개 프로필 보기/,
  'The public-profile management entry must remain wired');
assert.match(owner, /pathname: '\/provider\/\[providerId\]'[\s\S]{0,180}scope: 'provider'/,
  'Owner profile provider names must open Figma 17A store scope');
assert.match(publicProfile, /pathname: '\/provider\/\[providerId\]'[\s\S]{0,180}scope: 'provider'/,
  'Public profile provider names must open Figma 17A store scope');
assert.match(publicProfile, /onOpenPick=\{\(pickId\) => router\.push\(\{ pathname: '\/pick\/\[pickId\]'/,
  'Public profile Pick rows must keep the dedicated Pick-detail route');

// Figma 17A is a terminal store profile that drills down to menu-item detail.
assert.match(provider, /query\.data\.kind === 'offline_branch' \? '이곳의 원픽'/,
  'Store profile must expose the Figma 17A menu section');
assert.match(provider, /pathname: '\/item\/\[itemId\]'/,
  'Figma 17A menu rows must open item detail');
assert.match(provider, /const goBack = \(\) => router\.canGoBack\(\) \? router\.back\(\) : router\.replace\('\/explore'\)/,
  'Store-profile direct links must have an Explore fallback');
assert.match(menu, /const goBack = \(\) => router\.canGoBack\(\) \? router\.back\(\) : router\.replace\('\/explore'\)/,
  'Menu-detail direct links must have an Explore fallback');

console.log('Primary detail-flow QA passed: Home/Explore → Figma 16A → Figma 40/Figma 17A/item/Pick, plus Figma 03 → Figma 40.');
