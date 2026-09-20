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
assert.deepEqual(groups.map((group) => group.id), ['food', 'culture', 'tech', 'style']);
assert.deepEqual(groups.map((group) => group.name), ['음식', '문화', '기술', '스타일']);
assert.deepEqual(groups[0].items.map((item) => item.category.name), ['과자', '라면']);
assert.deepEqual(groups[1].items.map((item) => item.category.name), ['영화', '드라마', '게임']);
assert.equal(groups.reduce((sum, group) => sum + group.items.length, 0), seven.length, 'grouping must never drop Picks');

const longCollapsed = grouping.defaultCollapsedProfilePickGroups(groups, seven.length);
assert.deepEqual([...longCollapsed], ['tech', 'style'], '7+ Picks keep only the first two groups open by default');
assert.equal(grouping.defaultCollapsedProfilePickGroups(groups, 6).size, 0, '6 or fewer Picks stay fully expanded');

const fallback = grouping.buildProfilePickGroups(seven.slice(0, 3), []);
assert.deepEqual(fallback.map((group) => group.name), ['영화', '라면', '스마트폰'].sort((a, b) => {
  const sort = { '라면': 2, '영화': 1, '스마트폰': 1 };
  return sort[a] - sort[b] || a.localeCompare(b);
}));
assert.equal(fallback.reduce((sum, group) => sum + group.items.length, 0), 3, 'fallback still exposes every Pick without the parent catalog');

const component = read('src/components/profile-pick-groups.tsx');
const owner = read('src/app/(tabs)/profile.tsx');
const publicProfile = read('src/app/u/[username].tsx');
const exploreHook = read('src/hooks/useExploreData.ts');
const queryKeys = read('src/lib/query/queryKeys.ts');

assert.match(component, /picks\.length > 6 && groups\.length > 1/);
assert.match(component, /defaultCollapsedProfilePickGroups/);
assert.match(component, /모두 펼치기/);
assert.match(component, /모두 접기/);
assert.match(component, /accessibilityState=\{\{ expanded: !isCollapsed \}\}/);
assert.match(component, /<ProfilePickCard/);

assert.match(owner, /<ProfilePickGroups/);
assert.match(owner, /categories=\{categoriesQuery\.data \?\? \[\]\}/);
assert.match(owner, /useExploreCategories\(Boolean\(user && profileQuery\.data\)\)/);
assert.match(publicProfile, /<ProfilePickGroups/);
assert.match(publicProfile, /categories=\{categoriesQuery\.data \?\? \[\]\}/);
assert.match(publicProfile, /useExploreCategories\(Boolean\(query\.data\)\)/);

assert.match(queryKeys, /browse: \['categories', 'browse'\] as const/);
assert.match(exploreHook, /queryKey: queryKeys\.categories\.browse/);
assert.match(exploreHook, /enabled \}\);/);

console.log('Profile Pick groups checks passed: parent grouping, stable sort, 6/7 collapse boundary, fallback, controls, and owner/public reuse.');
