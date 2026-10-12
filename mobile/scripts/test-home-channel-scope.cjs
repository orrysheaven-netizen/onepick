// #762: Home reads 오프라인 식당 + 온라인 음식 (recipe excluded) by merging one keyset page per
// channel. Proves no missing/duplicate rows across pages, tie ordering, and the scoped helpers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const src = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(src(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name) => { assert.ok(name in imports, `Unexpected import: ${name}`); return imports[name]; } });
  return exports;
}

const merge = load('lib/home/channelFeedMerge.ts');
const { HomeService } = load('services/homeService.ts', { '@/lib/home/channelFeedMerge': merge });
const earlyHome = load('lib/home/earlyHome.ts');
const { AppError } = load('errors/appError.ts');
const { mapSupabaseError } = load('errors/mapSupabaseError.ts', { './appError': { AppError } });

// A fake server with the RPC contract: (started_at, id) desc, cursor strictly before, 21 rows
// (20 + lookahead), p_channel matches the Pick's channel or (legacy NULL) its item's channels.
function server(picks) {
  const sorted = [...picks].sort(merge.compareFeedOrder);
  const calls = { feed: [], brands: 0, providers: 0 };
  const client = {
    rpc: async (name, args) => {
      if (name === 'item_brands') { calls.brands += 1; return { data: [], error: null }; }
      assert.ok(name === 'home_pick_feed_page' || name === 'home_following_feed_page', name);
      const channel = args.p_channel ?? null;
      calls.feed.push(channel);
      const data = sorted.filter((pick) => {
        if (channel !== null && !(pick.channel === channel || (pick.channel === null && (pick.itemChannels ?? []).includes(channel)))) return false;
        if (args.p_before_time === undefined) return true;
        return merge.compareFeedOrder(pick, { startedAt: args.p_before_time, pickId: args.p_before_id }) > 0;
      }).slice(0, 21).map((pick) => ({
        pick_id: pick.pickId, user_id: 'u', username: 'u', profile_image_url: null, item_id: `item-${pick.pickId}`,
        item_name: 'x', category_id: 'c', category_name: 'c', one_line_review: null, thumbnail_path: null,
        image_path: null, image_source_url: null, started_at: pick.startedAt, channels: pick.channel ? [pick.channel] : [],
      }));
      return { data, error: null };
    },
    storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: p } }) }) },
  };
  const imports = { '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError },
    '@/lib/home/channelFeedMerge': merge,
    '@/repositories/supabase/itemChannels': { fetchItemChannels: async () => new Map() },
    '@/repositories/supabase/itemProviders': { fetchItemProviderIds: async () => { calls.providers += 1; return new Map(); } } };
  for (const name of ['category', 'comment', 'pick', 'item', 'profile']) {
    imports[`@/repositories/mappers/${name}Mapper`] = load(`repositories/mappers/${name}Mapper.ts`);
  }
  const { SupabaseReadRepository } = load('repositories/supabase/supabaseReadRepository.ts', imports);
  return { repo: new SupabaseReadRepository(client), calls };
}

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (minute, micros = '') => `2026-10-10T12:${String(minute).padStart(2, '0')}:00${micros}+00:00`;

async function readAll(scope, fake, method = 'getHomePicks') {
  const seen = [];
  let cursor = null;
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await fake.repo[method](cursor, scope, 'food');
    assert.ok(page.items.length <= 20, 'never more than one page of rows');
    seen.push(...page.items.map((item) => item.pickId));
    if (!page.nextCursor) return seen;
    assert.ok(page.items.length > 0, 'a page with a next cursor always makes progress');
    cursor = page.nextCursor;
  }
  throw new Error('pagination did not finish');
}

async function main() {
  // 1. Offline-heavy then online-heavy timelines, 45 offline + 25 online + 10 recipe, plus
  //    same-started_at groups straddling page boundaries and a microsecond-only difference.
  const picks = [];
  let n = 1;
  for (let i = 0; i < 45; i += 1) picks.push({ pickId: id(n++), startedAt: at(59 - Math.floor(i / 3)), channel: 'offline' });
  for (let i = 0; i < 25; i += 1) picks.push({ pickId: id(n++), startedAt: at(59 - Math.floor(i / 2)), channel: 'online' });
  for (let i = 0; i < 10; i += 1) picks.push({ pickId: id(n++), startedAt: at(50 - i), channel: 'recipe' });
  picks.push({ pickId: id(n++), startedAt: at(30, '.000001'), channel: 'online' });
  picks.push({ pickId: id(n++), startedAt: at(30, '.000002'), channel: 'offline' });
  // Legacy NULL-channel Pick whose item is both offline and online: matched by both reads.
  picks.push({ pickId: id(n++), startedAt: at(40), channel: null, itemChannels: ['offline', 'online'] });
  // Legacy NULL Pick on a recipe-only item: never in scope.
  picks.push({ pickId: id(n++), startedAt: at(41), channel: null, itemChannels: ['recipe'] });

  const fake = server(picks);
  const seen = await readAll(['offline', 'online'], fake);
  const expected = [...picks]
    .filter((pick) => pick.channel === 'offline' || pick.channel === 'online' || (pick.channel === null && pick.itemChannels.some((c) => c !== 'recipe')))
    .sort(merge.compareFeedOrder).map((pick) => pick.pickId);
  assert.equal(new Set(seen).size, seen.length, 'no Pick appears twice across pages');
  assert.deepEqual(seen, expected, 'every offline/online Pick once, in server order, none missing');
  assert.ok(!fake.calls.feed.includes('recipe') && !fake.calls.feed.includes(null), 'only offline and online are requested; never recipe or every-channel');
  const pagesRead = fake.calls.feed.length / 2;
  assert.equal(fake.calls.brands, pagesRead, 'brand logos are read once per merged page, not per channel');
  assert.equal(fake.calls.providers, pagesRead, 'providers are read once per merged page, not per channel');
  const following = server(picks);
  assert.deepEqual(await readAll(['offline', 'online'], following, 'getFollowingPicks'), expected, 'the following feed merges the same way');

  // 2. Microsecond ordering beats millisecond rounding.
  assert.ok(merge.compareFeedOrder({ startedAt: at(1, '.000002'), pickId: id(1) }, { startedAt: at(1, '.000001'), pickId: id(9) }) < 0);
  assert.ok(merge.compareFeedOrder({ startedAt: at(1, '.5'), pickId: id(1) }, { startedAt: at(1, '.499999'), pickId: id(9) }) < 0, 'fraction length is normalized');
  assert.ok(merge.compareFeedOrder({ startedAt: at(1), pickId: id(9) }, { startedAt: at(1), pickId: id(1) }) < 0, 'ties order by id desc');

  // 3. Boundary rule: a channel with more rows caps the page at its last fetched row.
  const offline = Array.from({ length: 20 }, (_, i) => ({ pickId: id(100 + i), startedAt: at(59 - i) }));
  const online = [{ pickId: id(200), startedAt: at(58, '.5') }, { pickId: id(201), startedAt: at(5) }];
  // With equal page sizes the first 20 merged rows are always safe; the guard matters when the
  // merged limit exceeds a channel's page (limit 25 here), so it is checked explicitly.
  const page = merge.mergeChannelPages([{ items: offline, nextCursor: { timestamp: offline[19].startedAt, id: offline[19].pickId } }, { items: online, nextCursor: null }], 25);
  assert.equal(page.items.length, 21, 'stops at the offline boundary (20 offline + the newer online row)');
  assert.ok(!page.items.some((item) => item.pickId === id(201)), 'the old online row waits until offline rows before it are read');
  assert.equal(JSON.stringify(page.nextCursor), JSON.stringify({ timestamp: page.items[20].startedAt, id: page.items[20].pickId }));
  const done = merge.mergeChannelPages([{ items: online, nextCursor: null }, { items: [], nextCursor: null }]);
  assert.equal(done.nextCursor, null, 'no cursor when every channel is exhausted');
  assert.equal(JSON.stringify(merge.mergeChannelPages([{ items: [], nextCursor: null }, { items: [], nextCursor: null }])), JSON.stringify({ items: [], nextCursor: null }));

  // 4. Single/null scopes stay one server call (unchanged behaviour elsewhere).
  const single = server(picks);
  await single.repo.getHomePicks(null, 'offline');
  await single.repo.getHomePicks(null, null);
  assert.deepEqual(single.calls.feed, ['offline', null]);
  assert.equal(merge.channelScopeKey(['online', 'offline']), merge.channelScopeKey(['offline', 'online']));
  assert.equal(merge.channelScopeKey('offline'), 'offline');

  // 5. HomeService passes the scope through and sums menu counts per channel.
  const countCalls = [];
  const scopes = [];
  const service = new HomeService({
    getHomePicks: async (cursor, channel) => { scopes.push(channel); return { items: [], nextCursor: null }; },
    getFoodMenuPickCounts: async (channel) => {
      countCalls.push(channel);
      return new Map(channel === 'offline' ? [['m1', 3], ['m2', 1]] : [['m1', 2], ['m3', 4]]);
    },
  });
  await service.getHomePicks(null, ['offline', 'online'], 'food');
  assert.equal(JSON.stringify(scopes), JSON.stringify([['offline', 'online']]));
  const counts = await service.getFoodMenuPickCounts(['offline', 'online']);
  assert.deepEqual(countCalls, ['offline', 'online']);
  assert.equal(JSON.stringify(Object.fromEntries(counts)), JSON.stringify({ m1: 5, m2: 1, m3: 4 }));

  // 6. Viewer-scoped helpers: online in, recipe out, legacy NULL kept as before.
  const mine = (pickId, channel, status = 'active') => ({ pick: { id: pickId, userId: 'u', categoryId: 'm1', channel, status, startedAt: at(1) }, profile: { id: 'u', username: 'u' } });
  const menus = new Set(['m1']);
  const scoped = earlyHome.myScopedPicks([mine('a', 'offline'), mine('b', 'online'), mine('c', 'recipe'), mine('d', null)], menus, ['offline', 'online']);
  assert.deepEqual(Array.from(scoped, (row) => row.pick.id), ['a', 'b', 'd']);
  assert.deepEqual(Array.from(earlyHome.myScopedPicks([mine('a', 'offline'), mine('b', 'online')], menus, 'offline'), (row) => row.pick.id), ['a'], 'single channel unchanged');
  const people = earlyHome.homeParticipants([mine('a', 'online'), mine('c', 'recipe')], menus, ['offline', 'online']);
  assert.equal(people.length, 1);
  assert.equal(people[0].pickCount, 1, 'the recipe Pick is not counted');

  // 7. Wiring: Home/feed use the two-channel scope; ranking stays single-channel offline.
  const constants = src('constants/onepick.ts');
  assert.match(constants, /homeFeedChannels: \['offline', 'online'\] as const/);
  assert.match(constants, /publicPickChannel: 'offline' as const/, 'the global gate is unchanged');
  const home = src('app/(tabs)/index.tsx');
  assert.match(home, /const mvpChannel = OnePickMvp\.homeFeedChannels;/);
  assert.match(home, /useFollowingFeed\(user\?\.id, showFollowing, mvpChannel, HOME_FEED_ROOT_SLUG\)/);
  assert.match(home, /useHomeFoodMenuPickCounts\(mvpChannel, homeEnabled\)/);
  assert.match(home, /useHomeItemRanking\(\s*rankingChannel,/);
  assert.match(src('app/feed.tsx'), /useFullPickFeed\([^)]*OnePickMvp\.homeFeedChannels, HOME_FEED_ROOT_SLUG\)/);

  console.log('Home channel scope checks passed (offline+online merge, recipe excluded, cursor/tie safety).');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
