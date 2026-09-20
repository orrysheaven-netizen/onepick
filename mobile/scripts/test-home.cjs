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
const showcase = { minimumPickCount: 3, items: [{
  itemId: 'qualified', name: '선택이 모인 제품', categoryId: 'new', categoryName: '새 카테고리',
  pickCount: 3, thumbnailUrl: null, latestPickId: 'latest-pick', latestPickerUsername: 'friend', latestPickReview: '친구의 이유',
}] };
let calls = [];
const readRepository = {
  getPicks: async (input) => { calls.push(['private', input]); assert.ok(input.userId); return current; },
  getHomeShowcase: async () => { calls.push(['showcase']); return showcase; },
  getEditorialHomeItems: async () => { calls.push(['editorial']); return [{ itemId: 'editorial', name: '먼저 소개할 원픽' }]; },
};
const itemRepository = { getByCategory: async () => assert.fail('Home must not list unqualified catalog products') };
const service = new HomeService({ getOpenCategories: async () => categories }, itemRepository, readRepository);

async function main() {
  const home = await service.getHomeData('me');
  assert.equal(home.currentPicks.length, 2);
  assert.equal(home.currentPicks[1].item, null, 'Missing metadata must not remove the private collection count');
  assert.equal('categoriesToPick' in home, false, 'Home no longer computes unselected categories');
  assert.equal(home.minimumPickCount, 3);
  assert.equal(home.featuredItems[0].itemId, 'qualified');
  assert.equal(home.featuredItems[0].latestPickerUsername, 'friend');
  assert.equal(home.editorialItems[0].itemId, 'editorial');
  assert.equal(calls.filter(([kind]) => kind === 'showcase').length, 1, 'Use one aggregate, not per-product count requests');
  assert.equal(calls.filter(([kind]) => kind === 'private').length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'editorial').length, 1);
  calls = [];
  const publicHome = await service.getHomeData();
  assert.equal(publicHome.currentPicks.length, 0);
  assert.equal(publicHome.featuredItems, home.featuredItems, 'Visitors see the same threshold-qualified products');
  assert.equal(calls.length, 2, 'Visitors fetch public showcase and editorial recommendations only');
  assert.equal(calls.some(([kind]) => kind === 'private'), false);
  categories.splice(0, categories.length, category('only'));
  showcase.minimumPickCount = 5;
  showcase.items = [];
  const empty = await service.getHomeData();
  assert.equal(empty.minimumPickCount, 5, 'Empty Home still reports the actual administrator setting');
  assert.equal(empty.featuredItems.length, 0, 'Single-category mode must not bypass the threshold');
  const failure = new HomeService({ getOpenCategories: async () => { throw new Error('offline'); } });
  await assert.rejects(() => failure.getHomeData('me'), /offline/);
  console.log('Home checks passed: qualified public products, no catalog fallback, one aggregate, private collection and configurable empty state.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
