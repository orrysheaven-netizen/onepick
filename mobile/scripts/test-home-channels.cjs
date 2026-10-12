const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name) => { assert.ok(name in imports, `Unexpected import: ${name}`); return imports[name]; } });
  return exports;
}

async function main() {
  const channels = load('lib/home/homeChannels.ts');
  assert.deepEqual(Array.from(channels.HOME_CHANNEL_TABS, (tab) => [tab.channel, tab.label]), [[null, '전체'], ['offline', '매장'], ['online', '온라인'], ['recipe', '레시피']]);
  assert.equal(channels.objectParticle('오프라인 맛집'), '을');
  assert.equal(channels.objectParticle('레시피'), '를');
  assert.equal(channels.homeChannelLabel(['offline']), '오프라인 맛집');
  assert.equal(channels.homeChannelLabel(['online']), '온라인 맛집');
  assert.equal(channels.homeChannelLabel(['online', 'offline']), '오프라인 맛집·온라인 맛집', 'Labels follow tab order, not server order');
  assert.equal(channels.categoryWithChannels('도가니탕', ['offline']), '도가니탕 · 오프라인 맛집');
  assert.equal(channels.categoryWithChannels('도가니탕', ['online']), '도가니탕 · 온라인 맛집');
  assert.equal(channels.categoryWithChannels('라면', []), '라면', 'Items without a channel show only the category');
  assert.equal(channels.categoryWithChannels('라면', undefined), '라면');
  assert.equal(channels.homeChannelLabel([]), null, 'Legacy items without a channel get no label');
  assert.equal(channels.homeChannelLabel(undefined), null, 'Rows without channels (e.g. an older cache) do not crash');
  assert.equal(channels.isPickChannel('offline'), true);
  assert.equal(channels.isPickChannel('delivery'), false, 'Delivery is not its own channel; it counts as 매장');

  const { AppError } = load('errors/appError.ts');
  const { mapSupabaseError } = load('errors/mapSupabaseError.ts', { './appError': { AppError } });
  const imports = { '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError },
    '@/repositories/supabase/itemChannels': { fetchItemChannels: async () => new Map() },
    '@/repositories/supabase/itemProviders': { fetchItemProviderIds: async () => new Map() } };
  for (const name of ['category', 'comment', 'pick', 'item', 'profile']) {
    imports[`@/repositories/mappers/${name}Mapper`] = load(`repositories/mappers/${name}Mapper.ts`);
  }
  imports['@/lib/home/channelFeedMerge'] = load('lib/home/channelFeedMerge.ts');
  const { SupabaseReadRepository } = load('repositories/supabase/supabaseReadRepository.ts', imports);
  const rpcCalls = [];
  const row = (i, rowChannels) => ({
    pick_id: `pick-${i}`, user_id: `user-${i}`, username: `u${i}`, profile_image_url: null,
    item_id: `item-${i}`, item_name: `Item ${i}`, category_id: 'seolleongtang', category_name: '설렁탕',
    one_line_review: 'Good', thumbnail_path: null, image_path: null, image_source_url: null,
    started_at: '2026-09-26T10:00:00.000000+00:00', channels: rowChannels,
  });
  const client = {
    rpc: async (name, args) => {
      if (name === 'item_brands') return { data: [], error: null };
      rpcCalls.push([name, args]);
      return { data: [row(1, ['offline']), row(2, ['offline', 'online', 'unknown']), row(3, null)], error: null };
    },
    storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: p } }) }) },
  };
  const repo = new SupabaseReadRepository(client);

  const all = await repo.getHomePicks();
  assert.equal(rpcCalls[0][0], 'home_pick_feed_page');
  assert.equal('p_channel' in rpcCalls[0][1], false, 'The 전체 tab omits p_channel so older servers keep working');
  assert.deepEqual(all.items.map((pick) => Array.from(pick.channels)), [['offline'], ['offline', 'online'], []],
    'Unknown channel values are dropped and a missing column maps to no channel');

  await repo.getHomePicks({ timestamp: '2026-09-26T10:00:00.000000+00:00', id: 'f9100000-0000-4000-8000-000000000003' }, 'offline');
  assert.equal(rpcCalls[1][1].p_channel, 'offline');
  assert.equal('p_root_slug' in rpcCalls[1][1], false, 'No root means every category');
  assert.equal('p_category_id' in rpcCalls[1][1], false, 'No dish means every category');
  await repo.getHomePicks(null, null, 'food');
  assert.equal(rpcCalls[2][1].p_root_slug, 'food', 'The MVP root is sent to the server');
  rpcCalls.splice(2, 1);
  await repo.getHomePicks(null, 'recipe', null, 'miyeokguk');
  assert.equal(rpcCalls[2][1].p_category_id, 'miyeokguk', 'A dish page sends its category to the server');
  assert.equal(rpcCalls[2][1].p_channel, 'recipe', 'A dish page keeps the channel tabs');
  rpcCalls.splice(2, 1);
  assert.equal(rpcCalls[1][1].p_before_id, 'f9100000-0000-4000-8000-000000000003', 'Channel tabs keep the normal cursor');

  await repo.getFollowingPicks();
  assert.equal(rpcCalls[2][0], 'home_following_feed_page');
  assert.equal('p_channel' in rpcCalls[2][1], false, 'Default following feed keeps every internal channel');
  assert.equal('p_root_slug' in rpcCalls[2][1], false, 'Default following feed keeps every internal root');

  await repo.getFollowingPicks(null, 'offline', 'food');
  assert.equal(rpcCalls[3][0], 'home_following_feed_page');
  assert.equal(rpcCalls[3][1].p_channel, 'offline', 'MVP following feed sends the offline scope');
  assert.equal(rpcCalls[3][1].p_root_slug, 'food', 'MVP following feed sends the food root');

  // Keep public, following and editorial entry points on the same server-side MVP scope.
  await repo.getHomePicks(null, 'offline', 'food');
  assert.equal(rpcCalls.at(-1)[0], 'home_pick_feed_page');
  assert.equal(rpcCalls.at(-1)[1].p_channel, 'offline', 'MVP public feed sends the offline scope');
  assert.equal(rpcCalls.at(-1)[1].p_root_slug, 'food', 'MVP public feed sends the food root');

  await repo.getEditorialHomeItems(6, 'offline', 'food');
  assert.equal(rpcCalls.at(-1)[0], 'home_editorial_items');
  assert.equal(rpcCalls.at(-1)[1].p_channel, 'offline', 'MVP editorial sends the offline scope');
  assert.equal(rpcCalls.at(-1)[1].p_root_slug, 'food', 'MVP editorial sends the food root');

  // Rollout compatibility: if the client reaches production before the widened
  // RPC signatures, hidden channels must not leak through an old unscoped call.
  const oldServer = {
    rpc: async (name) => ({
      data: null,
      error: { code: 'PGRST202', message: `Could not find the function public.${name}` },
    }),
    storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: p } }) }) },
  };
  const compatRepo = new SupabaseReadRepository(oldServer);
  const compatFollowing = await compatRepo.getFollowingPicks(null, 'offline', 'food');
  assert.equal(compatFollowing.items.length, 0, 'Old DB hides following rows instead of falling back to an unscoped feed');
  assert.equal(compatFollowing.nextCursor, null);
  assert.equal((await compatRepo.getEditorialHomeItems(6, 'offline', 'food')).length, 0,
    'Old DB hides editorial rows instead of exposing all-channel counts');

  const followingMigration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260929071000_add_following_feed_mvp_scope.sql'), 'utf8');
  assert.match(followingMigration, /p_channel text default null/);
  assert.match(followingMigration, /p_root_slug text default null/);
  assert.match(followingMigration, /grant execute on function public\.home_following_feed_page\(timestamptz, uuid, text, text\) to authenticated/);

  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260926120000_add_home_feed_channel_filter.sql'), 'utf8');
  assert.match(migration, /p_channel text default null/);
  assert.match(migration, /grant execute on function public\.home_pick_feed_page\(timestamptz, uuid, text\) to anon, authenticated/);

  const dishMigration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260927210000_add_home_feed_category_filter.sql'), 'utf8');
  assert.match(dishMigration, /p_category_id is null or p\.category_id = p_category_id/);
  assert.match(dishMigration, /grant execute on function public\.home_pick_feed_page\(timestamptz, uuid, text, text, uuid\) to anon, authenticated/);

  console.log('Home channel checks passed: future tab helpers remain, while Home/following RPCs support the food+offline MVP scope.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
