const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(relativePath, imports = {}) {
  const result = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, { exports, require: (name) => { assert.ok(name in imports, name); return imports[name]; } });
  return exports;
}

const { HomeService } = loadSource('services/homeService.ts');
const category = (id) => ({ id, name: id, status: 'open', isVisible: true, isPickable: true });
const categories = [category('picked'), category('review'), category('new')];
const current = [
  { pick: { id: 'p1', categoryId: 'picked', itemId: 'one', userId: 'me', status: 'active' }, category: categories[0], item: { id: 'one' }, profile: null },
  { pick: { id: 'p2', categoryId: 'review', itemId: 'missing', userId: 'me', status: 'needs_review' }, category: categories[1], item: null, profile: null },
];
const feed = [{ pick: { id: 'other', userId: 'someone', categoryId: 'new', itemId: 'two', status: 'active' }, category: categories[2], item: { id: 'two' }, profile: { id: 'someone', username: 'reader' } }];
let calls = [];
const readRepository = {
  getPicks: async (input) => {
    calls.push(['read', input]);
    return input.userId ? current : feed;
  },
};
const itemRepository = { getByCategory: async (id) => { calls.push(['items', id]); return [{ id: 'two', categoryId: id }]; } };
const service = new HomeService({ getOpenCategories: async () => categories }, itemRepository, readRepository);

async function main() {
  const home = await service.getHomeData('me');
  assert.equal(home.currentPicks.length, 2);
  assert.equal(home.currentPicks[1].item, null, 'Missing metadata must not remove current selections');
  assert.equal(home.categoriesToPick.length, 1);
  assert.equal(home.categoriesToPick[0].category.id, 'new');
  assert.equal(home.feed[0].profile.username, 'reader');
  assert.equal(calls.filter(([kind]) => kind === 'read').length, 2, 'Personalized home uses two hydrated pick reads, not per-item reads');
  assert.ok(calls.some(([kind, input]) => kind === 'read' && input.excludeUserId === 'me'));

  calls = [];
  const publicHome = await service.getHomeData();
  assert.equal(publicHome.mode, 'multi_category');
  assert.equal(publicHome.currentPicks.length, 0);
  assert.equal(publicHome.feed.length, 0);
  assert.equal(calls.filter(([kind]) => kind === 'read').length, 0);

  categories.splice(0, categories.length, category('only'));
  const single = await service.getHomeData();
  assert.equal(single.mode, 'single_category');
  assert.equal(single.singleCategoryItems[0].categoryId, 'only');
  assert.ok(calls.some(([kind, id]) => kind === 'items' && id === 'only'));

  categories.length = 0;
  current.length = 0;
  feed.length = 0;
  const empty = await service.getHomeData('new-user');
  assert.equal(empty.singleCategory, null);
  assert.equal(empty.currentPicks.length, 0);
  assert.equal(empty.feed.length, 0);

  const failure = new HomeService({ getOpenCategories: async () => { throw new Error('offline'); } });
  await assert.rejects(() => failure.getHomeData('me'), /offline/);
  console.log('Home regression checks passed: hydrated reads, personalized/public/empty/error states.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
