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
// People-first feed: one row per person's current Pick, with their own reason.
const feed = { nextCursor: { timestamp: '2026-09-21T09:00:00.000000+00:00', id: 'pick-20' }, items: [{
  pickId: 'friend-pick', userId: 'friend', username: 'friend', profileImageUrl: null,
  itemId: 'ramen', name: '신라면', categoryId: 'new', categoryName: '라면',
  oneLineReview: '친구의 이유', thumbnailUrl: null, startedAt: '2026-09-21T10:00:00.000000+00:00',
}] };
let calls = [];
const readRepository = {
  getPicks: async (input) => { calls.push(['private', input]); assert.ok(input.userId); return current; },
  getHomePicks: async (cursor) => { calls.push(['feed', cursor]); return feed; },
  getHomeShowcase: async () => assert.fail('Home no longer reads the aggregate product showcase'),
  getEditorialHomeItems: async () => { calls.push(['editorial']); return [{ itemId: 'editorial', name: '먼저 소개할 원픽' }]; },
};
const itemRepository = { getByCategory: async () => assert.fail('Home must not list unqualified catalog products') };
const service = new HomeService({ getOpenCategories: async () => categories }, itemRepository, readRepository);

async function main() {
  const home = await service.getHomeData('me');
  assert.equal(home.currentPicks.length, 2);
  assert.equal(home.currentPicks[1].item, null, 'Missing metadata must not remove the private collection count');
  assert.equal('categoriesToPick' in home, false, 'Home no longer computes unselected categories');
  assert.equal('minimumPickCount' in home, false, 'People-first Home has no minimum pick count');
  assert.equal(home.picks[0].pickId, 'friend-pick');
  assert.equal(home.picks[0].username, 'friend');
  assert.equal(home.picks[0].oneLineReview, '친구의 이유', 'Each card carries that person’s own reason');
  assert.equal(home.nextCursor.id, 'pick-20');
  assert.equal(home.editorialItems[0].itemId, 'editorial');
  assert.equal(calls.filter(([kind]) => kind === 'feed').length, 1, 'One feed page per request');
  assert.equal(calls.find(([kind]) => kind === 'feed')[1], null, 'First page starts without a cursor');
  assert.equal(calls.filter(([kind]) => kind === 'private').length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'editorial').length, 1);
  calls = [];
  const publicHome = await service.getHomeData();
  assert.equal(publicHome.currentPicks.length, 0);
  assert.equal(publicHome.picks, home.picks, 'Visitors browse the same people feed (the server decides self/block exclusion)');
  assert.equal(calls.length, 2, 'Visitors fetch the feed and editorial recommendations only');
  assert.equal(calls.some(([kind]) => kind === 'private'), false);
  calls = [];
  const nextPage = await service.getHomeData('me', feed.nextCursor);
  assert.equal(calls.find(([kind]) => kind === 'feed')[1], feed.nextCursor, 'Later pages pass the cursor through');
  assert.equal(nextPage.editorialItems.length, 0, 'Editorial picks load once, on the first page');
  categories.splice(0, categories.length, category('only'));
  feed.items = []; feed.nextCursor = null;
  const empty = await service.getHomeData();
  assert.equal(empty.picks.length, 0);
  assert.equal(empty.nextCursor, null);
  const failure = new HomeService({ getOpenCategories: async () => { throw new Error('offline'); } });
  await assert.rejects(() => failure.getHomeData('me'), /offline/);
  console.log('Home checks passed: people-first feed rows with reasons, cursor pass-through, no catalog fallback, private collection and empty state.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
