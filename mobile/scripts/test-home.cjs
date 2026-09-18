const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function loadSource(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name) => assert.fail(name) });
  return exports;
}
const { HomeService } = loadSource('services/homeService.ts');
const category = (id) => ({ id, name: id, status: 'open', isVisible: true, isPickable: true });
const categories = [category('picked'), category('review'), category('new')];
const current = [
  { pick: { id: 'p1', categoryId: 'picked', itemId: 'one', userId: 'me', status: 'active' }, category: categories[0], item: { id: 'one' }, profile: null },
  { pick: { id: 'p2', categoryId: 'review', itemId: 'missing', userId: 'me', status: 'needs_review' }, category: categories[1], item: null, profile: null },
];
const cursor = { timestamp: '2026-09-18T01:00:00.123456Z', id: 'last-pick' };
const feed = { nextCursor: cursor, items: [
  { pickId: 'a', userId: 'friend', itemId: 'same-product', categoryId: 'new', oneLineReview: 'First opinion' },
  { pickId: 'b', userId: 'someone', itemId: 'same-product', categoryId: 'new', oneLineReview: 'Different opinion' },
  { pickId: 'own', userId: 'me', itemId: 'one', categoryId: 'picked' },
  { pickId: 'closed', userId: 'someone', itemId: 'private', categoryId: 'closed' },
] };
let calls = [];
const readRepository = {
  getPicks: async (input) => { calls.push(['private', input]); assert.equal(input.userId, 'me'); return current; },
  getHomePicks: async (page) => { calls.push(['people', page]); return feed; },
  getHomeShowcase: async () => assert.fail('Person-first home must not use popularity thresholds'),
};
const itemRepository = { getByCategory: async () => assert.fail('Do not invent a person by falling back to bare products') };
const service = new HomeService({ getOpenCategories: async () => categories }, itemRepository, readRepository);
async function main() {
  const home = await service.getHomeData('me', cursor);
  assert.equal(home.currentPicks.length, 2);
  assert.equal(home.currentPicks[1].item, null, 'Keep private collection counts even if an item is unavailable');
  assert.equal(home.categoriesToPick.length, 1); assert.equal(home.categoriesToPick[0].category.id, 'new');
  assert.equal(home.featuredPicks.map((p) => p.pickId).join(','), 'a,b', 'Keep two people on the same product; exclude self and nonpublic categories');
  assert.equal(home.nextCursor, cursor, 'Use server cursor, not a client-filtered row');
  assert.equal(calls.filter(([kind]) => kind === 'people').length, 1, 'One paginated read, no per-person query waterfall');
  assert.equal(calls[1][1], cursor);
  calls = [];
  const guest = await service.getHomeData();
  assert.equal(guest.currentPicks.length, 0); assert.equal(guest.categoriesToPick.length, 0);
  assert.equal(guest.featuredPicks.length, 3, 'Logged-out browsing has no self identity to exclude');
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'people', 'Visitors never fetch private Picks');
  categories.splice(0, categories.length, category('only'));
  feed.items = []; feed.nextCursor = null;
  const empty = await service.getHomeData();
  assert.equal(empty.featuredPicks.length, 0); assert.equal(empty.nextCursor, null);
  assert.equal('minimumPickCount' in empty, false, 'No popularity gate in the new home contract');
  const failure = new HomeService({ getOpenCategories: async () => { throw new Error('offline'); } });
  await assert.rejects(() => failure.getHomeData('me'), /offline/);
  readRepository.getHomePicks = async () => { throw new Error('feed failed'); };
  await assert.rejects(() => service.getHomeData(), /feed failed/, 'Never mask a feed failure with fake or old aggregate data');
  console.log('Home service passed: person-first feed, same-product opinions, self/category defence, private counts, public browsing, cursors and failure recovery.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
