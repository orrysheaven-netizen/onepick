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
assert.match(owner, /profileScope === 'food' \? publicMainPicks : labPicks/, 'owner shows only the public FOOD channel while keeping other tastes in place');
assert.match(owner, /음식 원픽 보기/);
assert.match(owner, /기타 원픽 보기/);
// 실험실 is the only place to start a non-food Pick; with Explore's door gone the
// owner's 기타 tab must still lead there, whether it is empty or not.
assert.match(owner, /const openLab = \(\) => router\.push\('\/lab'\);/, 'the owner profile can open 실험실');
assert.match(owner, /label: '기타 원픽 고르기', variant: 'secondary', onPress: openLab/, 'an empty 기타 tab offers the 실험실 entry');
assert.match(owner, /profileScope === 'other' && visibleProfilePicks\.length > 0 \? \(\s*<Button[^>]*label="기타 원픽 고르기"[\s\S]*?onPress=\{openLab\}/,
  'a filled 기타 tab keeps the 실험실 entry');
assert.match(publicProfile, /profileScope === 'food' \? publicMainPicks : labPicks/, 'public profile shows only the public FOOD channel while keeping other tastes in place');
assert.match(publicProfile, /음식 원픽 보기/);
assert.match(publicProfile, /기타 원픽 보기/);
assert.match(owner, /filterMainProfileByChannel\(mainPicks, profileCategories, OnePickMvp\.mainThemeCode, OnePickMvp\.publicPickChannel\)/);
assert.match(publicProfile, /filterMainProfileByChannel\(mainPicks, profileCategories, OnePickMvp\.mainThemeCode, OnePickMvp\.publicPickChannel\)/);
assert.match(publicProfile, /const currentPicks = publicMainPicks;/, 'the share card carries only publicly exposed FOOD Picks');
assert.doesNotMatch(explore, /router\.push\('\/lab'\)/, 'Explore no longer duplicates the 다른 취향 entry with a 실험실 door');
assert.doesNotMatch(explore, /ProfileLabEntry/, 'Explore does not render the legacy lab entry component');
assert.match(find, /: !isLabCategory\(item\.categoryId, themeCatalog\.data \?\? \[\], OnePickMvp\.mainThemeCode, OnePickFeatures\.lab\)/, 'unscoped search hides 실험실 results');
assert.match(find, /\? item\.categoryId === selectedCategory\.id/, 'a category-scoped (실험실) search is unaffected');

console.log('실험실 checks passed: main/lab split, profile taste tabs, hidden Explore entry, legacy routes and search scope.');
