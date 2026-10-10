// #874 / #878: the owner's private needs_review Pick must reach the item detail
// with its real status. item_review_page exposes only is_current, so the read
// adapter maps a current needs_review row to 'active'. ItemService restores the
// status from the owner's own RLS read (getCurrentPicksInCategory). This check
// runs the real service with in-memory repositories: owner / other member /
// anonymous viewers, plus the public count channel rule. No network or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, { exports, module: { exports }, require: (name) => {
    if (name in imports) return imports[name];
    throw new Error('Unexpected dependency: ' + name);
  } });
  return exports;
}

class AppError extends Error { constructor(code) { super(code); this.code = code; } }
const { ItemService } = load('services/itemService.ts', { '@/errors/appError': { AppError } });

const item = { id: 'item-1', name: '중앙해장', categoryId: 'menu', status: 'active', channels: ['offline'] };
const categories = [
  { id: 'food', parentId: null, slug: 'food', rootSlug: 'food' },
  { id: 'menu', parentId: 'food', slug: 'menu', rootSlug: 'food' },
];
// What item_review_page + getItemReviews deliver: the owner's needs_review row
// arrives as status 'active' (is_current=true) because the RPC hides lifecycle.
const reviewRows = [
  { pick: { id: 'own-pick', userId: 'owner', itemId: 'item-1', categoryId: 'menu', channel: 'offline', status: 'active', isCurrent: true, isDeleted: false }, profile: null },
  { pick: { id: 'other-pick', userId: 'member-b', itemId: 'item-1', categoryId: 'menu', channel: 'offline', status: 'active', isCurrent: true, isDeleted: false }, profile: null },
];
// The owner's own picks read (RLS: user_id = auth.uid()) carries the real status.
const ownCurrent = { owner: [{ id: 'own-pick', userId: 'owner', itemId: 'item-1', categoryId: 'menu', channel: 'offline', status: 'needs_review', oneLineReview: '' }] };
const countCalls = [];
let reviewViewer;
const service = new ItemService(
  { getById: async () => item },
  { getCurrentPicksInCategory: async (userId) => ownCurrent[userId] ?? [] },
  { getOpenCategories: async () => categories, getById: async () => ({ id: 'menu', name: '내장탕' }) },
  {
    // The RPC never returns another member's needs_review row; it only returns the
    // viewer's own. Simulate that visibility contract per viewer.
    getItemReviews: async () => reviewRows.filter(({ pick }) => pick.userId !== 'owner' || reviewViewer === 'owner'),
    getItemBrand: async () => null,
    getPickById: async () => null,
    countActivePicks: async (...args) => { countCalls.push(args); return 1; },
  },
);
const statusOf = (detail, id) => detail.picks.find(({ pick }) => pick.id === id)?.pick.status;

(async () => {
  // Owner: own row gets the real needs_review status; other rows untouched.
  reviewViewer = 'owner';
  const owner = await service.getItemDetail('item-1', 'owner');
  assert.equal(statusOf(owner, 'own-pick'), 'needs_review', 'Owner sees their real pending status');
  assert.equal(statusOf(owner, 'other-pick'), 'active', 'Other members keep their public status');
  assert.equal(owner.myPickStatus.type, 'selected_this');

  // Another member: never receives the owner's private row, and their view of
  // public rows is unchanged (no status is invented for someone else).
  reviewViewer = 'member-b';
  const other = await service.getItemDetail('item-1', 'member-b');
  assert.equal(statusOf(other, 'own-pick'), undefined, 'A private needs_review row is not exposed to others');
  assert.equal(statusOf(other, 'other-pick'), 'active');

  // Anonymous: no owner read happens and no status is changed.
  reviewViewer = undefined;
  const anon = await service.getItemDetail('item-1');
  assert.equal(statusOf(anon, 'own-pick'), undefined);
  assert.equal(statusOf(anon, 'other-pick'), 'active');

  // A stale owner read must not rewrite a row that is not the viewer's own.
  ownCurrent['member-b'] = [{ id: 'other-pick', userId: 'owner', itemId: 'item-1', categoryId: 'menu', channel: 'offline', status: 'needs_review' }];
  reviewViewer = 'member-b';
  const guarded = await service.getItemDetail('item-1', 'member-b');
  assert.equal(statusOf(guarded, 'other-pick'), 'active', 'Only rows owned by the viewer are corrected');
  delete ownCurrent['member-b'];

  // Public count: without a scope it keeps the old contract; with the detail's
  // scope it forwards the same channel rule as the list.
  await service.getPickCount('item-1');
  await service.getPickCount('item-1', { channel: 'offline', includeUnchanneled: true });
  assert.deepEqual(countCalls[0], ['item-1']);
  assert.deepEqual(countCalls[1], ['item-1', { channel: 'offline', includeUnchanneled: true }]);

  // Source guards: the count stays status=active on the public count client and
  // applies the list's channel rule; the detail passes that rule.
  const repo = fs.readFileSync(path.join(__dirname, '../src/repositories/supabase/supabaseReadRepository.ts'), 'utf8');
  const countBody = repo.slice(repo.indexOf('async countActivePicks('), repo.indexOf('private mapItem('));
  assert.match(countBody, /this\.countClient\.from\('picks'\)/, 'Count uses the public count client');
  assert.match(countBody, /\.eq\('status', 'active'\)/, 'needs_review is never counted publicly');
  assert.match(countBody, /channel\.eq\.\$\{channelScope\.channel\},channel\.is\.null/);
  assert.doesNotMatch(countBody, /'needs_review'/, 'Count never queries needs_review');
  const screen = fs.readFileSync(path.join(__dirname, '../src/app/item/[itemId].tsx'), 'utf8');
  assert.match(screen, /channel: OnePickMvp\.publicPickChannel, includeUnchanneled: itemSupportsPublicChannel/);
  assert.match(screen, /pick\.channel === OnePickMvp\.publicPickChannel\s*\n\s*\|\| \(!pick\.channel && itemSupportsPublicChannel\)/,
    'The list filter the count mirrors is unchanged');
  console.log('Own pending Pick status and public count channel rule passed for owner, other member and anonymous viewers.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
