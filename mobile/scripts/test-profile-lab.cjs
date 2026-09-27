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

const off = grouping.splitLabPicks(picks, categories, 'food', false);
assert.equal(off.main.length, picks.length, 'with the lab off every Pick stays main');
assert.equal(off.lab.length, 0);

// Before the catalog loads, themes are unknown and nothing is hidden.
assert.equal(grouping.splitLabPicks(picks, [], 'food', true).lab.length, 0);

assert.equal(grouping.isLabCategory('movie', categories, 'food', true), true);
assert.equal(grouping.isLabCategory('naengmyeon', categories, 'food', true), false);
assert.equal(grouping.isLabCategory('misc', categories, 'food', true), false);
assert.equal(grouping.isLabCategory('movie', categories, 'food', false), false);

// Wiring: every main flow filters 실험실 themes out; 실험실 has its own route and entries.
const lab = read('src/app/lab/[username].tsx');
const labIndex = read('src/app/lab/index.tsx');
const owner = read('src/app/(tabs)/profile.tsx');
const publicProfile = read('src/app/u/[username].tsx');
const explore = read('src/app/(tabs)/explore.tsx');
const onboarding = read('src/app/onboarding.tsx');
const find = read('src/app/pick/find.tsx');

assert.match(lab, /usePublicProfile\(username, user\?\.id\)/);
assert.doesNotMatch(lab, /onPressCategory/, '실험실 lists Picks only; the owner starts categories from the list below');
assert.match(lab, /isLabCategory\(category\.id, categories, OnePickMvp\.mainThemeCode, true\)/, 'the owner can start any lab category');
assert.match(labIndex, /pathname: '\/lab\/\[username\]', params: \{ username: profileQuery\.data\.profile\.username \}/, '/lab opens my own 실험실');
assert.match(owner, /profileScope === 'food' \? mainPicks : labPicks/, 'owner toggles 음식 and 다른 취향 in place');
assert.match(owner, /음식 원픽 보기/);
assert.match(owner, /다른 취향 원픽 보기/);
assert.match(publicProfile, /profileScope === 'food' \? mainPicks : labPicks/, 'public profile toggles the same scopes in place');
assert.match(publicProfile, /음식 원픽 보기/);
assert.match(publicProfile, /다른 취향 원픽 보기/);
assert.match(publicProfile, /const currentPicks = mainPicks;/, 'the share card carries only main-theme Picks');
assert.match(explore, /router\.push\('\/lab'\)/, 'Explore has a 실험실 entry');
assert.match(onboarding, /!isLabCategory\(category\.id, categoryCatalog\.data \?\? \[\], OnePickMvp\.mainThemeCode, OnePickFeatures\.lab\)/, 'onboarding offers only main-theme categories');
assert.match(onboarding, /catalogReady = !OnePickFeatures\.lab \|\| Boolean\(categoryCatalog\.data\) \|\| categoryCatalog\.isError/, 'onboarding waits for themes but falls back on a catalog error');
assert.match(find, /: !isLabCategory\(item\.categoryId, themeCatalog\.data \?\? \[\], OnePickMvp\.mainThemeCode, OnePickFeatures\.lab\)/, 'unscoped search hides 실험실 results');
assert.match(find, /\? item\.categoryId === selectedCategory\.id/, 'a category-scoped (실험실) search is unaffected');

console.log('실험실 checks passed: main/lab split, flag off, unknown themes, lab route and entries, onboarding and search scope.');
