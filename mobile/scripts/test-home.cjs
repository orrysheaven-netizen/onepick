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

const { HomeService } = loadSource('services/homeService.ts', { '@/lib/home/channelFeedMerge': loadSource('lib/home/channelFeedMerge.ts') });
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
};
const service = new HomeService(readRepository);

async function main() {
  const context = await service.getHomeContext('me');
  assert.equal(context.currentPicks.length, 2);
  assert.equal(context.currentPicks[1].item, null, 'Missing metadata must not remove the private collection count');
  assert.equal(calls.filter(([kind]) => kind === 'private').length, 1);
  assert.equal(calls.some(([kind]) => kind === 'feed'), false, 'Context never fetches a feed page');

  calls = [];
  await service.getHomeContext('me', 'offline', 'food');
  assert.deepEqual(calls.map(([kind]) => kind), ['private'],
    'MVP context no longer calls the removed editorial Home RPC');

  calls = [];
  const firstPage = await service.getHomePicks();
  assert.equal(firstPage.picks[0].pickId, 'friend-pick');
  assert.equal(firstPage.picks[0].username, 'friend');
  assert.equal(firstPage.picks[0].oneLineReview, '친구의 이유', 'Each card carries that person’s own reason');
  assert.equal(firstPage.nextCursor.id, 'pick-20');
  assert.deepEqual(calls, [['feed', null]], 'A feed page performs exactly one repository read');

  calls = [];
  await service.getHomePicks(feed.nextCursor);
  assert.equal(calls.length, 1, 'Later pages never repeat categories, private Picks or editorial reads');
  assert.equal(calls[0][0], 'feed');
  assert.equal(calls[0][1], feed.nextCursor, 'Later pages pass the cursor through');

  calls = [];
  const publicContext = await service.getHomeContext();
  assert.equal(publicContext.currentPicks.length, 0);
  assert.equal(calls.some(([kind]) => kind === 'private'), false);

  feed.items = []; feed.nextCursor = null;
  const empty = await service.getHomePicks();
  assert.equal(empty.picks.length, 0);
  assert.equal(empty.nextCursor, null);

  const noEditorialRepository = {
    ...readRepository,
    getEditorialHomeItems: async () => { throw new Error('editorial Home RPC should not be called'); },
  };
  const noEditorialService = new HomeService(noEditorialRepository);
  assert.equal((await noEditorialService.getHomeContext('me')).currentPicks.length, 2);
  console.log('Home checks passed: context skips unused editorial reads and stays separate from single-read feed pages.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
