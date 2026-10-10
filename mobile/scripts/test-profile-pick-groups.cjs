const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function load(relative) {
  const moduleExports = {};
  const output = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, {
    exports: moduleExports,
    require: (name) => { assert.fail(`Unexpected import: ${name}`); },
  });
  return moduleExports;
}

const grouping = load('src/lib/profile/profilePickGroups.ts');

const parent = (id, name, sortOrder) => ({ id, parentId: null, name, sortOrder });
const leaf = (id, parentId, name, sortOrder) => ({ id, parentId, name, sortOrder });
const categories = [
  parent('food', '음식', 10),
  parent('culture', '문화', 20),
  parent('tech', '기술', 30),
  parent('style', '스타일', 40),
  leaf('snacks', 'food', '과자', 1),
  leaf('ramen', 'food', '라면', 2),
  leaf('movie', 'culture', '영화', 1),
  leaf('drama', 'culture', '드라마', 2),
  leaf('game', 'culture', '게임', 3),
  leaf('phone', 'tech', '스마트폰', 1),
  leaf('perfume', 'style', '향수', 1),
];

function pick(id, category, updatedAt = '2026-09-20T00:00:00Z') {
  return {
    pick: { id: `pick-${id}`, itemId: `item-${id}`, categoryId: category.id, oneLineReview: id, updatedAt },
    category,
    item: { id: `item-${id}`, name: id },
    profile: null,
  };
}

const seven = [
  pick('ramen', categories[5]),
  pick('movie', categories[6]),
  pick('phone', categories[9]),
  pick('snacks', categories[4]),
  pick('game', categories[8]),
  pick('perfume', categories[10]),
  pick('drama', categories[7]),
];

const groups = grouping.buildProfilePickGroups(seven, categories);
assert.deepEqual(Array.from(groups, (group) => group.id), ['food', 'culture', 'tech', 'style']);
assert.deepEqual(Array.from(groups, (group) => group.name), ['음식', '문화', '기술', '스타일']);
assert.deepEqual(Array.from(groups[0].items, (item) => item.category.name), ['과자', '라면']);
assert.deepEqual(Array.from(groups[1].items, (item) => item.category.name), ['영화', '드라마', '게임']);
assert.equal(groups.reduce((sum, group) => sum + group.items.length, 0), seven.length, 'grouping must never drop Picks');

const longCollapsed = grouping.defaultCollapsedProfilePickGroups(groups, seven.length);
assert.deepEqual([...longCollapsed], ['tech', 'style'], '7+ Picks keep only the first two groups open by default');
assert.equal(grouping.defaultCollapsedProfilePickGroups(groups, 6).size, 0, '6 or fewer Picks stay fully expanded');

const fallback = grouping.buildProfilePickGroups(seven.slice(0, 3), []);
assert.deepEqual(Array.from(fallback, (group) => group.name), ['영화', '라면', '스마트폰'].sort((a, b) => {
  const sort = { '라면': 2, '영화': 1, '스마트폰': 1 };
  return sort[a] - sort[b] || a.localeCompare(b);
}));
assert.equal(fallback.reduce((sum, group) => sum + group.items.length, 0), 3, 'fallback still exposes every Pick without the parent catalog');

// Theme sections: FOOD / CULTURE & ART / … resolved through the nearest mapped ancestor.
const themed = [
  { id: 'food-root', parentId: null, name: '먹을것', sortOrder: 1, themeCode: 'food' },
  { id: 'meat', parentId: 'food-root', name: '고기', sortOrder: 1 },
  { id: 'pork-belly', parentId: 'meat', name: '삼겹살', sortOrder: 1 },
  { id: 'noodles', parentId: 'food-root', name: '면', sortOrder: 2 },
  { id: 'naengmyeon', parentId: 'noodles', name: '냉면', sortOrder: 1 },
  { id: 'alcohol', parentId: null, name: '주류', sortOrder: 2, themeCode: 'food' },
  { id: 'soju', parentId: 'alcohol', name: '소주', sortOrder: 1 },
  { id: 'content', parentId: null, name: '콘텐츠', sortOrder: 3, themeCode: 'culture' },
  { id: 'movie2', parentId: 'content', name: '영화', sortOrder: 1, themeCode: 'culture' },
  { id: 'misc', parentId: null, name: '미분류', sortOrder: 9 },
  { id: 'misc-leaf', parentId: 'misc', name: '기타 항목', sortOrder: 1 },
];
const byId = Object.fromEntries(themed.map((category) => [category.id, category]));
assert.equal(grouping.resolveCategoryTheme('pork-belly', themed), 'food', '3-level leaves inherit the root theme');
assert.equal(grouping.resolveCategoryTheme('soju', themed), 'food', 'alcohol is FOOD');
assert.equal(grouping.resolveCategoryTheme('movie2', themed), 'culture');
assert.equal(grouping.resolveCategoryTheme('misc-leaf', themed), 'other');
assert.equal(grouping.resolveCategoryTheme('missing', themed), 'other');

const themedPicks = ['movie2', 'pork-belly', 'misc-leaf', 'soju', 'naengmyeon'].map((id) => pick(id, byId[id]));
const sections = grouping.buildProfileThemeSections(themedPicks, themed);
assert.deepEqual(Array.from(sections, (section) => section.label), ['FOOD', 'CULTURE & ART', '기타'], 'FOOD first, content under CULTURE & ART, unmapped last');
assert.deepEqual(Array.from(sections, (section) => section.pickCount), [3, 1, 1]);
assert.deepEqual(Array.from(sections[0].groups, (group) => group.name), ['온라인 맛집'], 'FOOD without channels or recipes is one 온라인 lane');
assert.deepEqual(Array.from(sections[1].groups, (group) => group.name), ['콘텐츠'], 'other themes keep their category groups');
assert.equal(sections.reduce((sum, section) => sum + section.pickCount, 0), themedPicks.length, 'theme sections never drop Picks');

const unknownTheme = grouping.buildProfileThemeSections([pick('x', { id: 'x', parentId: null, name: 'X', sortOrder: 1 })], [{ id: 'x', parentId: null, name: 'X', sortOrder: 1, themeCode: 'sports' }]);
assert.deepEqual(Array.from(unknownTheme, (section) => section.label), ['SPORTS'], 'a theme the app does not know yet still gets a section');
assert.deepEqual(Array.from(grouping.buildProfileThemeSections(seven, []), (section) => section.code), ['other'], 'no catalog → one 기타 section');

// FOOD lanes: 오프라인 맛집 / 온라인 맛집 / 레시피.
const foodCats = [
  ...themed,
  { id: 'recipe', parentId: 'food-root', name: '레시피', slug: 'recipe', sortOrder: 9 },
];
const withChannels = (id, category, channels) => ({ ...pick(id, category), item: { id: `item-${id}`, name: id, channels } });
const lanePicks = [
  withChannels('store-meat', byId['pork-belly'], ['offline']),
  withChannels('both-noodle', byId.naengmyeon, ['offline', 'online']),
  withChannels('mail-meat', { ...byId['pork-belly'], id: 'pork-belly' }, ['online']),
  withChannels('legacy-soju', byId.soju, []),
  withChannels('video', { id: 'recipe', parentId: 'food-root', name: '레시피', slug: 'recipe', sortOrder: 9 }, ['offline']),
];
assert.deepEqual(Array.from(lanePicks, (item) => grouping.resolveFoodLane(item, foodCats)),
  ['offline', 'offline', 'online', 'online', 'recipe'],
  'recipe wins over channel, both-channel counts as offline, no channel counts as online');
const laneSections = grouping.buildProfileThemeSections(lanePicks, foodCats);
assert.deepEqual(Array.from(laneSections, (section) => section.label), ['FOOD']);
assert.deepEqual(Array.from(laneSections[0].groups, (group) => `${group.name}:${group.items.length}`), ['오프라인 맛집:2', '온라인 맛집:2', '레시피:1'], 'lanes in fixed order');
assert.ok(laneSections[0].groups.every((group) => group.kind === 'channel'));
assert.deepEqual(Array.from(grouping.buildFoodLaneGroups(lanePicks.slice(0, 1), foodCats), (group) => group.id), ['offline'], 'empty lanes are hidden');

const component = read('src/components/profile-pick-groups.tsx');
const owner = read('src/app/(tabs)/(profile)/profile.tsx');
const publicProfile = read('src/app/(tabs)/(profile)/u/[username].tsx');
const exploreHook = read('src/hooks/useExploreData.ts');
const queryKeys = read('src/lib/query/queryKeys.ts');

assert.match(component, /picks\.length > 6 && groups\.length > 1/);
assert.match(component, /defaultCollapsedProfilePickGroups/);
assert.match(component, /모두 펼치기/);
assert.match(component, /모두 접기/);
assert.match(component, /accessibilityState=\{\{ expanded: !isCollapsed \}\}/);
assert.match(component, /<ProfilePickCard/);
assert.match(component, /layout="row"/, 'current Picks render as readable v4 rows');
assert.match(component, /providerName=\{providerName\}/, 'food rows keep provider/source separate from the menu title');
assert.match(component, /channelLabel=\{channelLabel\}/, 'food rows show the short channel badge before the provider');
assert.match(component, /onPressProvider=\{item\.item\?\.providerId && onPressProvider/, 'provider-backed rows expose their internal provider profile');
assert.match(component, /groupBody: \{ gap: 10 \}/, 'rows stack vertically without a 2-column grid');
assert.doesNotMatch(component, /remaining/, 'profiles no longer list categories still without a Pick');
assert.match(component, /buildProfileThemeSections\(picks, categories\)/);
assert.match(component, /showThemeHeaders = sections\.length > 1/, 'a single theme header is hidden because the screen section already names the taste scope');
assert.match(component, /group\.id === 'recipe'[\s\S]*?item\.item\?\.creatorName \?\? null/, 'recipe provider is shown only when creator metadata exists');
assert.doesNotMatch(component, /creatorName \?\? item\.item\?\.name/, 'recipe titles are never guessed as provider names');

assert.equal(grouping.remainingProfileCategories, undefined, 'the remaining-category helper is gone');

assert.doesNotMatch(owner, /<ProfilePickGroups/, 'Owner profile intentionally renders direct #757 rows');
assert.match(owner, /profilePicks\.map\(\(item\) => <ProfileCurrentPickRow/, 'owner profile lists the early-MVP food scope with the shared row');
assert.doesNotMatch(owner, /음식 원픽 보기|기타 원픽 보기/, 'no 음식 / 기타 chips in the early MVP');
assert.doesNotMatch(owner, /pathname: '\/provider\/\[providerId\]'/, '#757: the whole row is one button to the Pick detail, which carries the provider link');
assert.match(owner, /useExploreCategories\(Boolean\(user && profileQuery\.data\)\)/);
assert.doesNotMatch(publicProfile, /<ProfilePickGroups/, 'Public profile intentionally renders direct #757 rows');
assert.match(publicProfile, /profilePicks\.map\(\(item\) => <ProfileCurrentPickRow/, 'public profile lists the same scope with the shared row');
assert.doesNotMatch(publicProfile, /음식 원픽 보기|기타 원픽 보기/, 'no 음식 / 기타 chips in the early MVP');
assert.doesNotMatch(publicProfile, /pathname: '\/provider\/\[providerId\]'/, '#757: public rows are single buttons to the Pick detail');
assert.match(publicProfile, /useExploreCategories\(Boolean\(query\.data\)\)/);

assert.match(queryKeys, /browse: \['categories', 'browse'\] as const/);
assert.match(exploreHook, /queryKey: queryKeys\.categories\.browse/);
assert.match(exploreHook, /enabled,[\s\S]*staleTime: CATEGORY_BROWSE_STALE_TIME/);

// #826 GPT review + #757 PM 6098494493: the share counts only what visitors see — active,
// with a reviewed photo, in a visible category. Awaiting review, photo-less, a pending
// candidate photo or a hidden category does not count.
{
  const visible = { id: 'leaf', parentId: 'food', name: '냉면', slug: 'leaf', isVisible: true };
  const hiddenLeaf = { id: 'hidden', parentId: 'food', name: '숨은 메뉴', slug: 'hidden', isVisible: false };
  const catalog = [{ id: 'food', parentId: null, name: '음식', slug: 'food', isVisible: true }, visible];
  const shown = (status, item, categoryId = 'leaf', category = visible) => ({ pick: { id: 'p', status, categoryId, channel: 'offline' }, item, category });
  const photo = { imagePath: null, imageUrl: null, thumbnailUrl: null, imageSourceUrl: 'https://onepick.test/a.jpg' };
  assert.equal(grouping.isPublicProfilePick(shown('active', photo), catalog), true, 'active with a photo is public');
  assert.equal(grouping.isPublicProfilePick(shown('needs_review', photo), catalog), false, 'awaiting review is not public');
  assert.equal(grouping.isPublicProfilePick(shown('active', { ...photo, imageSourceUrl: '  ' }), catalog), false, 'blank photo fields are not a photo');
  assert.equal(grouping.isPublicProfilePick(shown('active', null), catalog), false, 'no item is not public');
  assert.equal(grouping.isPublicProfilePick(shown('active', { ...photo, imageSourceUrl: null, imageUrl: 'https://onepick.test/c.jpg', photoPendingReview: true }), catalog), false,
    'my own candidate photo overlay does not make a Pick public');
  assert.equal(grouping.isPublicProfilePick(shown('active', photo, 'hidden', hiddenLeaf), catalog), false, 'a hidden own category is not public');
  assert.equal(grouping.isPublicProfilePick(shown('active', photo, 'hidden', null), catalog), false, 'an unknown own category is not public');
  assert.equal(grouping.isPublicProfilePick(shown('active', photo, 'leaf', null), catalog), true, 'a catalog (visible-only) category is public without an embedded row');
  assert.equal(grouping.isPublicProfilePick(shown('active', photo, 'leaf', visible), []), true, 'an embedded visible row counts before the catalog has it');
  assert.equal(grouping.isPublicProfilePick(shown('active', photo, 'leaf', { ...visible, id: 'other' }), []), false, 'an embedded row for another category does not vouch for this one');

  // Public list / N / share count = MVP food scope ∩ public; the owner's management list keeps the hidden one.
  const picks = [shown('active', photo), shown('active', photo, 'hidden', hiddenLeaf), shown('needs_review', photo)];
  assert.equal(grouping.filterMvpProfilePicks(picks, catalog, 'food', ['offline', 'online']).length, 3, 'owner list keeps hidden-category and pending Picks to manage');
  assert.equal(grouping.filterPublicMvpProfilePicks(picks, catalog, 'food', ['offline', 'online']).length, 1, 'public scope drops hidden-category and pending Picks');
  assert.equal(grouping.publicProfileShareCount(picks, catalog, 'food', ['offline', 'online']), 1, 'share count is the public scope');
  assert.equal(grouping.publicProfileShareCount(picks, undefined, 'food', ['offline', 'online']), null, 'an unverified catalog shares no count instead of 0');
  assert.equal(grouping.publicProfileShareCount([], catalog, 'food', ['offline', 'online']), 0, 'a verified empty scope may share 0');
}

console.log('Profile Pick groups checks passed: grouping helpers remain for library use while Figma 03 owner and Figma 40 public profiles use direct compact rows.');
