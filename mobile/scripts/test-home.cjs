const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(relativePath, imports = {}) {
  const file = path.join(__dirname, '..', 'src', relativePath);
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports,
    require: (name) => {
      assert.ok(name in imports, 'Unexpected runtime dependency: ' + name);
      return imports[name];
    },
  });
  return exports;
}

const { HomeService } = loadSource('services/homeService.ts');
const category = (id, isPickable = true) => ({ id, name: id, status: 'open', isVisible: true, isPickable });
const categories = [category('picked'), category('review'), category('new'), category('locked', false)];
const picks = [
  { id: 'p1', categoryId: 'picked', productId: 'one', userId: 'me', status: 'active' },
  { id: 'p2', categoryId: 'review', productId: 'missing', userId: 'me', status: 'needs_review' },
  ...Array.from({ length: 3 }, (_, i) => ({ id: 'extra' + i, categoryId: 'old' + i, productId: 'one', userId: 'me', status: 'active' })),
];
const recent = [{ id: 'other', userId: 'someone', categoryId: 'new', productId: 'two' }];
let calls = [];
const service = new HomeService(
  {
    getOpenCategories: async () => categories,
    getById: async (id) => categories.find((item) => item.id === id) ?? null,
  },
  {
    getCurrentPicksByUser: async (id) => { calls.push(['current', id]); return picks; },
    getRecentPicks: async (input) => { calls.push(['recent', input.excludeUserId]); return recent; },
  },
  {
    getById: async (id) => id === 'missing' ? null : { id, name: id },
    getByCategory: async (id) => { calls.push(['products', id]); return [{ id: 'two', categoryId: id }]; },
  },
  { getById: async (id) => ({ id, username: 'reader' }) },
);

async function main() {
  const home = await service.getHomeData('me');
  assert.equal(home.currentPicks.length, 5, 'Keep all current picks, including needs_review');
  assert.equal(home.currentPicks[1].product, null, 'Missing metadata must not remove current selections');
  assert.equal(home.categoriesToPick.length, 1);
  assert.equal(home.categoriesToPick[0].category.id, 'new');
  assert.ok(!calls.some(([kind]) => kind === 'products'), 'Registration does not require a category product catalog');
  assert.equal(home.feed[0].profile.username, 'reader');
  assert.ok(calls.some(([kind, id]) => kind === 'recent' && id === 'me'));

  calls = [];
  const publicHome = await service.getHomeData();
  assert.equal(publicHome.mode, 'multi_category');
  assert.equal(publicHome.openCategories.length, 4);
  assert.equal(publicHome.currentPicks.length, 0);
  assert.equal(publicHome.categoriesToPick.length, 0);
  assert.equal(publicHome.feed.length, 0);
  assert.ok(!calls.some(([kind]) => kind === 'current' || kind === 'products'));

  categories.splice(0, categories.length, category('only'));
  const single = await service.getHomeData();
  assert.equal(single.mode, 'single_category');
  assert.equal(single.singleCategory.id, 'only');
  assert.equal(single.singleCategoryProducts[0].categoryId, 'only');

  categories.length = 0;
  recent.length = 0;
  picks.length = 0;
  const empty = await service.getHomeData('new-user');
  assert.equal(empty.singleCategory, null);
  assert.equal(empty.currentPicks.length, 0);
  assert.equal(empty.categoriesToPick.length, 0);
  assert.equal(empty.feed.length, 0);

  const failure = new HomeService({ getOpenCategories: async () => { throw new Error('offline'); } });
  await assert.rejects(() => failure.getHomeData('me'), /offline/);

  const queryCalls = [];
  const query = { then: (resolve) => resolve({ data: [], error: null }) };
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'neq']) {
    query[method] = (...args) => { queryCalls.push([method, ...args]); return query; };
  }
  const { SupabasePickRepository } = loadSource('repositories/supabase/supabasePickRepository.ts', {
    '@/errors/appError': { AppError: Error },
    '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
    '@/repositories/mappers/pickMapper': { mapPickRow: (row) => row },
  });
  const repository = new SupabasePickRepository({ from: () => query });
  await repository.getCurrentPicksByUser('me');
  assert.ok(queryCalls.some(([method, field, value]) => method === 'eq' && field === 'user_id' && value === 'me'));
  assert.ok(queryCalls.some(([method, field, values]) => method === 'in' && field === 'status' && values.join(',') === 'active,needs_review'));
  queryCalls.length = 0;
  await repository.getRecentPicks({ limit: 20, excludeUserId: 'me' });
  assert.ok(queryCalls.some(([method, field, value]) => method === 'neq' && field === 'user_id' && value === 'me'));
  queryCalls.length = 0;
  await repository.getRecentPicks({ limit: 20 });
  assert.ok(!queryCalls.some(([method]) => method === 'neq'));
  console.log('Home regression checks passed: personalized/public/empty/error and repository filters.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
