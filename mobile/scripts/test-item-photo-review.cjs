const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name) => {
    assert.ok(name in imports, `Unexpected dependency ${name}`);
    return imports[name];
  } });
  return exports;
}

// L4: a member's first photo for a published product waits for admin review.
async function main() {
  const { AppError } = load('errors/appError.ts');
  const { ProfileService } = load('services/profileService.ts', { '@/errors/appError': { AppError } });

  const bare = { id: 'bare', status: 'active', imagePath: null, imageUrl: null, thumbnailUrl: null, imageSourceUrl: null };
  const shown = { id: 'shown', status: 'active', imagePath: 'x/full.jpg', imageUrl: 'https://cdn/x/full.jpg', thumbnailUrl: 'https://cdn/x/thumb.jpg', imageSourceUrl: null };
  const sourced = { id: 'sourced', status: 'active', imagePath: null, imageUrl: null, thumbnailUrl: null, imageSourceUrl: 'https://catalog.example/poster.jpg' };
  const rows = [
    { pick: { id: 'p1', status: 'needs_review' }, item: bare },
    { pick: { id: 'p2', status: 'active' }, item: shown },
    { pick: { id: 'p3', status: 'active' }, item: sourced },
  ];
  const profileRepository = { getById: async (id) => (id === 'me' ? { id: 'me' } : null) };
  const readRepository = { getPicks: async () => rows };
  const asked = [];
  const itemRepository = {
    getMyPendingPhotos: async (userId, itemIds) => {
      asked.push([userId, [...itemIds]]);
      return new Map([['bare', { itemId: 'bare', imageUrl: 'https://cdn/me/full.jpg', thumbnailUrl: 'https://cdn/me/thumb.jpg' }]]);
    },
  };

  const profile = await new ProfileService(profileRepository, readRepository, itemRepository).getMyProfile('me');
  assert.deepEqual(asked, [['me', ['bare']]], 'Only photo-less items of my own Picks are looked up, for me');
  const waiting = profile.currentPicks.find((row) => row.item.id === 'bare').item;
  assert.equal(waiting.thumbnailUrl, 'https://cdn/me/thumb.jpg', 'My own profile shows my pending photo');
  assert.equal(waiting.photoPendingReview, true, 'The pending photo is marked as waiting for review');
  assert.equal(waiting.imagePath, null, 'The item itself still has no published photo');
  const published = profile.currentPicks.find((row) => row.item.id === 'shown').item;
  assert.equal(published.photoPendingReview, undefined, 'Published photos are untouched');
  assert.ok(profile.currentPicks.some((row) => row.item.id === 'sourced'), 'A catalog source URL counts as a visible photo');

  const failing = { getMyPendingPhotos: async () => { throw new Error('offline'); } };
  const fallback = await new ProfileService(profileRepository, readRepository, failing).getMyProfile('me');
  assert.deepEqual(Array.from(fallback.currentPicks, (row) => row.item.id), ['bare', 'shown', 'sourced'],
    'My profile keeps the photo-less current Pick reachable for management when candidate lookup fails');
  const legacy = await new ProfileService(profileRepository, readRepository).getMyProfile('me');
  assert.deepEqual(Array.from(legacy.currentPicks, (row) => row.item.id), ['bare', 'shown', 'sourced'],
    'My profile keeps legacy photo-less current Picks reachable even without a pending-photo repository');

  // Repository: own pending rows only, scoped to the asked items.
  const filters = [];
  const query = {
    select(columns) { filters.push(['select', columns]); return this; },
    eq(column, value) { filters.push(['eq', column, value]); return this; },
    in(column, values) { filters.push(['in', column, values]); return this; },
    then(resolve) { resolve({ data: [{ item_id: 'bare', image_path: 'me/full.jpg', thumbnail_path: 'me/thumb.jpg' }], error: null }); },
  };
  const client = {
    from(table) { filters.push(['from', table]); return query; },
    storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: `https://cdn/${p}` } }) }) },
  };
  const { SupabaseItemRepository } = load('repositories/supabase/supabaseItemRepository.ts', {
    '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
    '@/errors/appError': { AppError },
    '@/repositories/mappers/itemMapper': { mapItemRow: (row) => row },
    '@/repositories/supabase/itemChannels': { fetchItemChannels: async () => new Map() },
    '@/repositories/supabase/itemProviders': { fetchItemProviderIds: async () => new Map() },
  });
  const photos = await new SupabaseItemRepository(client).getMyPendingPhotos('me', ['bare']);
  assert.deepEqual(filters, [
    ['from', 'item_photo_candidates'],
    ['select', 'item_id,image_path,thumbnail_path'],
    ['eq', 'user_id', 'me'],
    ['eq', 'status', 'pending'],
    ['in', 'item_id', ['bare']],
  ], 'Candidate reads are mine and pending only');
  assert.equal(photos.get('bare').thumbnailUrl, 'https://cdn/me/thumb.jpg');
  assert.equal((await new SupabaseItemRepository(client).getMyPendingPhotos('me', [])).size, 0, 'No request for an empty item list');

  // Admin: the photo review queue is a work-queue tab.
  const tabs = load('lib/admin/dataTabs.ts');
  assert.ok(tabs.isAdminDataTab('photos'), 'Photo review is an admin data tab');
  const queue = tabs.ADMIN_NAV_SECTIONS.find((section) => section.title === '처리 대기');
  assert.ok(queue.items.some((item) => item.tab === 'photos'), 'Photo review sits with the other review queues');

  console.log('Item photo review checks passed: owner management keeps legacy Picks while public exposure can filter photo-less items.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
