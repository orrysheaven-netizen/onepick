const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function load(relative, imports = {}) {
  const moduleExports = {};
  const output = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, {
    exports: moduleExports,
    require: (name) => {
      if (name in imports) return imports[name];
      assert.fail(`Unexpected import: ${name}`);
    },
  });
  return moduleExports;
}

const tree = load('src/lib/categories/categoryTree.ts');
const filters = load('src/lib/home/homeCategoryFilters.ts', {
  '@/lib/categories/categoryTree': tree,
});

const categories = [
  { id: 'food', slug: 'food', parentId: null, name: '음식', status: 'open', isVisible: true, isPickable: false, sortOrder: 10 },
  { id: 'culture', slug: 'culture', parentId: null, name: '문화', status: 'open', isVisible: true, isPickable: false, sortOrder: 20 },
  { id: 'tech', slug: 'tech', parentId: null, name: '기술', status: 'open', isVisible: true, isPickable: false, sortOrder: 30 },
  { id: 'ramen', slug: 'ramen', parentId: 'food', name: '라면', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
  { id: 'snacks', slug: 'snacks', parentId: 'food', name: '과자', status: 'open', isVisible: true, isPickable: true, sortOrder: 2 },
  { id: 'movie', slug: 'movie', parentId: 'culture', name: '영화', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
  { id: 'phone', slug: 'phone', parentId: 'tech', name: '스마트폰', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
];

assert.deepEqual(Array.from(filters.HOME_ROOT_SLUGS), ['food'], 'MVP Home starts with restaurants only');
assert.deepEqual(Array.from(filters.buildHomeCategoryFilters(categories), (group) => group.name), ['음식']);
const groups = filters.buildHomeCategoryFilters(categories, ['food', 'culture', 'tech']);
assert.deepEqual(Array.from(groups, (group) => group.name), ['음식', '문화', '기술']);
assert.deepEqual(Array.from(groups[0].categoryIds), ['ramen', 'snacks']);
assert.deepEqual(Array.from(groups[1].categoryIds), ['movie']);

const items = [
  { itemId: 'movie-new', categoryId: 'movie', name: '새 영화' },
  { itemId: 'ramen-new', categoryId: 'ramen', name: '새 라면' },
  { itemId: 'phone', categoryId: 'phone', name: '스마트폰' },
  { itemId: 'snacks-old', categoryId: 'snacks', name: '과자' },
  { itemId: 'ramen-old', categoryId: 'ramen', name: '오래된 라면' },
];

const food = groups.find((group) => group.id === 'food');
const culture = groups.find((group) => group.id === 'culture');
assert.deepEqual(
  Array.from(filters.filterHomeFeedByCategory(items, food), (item) => item.itemId),
  ['ramen-new', 'snacks-old', 'ramen-old'],
  'filtering preserves the Home service recent-order within a category group',
);
assert.deepEqual(Array.from(filters.filterHomeFeedByCategory(items, culture), (item) => item.itemId), ['movie-new']);
assert.deepEqual(Array.from(filters.filterHomeFeedByCategory(items, null), (item) => item.itemId), items.map((item) => item.itemId));

const restaurants = [
  { id: 'food', slug: 'food', parentId: null, name: '먹을것', status: 'open', isVisible: true, isPickable: false, sortOrder: 10 },
  { id: 'culture', slug: 'culture', parentId: null, name: '문화', status: 'open', isVisible: true, isPickable: false, sortOrder: 20 },
  { id: 'meat', slug: 'food-meat', parentId: 'food', name: '고기', status: 'open', isVisible: true, isPickable: false, sortOrder: 1 },
  { id: 'noodles', slug: 'food-noodles', parentId: 'food', name: '면', status: 'open', isVisible: true, isPickable: false, sortOrder: 2 },
  { id: 'daechang', slug: 'daechang', parentId: 'meat', name: '대창', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
  { id: 'makchang', slug: 'makchang', parentId: 'meat', name: '막창', status: 'open', isVisible: true, isPickable: true, sortOrder: 2 },
  { id: 'kalguksu', slug: 'kalguksu', parentId: 'noodles', name: '칼국수', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
  { id: 'soba', slug: 'soba', parentId: 'noodles', name: '소바', status: 'open', isVisible: true, isPickable: true, sortOrder: 2 },
  { id: 'movie', slug: 'movie', parentId: 'culture', name: '영화', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
];
assert.deepEqual(
  Array.from(filters.homeStarterCategories(restaurants), (category) => category.id),
  ['daechang', 'kalguksu'],
  'Signed-out starters take one food leaf per sub-group and never another top-level group',
);
assert.deepEqual(Array.from(filters.homeStarterCategories(restaurants, 1), (category) => category.id), ['daechang']);

const home = read('src/app/(tabs)/index.tsx');
assert.match(home, /buildHomeCategoryFilters/);
assert.match(home, /filterHomeFeedByCategory\(data\?\.picks \?\? \[\], selectedCategoryGroup\)/, 'the category filter narrows the people feed');
assert.match(home, /<Chip key=\{group\.id\} label=\{group\.name\} selected=\{selected\}/, 'Category filters are kit Chips, which expose accessibilityState.selected');
assert.match(home, /전체 카테고리 보기/);
assert.match(home, /다음 원픽 더 불러오기/);
// Search menu names are rendered by HomeSearchDialog, covered by
// test-home-search-loading.cjs; Home no longer builds unused search categories.
assert.match(home, /const publicCards = ready \? visiblePicks : \[\];/); assert.match(home, /data=\{publicCards\}/, 'MVP Home has one fixed offline feed, so no channel-switch placeholder gate remains');

console.log('Home category filter checks passed: top-level taxonomy, stable recency order, all/filter behavior and empty-filter recovery.');

