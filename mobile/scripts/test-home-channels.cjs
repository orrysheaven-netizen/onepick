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
  assert.deepEqual(Array.from(channels.HOME_CHANNEL_TABS, (tab) => [tab.channel, tab.label]), [[null, '전체'], ['offline', '매장'], ['online', '온라인']]);
  assert.equal(channels.homeChannelLabel(['offline']), '매장');
  assert.equal(channels.homeChannelLabel(['online']), '온라인');
  assert.equal(channels.homeChannelLabel(['online', 'offline']), '매장·온라인', 'Labels follow tab order, not server order');
  assert.equal(channels.homeChannelLabel([]), null, 'Legacy items without a channel get no label');
  assert.equal(channels.isPickChannel('offline'), true);
  assert.equal(channels.isPickChannel('delivery'), false, 'Delivery is not its own channel; it counts as 매장');

  const { AppError } = load('errors/appError.ts');
  const { mapSupabaseError } = load('errors/mapSupabaseError.ts', { './appError': { AppError } });
  const imports = { '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError } };
  for (const name of ['category', 'comment', 'pick', 'item', 'profile']) {
    imports[`@/repositories/mappers/${name}Mapper`] = load(`repositories/mappers/${name}Mapper.ts`);
  }
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
  await repo.getHomePicks(null, null, 'food');
  assert.equal(rpcCalls[2][1].p_root_slug, 'food', 'The MVP root is sent to the server');
  rpcCalls.splice(2, 1);
  assert.equal(rpcCalls[1][1].p_before_id, 'f9100000-0000-4000-8000-000000000003', 'Channel tabs keep the normal cursor');

  await repo.getFollowingPicks();
  assert.equal(rpcCalls[2][0], 'home_following_feed_page');
  assert.equal('p_channel' in rpcCalls[2][1], false, 'The following feed has no channel filter');

  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260926120000_add_home_feed_channel_filter.sql'), 'utf8');
  assert.match(migration, /p_channel text default null/);
  assert.match(migration, /grant execute on function public\.home_pick_feed_page\(timestamptz, uuid, text\) to anon, authenticated/);

  console.log('Home channel checks passed: tab order, card labels, delivery-as-store rule, p_channel request shape and row mapping.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
