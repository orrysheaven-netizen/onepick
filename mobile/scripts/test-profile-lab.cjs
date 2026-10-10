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
  vm.runInNewContext(output, { exports: moduleExports, require: (name) => { assert.fail(`Unexpected import: ${name}`); } });
  return moduleExports;
}

const grouping = load('src/lib/profile/profilePickGroups.ts');
const constants = require('./design-tokens.cjs');

assert.equal(constants.OnePickFeatures.lab, true, '실험실 is on for the restaurant-first MVP');
assert.equal(constants.OnePickMvp.mainThemeCode, 'food');

const categories = [
  { id: 'food', parentId: null, name: '먹을것', slug: 'food', sortOrder: 1, themeCode: 'food' },
  { id: 'naengmyeon', parentId: 'food', name: '냉면', slug: 'naengmyeon', sortOrder: 1 },
  { id: 'recipe', parentId: 'food', name: '레시피', slug: 'recipe', sortOrder: 2 },
  { id: 'content', parentId: null, name: '콘텐츠', slug: 'content', sortOrder: 2, themeCode: 'culture' },
  { id: 'movie', parentId: 'content', name: '영화', slug: 'movie', sortOrder: 1, themeCode: 'culture' },
  { id: 'tech', parentId: null, name: '테크', slug: 'tech', sortOrder: 3, themeCode: 'tech' },
  { id: 'phone', parentId: 'tech', name: '스마트폰', slug: 'smartphone', sortOrder: 1 },
  { id: 'misc', parentId: null, name: '미분류', slug: 'misc', sortOrder: 9 },
];
const pick = (categoryId) => ({ pick: { id: `pick-${categoryId}`, categoryId, updatedAt: '2026-09-26T00:00:00Z' }, category: categories.find((c) => c.id === categoryId), item: null, profile: null });
const picks = ['naengmyeon', 'movie', 'phone', 'misc'].map(pick);

const split = grouping.splitLabPicks(picks, categories, 'food', true);
assert.deepEqual(Array.from(split.main, (item) => item.pick.categoryId), ['naengmyeon', 'misc'], 'FOOD and unmapped Picks stay on the main profile');
assert.deepEqual(Array.from(split.lab, (item) => item.pick.categoryId), ['movie', 'phone'], 'CULTURE & ART and TECH move to 실험실');
assert.equal(split.main.length + split.lab.length, picks.length, 'the split never drops a Pick');

const exposurePicks = [
  { ...pick('naengmyeon'), pick: { ...pick('naengmyeon').pick, id: 'food-offline', channel: 'offline' } },
  { ...pick('naengmyeon'), pick: { ...pick('naengmyeon').pick, id: 'food-online', channel: 'online' } },
  { ...pick('recipe'), pick: { ...pick('recipe').pick, id: 'food-recipe', channel: 'recipe' } },
  pick('misc'),
];
const exposedMain = grouping.filterMainProfileByChannel(exposurePicks, categories, 'food', 'offline');
assert.deepEqual(Array.from(exposedMain, (item) => item.pick.id), ['food-offline', 'pick-misc'],
  'MVP profile keeps offline FOOD plus unmapped legacy Picks, hiding online/recipe FOOD only');
assert.equal(grouping.filterMainProfileByChannel(exposurePicks, categories, 'culture', 'offline').length, exposurePicks.length,
  'Channel exposure is a FOOD-only rule and does not alter another main theme');
assert.deepEqual(
  Array.from(grouping.filterMainProfileByChannel(exposurePicks, [], 'food', 'offline'), (item) => item.pick.id),
  ['food-offline', 'pick-misc'],
  'Explicit online/recipe channels stay hidden even before the category catalog loads',
);

// #757/#879 early-MVP profile scope: food from a store or an online order; recipes,
// other themes and anything that cannot be placed in the food tree stay off the list.
{
  const mvpCategories = [
    ...categories,
    { id: 'gukbap', parentId: 'food', name: '국밥', slug: 'gukbap', sortOrder: 3 },
    { id: 'sundae-gukbap', parentId: 'gukbap', name: '순대국밥', slug: 'sundae-gukbap', sortOrder: 1 },
    { id: 'recipe-soup', parentId: 'recipe', name: '국 레시피', slug: 'recipe-soup', sortOrder: 1 },
  ];
  const at = (id, categoryId, channel, extra = {}) => ({
    pick: { id, categoryId, channel, updatedAt: '2026-10-10T00:00:00Z' },
    category: mvpCategories.find((c) => c.id === categoryId) ?? null,
    item: extra.item ?? null,
    profile: null,
  });
  const channels = constants.OnePickMvp.profileFoodChannels;
  assert.deepEqual(Array.from(channels), ['offline', 'online'], 'early MVP profile channels: offline + online, no recipe');
  const rows = [
    at('offline', 'naengmyeon', 'offline'),
    at('online', 'naengmyeon', 'online'),
    at('grandchild-online', 'sundae-gukbap', 'online'),
    at('recipe-channel', 'naengmyeon', 'recipe'),
    at('recipe-category', 'recipe', 'online'),
    at('recipe-descendant', 'recipe-soup', null),
    at('movie', 'movie', null),
    at('unmapped', 'misc', null),
    at('unknown-category', 'not-in-catalog', 'offline'),
    at('legacy-offline', 'naengmyeon', null, { item: { channels: ['offline', 'online'] } }),
    at('legacy-recipe-item', 'gukbap', null, { item: { channels: ['recipe'] } }),
    at('legacy-no-channel', 'gukbap', null, { item: { channels: [] } }),
  ];
  const ids = (list) => Array.from(list, (item) => item.pick.id);
  assert.deepEqual(ids(grouping.filterMvpProfilePicks(rows, mvpCategories, 'food', channels)),
    ['offline', 'online', 'grandchild-online', 'legacy-offline', 'legacy-no-channel'],
    'online food stays; recipe (channel, category or descendant), other themes, unmapped and unknown categories drop out');
  assert.deepEqual(ids(grouping.filterMvpProfilePicks(rows, [], 'food', channels)), [],
    'without the category catalog nothing passes by default');
  // A Pick whose own category is hidden from the browse catalog still inherits food through its parent.
  const hidden = { ...at('hidden-leaf', 'hidden-leaf', 'online'), category: { id: 'hidden-leaf', parentId: 'food', name: '숨은 메뉴', slug: 'hidden-leaf', sortOrder: 9 } };
  assert.equal(grouping.isMvpProfilePick(hidden, mvpCategories, 'food', channels), true, 'embedded category inherits the food root');
  const orphan = { ...at('orphan', 'orphan', 'offline'), category: { id: 'orphan', parentId: 'missing-parent', name: '고아', slug: 'orphan', sortOrder: 9 } };
  assert.equal(grouping.isMvpProfilePick(orphan, mvpCategories, 'food', channels), false, 'a broken ancestor chain is not food');
  assert.equal(grouping.isMvpProfilePick(at('offline-only', 'naengmyeon', 'online'), mvpCategories, 'food', ['offline']), false,
    'the channel set is honored as given');
}

const off = grouping.splitLabPicks(picks, categories, 'food', false);
assert.equal(off.main.length, picks.length, 'with the lab off every Pick stays main');
assert.equal(off.lab.length, 0);

// Before the catalog loads, themes are unknown and nothing is hidden.
assert.equal(grouping.splitLabPicks(picks, [], 'food', true).lab.length, 0);

assert.equal(grouping.isLabCategory('movie', categories, 'food', true), true);
assert.equal(grouping.isLabCategory('naengmyeon', categories, 'food', true), false);
assert.equal(grouping.isLabCategory('misc', categories, 'food', true), false);
assert.equal(grouping.isLabCategory('movie', categories, 'food', false), false);

// Wiring: profiles expose other tastes in place. Legacy /lab routes remain callable,
// but Explore no longer advertises a second 실험실 entry.
const lab = read('src/app/lab/[username].tsx');
const labIndex = read('src/app/lab/index.tsx');
const owner = read('src/app/(tabs)/(profile)/profile.tsx');
const publicProfile = read('src/app/(tabs)/(profile)/u/[username].tsx');
const explore = read('src/app/(tabs)/explore.tsx');
const find = read('src/app/pick/find.tsx');

assert.match(lab, /usePublicProfile\(username, user\?\.id\)/);
assert.doesNotMatch(lab, /onPressCategory/, '실험실 lists Picks only; the owner starts categories from the list below');
assert.match(lab, /isLabCategory\(category\.id, categories, OnePickMvp\.mainThemeCode, true\)/, 'the owner can start any lab category');
assert.match(labIndex, /pathname: '\/lab\/\[username\]', params: \{ username: profileQuery\.data\.profile\.username \}/, '/lab opens my own 실험실');
// Early MVP (#757/#879): both profiles list only the MVP food scope. No 음식/기타 chips and
// no 실험실 entry; the 실험실 routes, components and data stay in place for later.
for (const [name, screen] of [['owner', owner], ['public', publicProfile]]) {
  assert.match(screen, /filter(Public)?MvpProfilePicks\((query\.data\?\.)?currentPicks \?\? \[\]|filterMvpProfilePicks\(currentPicks,/, `${name} profile filters the full current collection`);
  assert.match(screen, /OnePickMvp\.browseGroupSlug, OnePickMvp\.profileFoodChannels\)/, `${name} profile uses the shared MVP scope`);
  assert.doesNotMatch(screen, /음식 원픽 보기|기타 원픽 보기|profileScope|labPicks|filterMainProfileByChannel/, `${name} profile has no 음식/기타 scope tabs`);
  assert.doesNotMatch(screen, /router\.push\('\/lab'\)/, `${name} profile does not advertise 실험실 during the early MVP`);
  assert.match(screen, /key: 'picks', label: '원픽', value: pickCountLabel/, `${name} 원픽 N follows the listed scope`);
}
assert.match(publicProfile, /filterPublicMvpProfilePicks\(query\.data\?\.currentPicks \?\? \[\]/, 'the public list is the MVP scope narrowed to visible categories (#757 PM 6098494493)');
assert.match(publicProfile, /const currentPicks = catalog\s*\? filterPublicMvpProfilePicks\(query\.data\.currentPicks, catalog, OnePickMvp\.browseGroupSlug, OnePickMvp\.profileFoodChannels\)/,
  'the share card carries the same Picks as the list');
assert.doesNotMatch(owner, /filterPublicMvpProfilePicks\(currentPicks, categoriesQuery/, 'the owner list keeps hidden-category Picks to manage; only its share narrows');
assert.doesNotMatch(explore, /router\.push\('\/lab'\)/, 'Explore no longer duplicates the 다른 취향 entry with a 실험실 door');
assert.doesNotMatch(explore, /ProfileLabEntry/, 'Explore does not render the legacy lab entry component');
assert.match(find, /: !isLabCategory\(item\.categoryId, themeCatalog\.data \?\? \[\], OnePickMvp\.mainThemeCode, OnePickFeatures\.lab\)/, 'unscoped search hides 실험실 results');
assert.match(find, /\? item\.categoryId === selectedCategory\.id/, 'a category-scoped (실험실) search is unaffected');

console.log('실험실 checks passed: main/lab split, early-MVP profile scope, hidden Explore entry, legacy routes and search scope.');
