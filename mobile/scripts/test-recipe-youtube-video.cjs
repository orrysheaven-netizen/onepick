const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const root = path.join(__dirname, '../..');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, URL, Request, Response, AbortController, console, Deno: undefined,
    crypto: webcrypto, TextEncoder, Uint8Array, Promise,
    require: (name) => { if (name in imports) return imports[name]; throw new Error(name); },
  });
  return exports;
}

const server = load('supabase/functions/youtube-catalog/youtubeCatalog.ts', { '@supabase/supabase-js': {} });
const client = load('mobile/src/lib/youtube/videoLink.ts');

const videoId = 'QzTOFNbgU-s';
const accepted = [
  'https://www.youtube.com/watch?v=' + videoId,
  'https://youtube.com/watch?v=' + videoId + '&t=42s&si=share',
  'https://m.youtube.com/watch?v=' + videoId + '&list=PL123',
  'https://youtu.be/' + videoId,
  'https://youtu.be/' + videoId + '?si=abc&t=10',
  'https://www.youtube.com/shorts/' + videoId,
  'https://www.youtube.com/shorts/' + videoId + '?feature=share',
  'https://www.youtube.com/live/' + videoId,
  'https://www.youtube.com/embed/' + videoId,
  'http://www.youtube.com/watch?v=' + videoId,
  'youtu.be/' + videoId,
  '  https://youtu.be/' + videoId + '  ',
  'HTTPS://WWW.YOUTUBE.COM/watch?v=' + videoId,
];
const rejected = [
  '',
  videoId,
  'https://www.youtube.com/channel/UC1234567890123456789012',
  'https://www.youtube.com/@GoogleDevelopers',
  'https://www.youtube.com/playlist?list=PL1234567890',
  'https://www.youtube.com/watch?list=PL1234567890',
  'https://www.youtube.com/watch?v=short',
  'https://www.youtube.com/watch?v=' + videoId + 'x',
  'https://youtu.be/' + videoId + '/extra',
  'https://www.youtube.com/shorts/' + videoId + '/extra',
  'https://evil.example/watch?v=' + videoId,
  'https://youtube.com.evil.example/watch?v=' + videoId,
  'https://music.youtube.com/watch?v=' + videoId,
  'https://user:pass@www.youtube.com/watch?v=' + videoId,
  'https://www.youtube.com:8443/watch?v=' + videoId,
  'javascript:alert(1)//youtu.be/' + videoId,
  'ftp://youtu.be/' + videoId,
  'https://youtu.be/' + videoId + ' trailing words',
  'https://youtu.be/' + 'a'.repeat(2048),
];

const DISH = 'a1111111-1111-4111-8111-111111111111';
const OTHER_DISH = 'b2222222-2222-4222-8222-222222222222';

function setup() {
  const state = {
    rows: [], writes: [], updates: [], upstream: [], cache: new Map(), auth: true, suspended: false,
    searchAllowed: true, searchQuotaCalls: 0, importAllowed: true, importQuotaCalls: 0, apiKey: 'server-key',
    accepts: new Set([DISH, OTHER_DISH]), channels: [], intents: [], picks: [],
    suggestionRows: [{ category_id: DISH, name: '김치찌개', path: '먹을것 > 국/탕/찌개/밥 > 김치찌개', matched_term: '김치찌개' }],
    categories: [{ id: 'pending-product-id', slug: 'pending-product' }],
    videoItems: [{
      id: videoId,
      snippet: {
        title: '  백종원 김치찌개   레시피 ',
        channelTitle: '요리 채널',
        thumbnails: { high: { url: 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg' }, default: { url: 'http://insecure' } },
      },
    }],
  };
  const db = {
    auth: { getUser: async () => ({ data: { user: state.auth ? { id: 'user', is_anonymous: false } : null }, error: null }) },
    rpc: async (name, args) => {
      if (name === 'catalog_user_is_suspended') return { data: state.suspended, error: null };
      if (name === 'reserve_youtube_catalog_search') { state.searchQuotaCalls++; return { data: state.searchAllowed, error: null }; }
      if (name === 'reserve_external_catalog_import') { state.importQuotaCalls++; return { data: state.importAllowed, error: null }; }
      if (name === 'category_accepts_recipe') return { data: state.accepts.has(args.p_category_id), error: null };
      if (name === 'recipe_dish_suggestions') { state.suggestedFor = args.p_title; return { data: state.suggestionRows, error: null }; }
      throw new Error('Unexpected RPC: ' + name);
    },
    from(table) {
      assert.ok(['categories', 'items', 'item_channels', 'picks', 'pending_item_picks'].includes(table), table);
      const filters = []; let insert = null, update = null, limit = Infinity;
      const run = async (single) => {
        if (insert) {
          state.writes.push(insert);
          if (state.rows.some((r) => r.external_source === insert.external_source && r.external_id === insert.external_id)) {
            return { data: null, error: { code: '23505' } };
          }
          const saved = { ...insert, id: 'c' + String(state.rows.length).padStart(7, '0') + '-3333-4333-8333-333333333333' };
          state.rows.push(saved);
          return { data: saved, error: null };
        }
        if (update) {
          const matched = state.rows.filter((r) => filters.every((f) => f(r)));
          matched.forEach((row) => Object.assign(row, update));
          state.updates.push(update);
          return { data: single ? (matched[0] ?? null) : matched, error: null };
        }
        const source = table === 'categories' ? state.categories : table === 'picks' ? state.picks : state.rows;
        const rows = source.filter((r) => filters.every((f) => f(r))).slice(0, limit);
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      };
      const q = {
        select: () => q,
        eq: (k, v) => { filters.push((r) => r[k] === v); return q; },
        in: (k, vs) => { filters.push((r) => vs.includes(r[k])); return q; },
        limit: (n) => { limit = n; return q; },
        insert: (row) => { assert.equal(table, 'items'); insert = row; return q; },
        update: (row) => { assert.equal(table, 'items'); update = row; return q; },
        upsert: async (row, options) => {
          if (table === 'item_channels') { assert.equal(options.onConflict, 'item_id,channel'); state.channels.push(row); }
          else if (table === 'pending_item_picks') { assert.equal(options.onConflict, 'item_id'); state.intents.push(row); }
          else assert.fail('upsert on ' + table);
          return { data: null, error: null };
        },
        maybeSingle: () => run(true),
        then: (resolve, reject) => run(false).then(resolve, reject),
      };
      return q;
    },
  };
  const handler = server.createYouTubeCatalogHandler({
    client: () => db,
    apiKey: () => state.apiKey || null,
    json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    readCache: async (_client, key) => state.cache.get(key) ?? null,
    writeCache: async (_client, key, payload) => { state.cache.set(key, payload); },
    fetchYouTube: async (url) => {
      state.upstream.push(url);
      assert.ok(url.pathname.endsWith('/videos'), 'recipe flow only calls videos.list');
      return { data: { items: state.videoItems } };
    },
  });
  const request = (action, extra = {}, auth = true) => handler(
    { action, ...extra },
    new Request('https://edge.test', { headers: auth ? { Authorization: 'Bearer token', 'cf-connecting-ip': '203.0.113.10' } : {} }),
  );
  return { state, request };
}

async function main() {
  for (const link of accepted) {
    assert.equal(server.parseYouTubeVideoUrl(link), videoId, 'server accepts ' + link);
    assert.equal(client.parseYouTubeVideoUrl(link), videoId, 'client accepts ' + link);
  }
  for (const link of rejected) {
    assert.equal(server.parseYouTubeVideoUrl(link), null, 'server rejects ' + link.slice(0, 80));
    assert.equal(client.parseYouTubeVideoUrl(link), null, 'client rejects ' + link.slice(0, 80));
  }
  assert.equal(client.youtubeVideoUrl(videoId), server.videoUrl(videoId));

  const mapped = server.mapYouTubeVideo(setup().state.videoItems[0]);
  assert.equal(mapped.source, 'youtube_video');
  assert.equal(mapped.title, '백종원 김치찌개 레시피', 'titles are trimmed and whitespace-collapsed');
  assert.equal(mapped.channelTitle, '요리 채널');
  assert.equal(mapped.thumbnailUrl, 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg');
  assert.equal(mapped.videoUrl, 'https://www.youtube.com/watch?v=' + videoId);
  assert.equal(server.mapYouTubeVideo({ id: 'bad', snippet: { title: 'x' } }), null);
  assert.equal(server.mapYouTubeVideo({ id: videoId, snippet: { title: '   ' } }), null);

  // Lookup: authenticated, quota-bounded, cached, suggests dishes from the title, never writes.
  const s = setup();
  const lookupRes = await s.request('video_lookup', { url: 'https://youtu.be/' + videoId + '?si=tracking' });
  assert.equal(lookupRes.status, 200);
  const lookupBody = await lookupRes.json();
  const lookup = lookupBody.video;
  assert.equal(lookup.externalId, videoId);
  assert.equal(lookup.existingItemId, null);
  assert.equal(lookup.existingCategoryId, null);
  assert.deepEqual(lookupBody.suggestions, [{ categoryId: DISH, name: '김치찌개', path: '먹을것 > 국/탕/찌개/밥 > 김치찌개' }]);
  assert.equal(s.state.suggestedFor, '백종원 김치찌개 레시피', 'dishes are suggested from the video title');
  assert.equal(s.state.searchQuotaCalls, 1, 'lookup consumes the YouTube search quota');
  assert.equal(s.state.writes.length, 0, 'lookup never creates items');
  const upstream = s.state.upstream[0];
  assert.equal(upstream.pathname, '/youtube/v3/videos');
  assert.equal(upstream.searchParams.get('id'), videoId);
  assert.equal(upstream.searchParams.get('part'), 'snippet');
  assert.match(upstream.searchParams.get('fields'), /^items\(id,snippet\(title,channelTitle,thumbnails\)\)$/);
  assert.equal(upstream.searchParams.has('statistics'), false);
  await s.request('video_lookup', { url: 'https://www.youtube.com/watch?v=' + videoId });
  assert.equal(s.state.upstream.length, 1, 'different links to one video share the 10-minute cache');
  assert.equal(s.state.searchQuotaCalls, 2, 'cache hits still count against the caller quota');

  for (const [mode, extra, auth, status] of [
    ['anonymous', { url: 'https://youtu.be/' + videoId }, false, 401],
    ['channel link', { url: 'https://www.youtube.com/channel/UC1234567890123456789012' }, true, 400],
    ['playlist link', { url: 'https://www.youtube.com/playlist?list=PL1' }, true, 400],
    ['other domain', { url: 'https://example.com/watch?v=' + videoId }, true, 400],
    ['missing url', {}, true, 400],
  ]) {
    const t = setup();
    const res = await t.request('video_lookup', extra, auth);
    assert.equal(res.status, status, mode);
    assert.equal(t.state.upstream.length, 0, mode + ' never reaches YouTube');
    assert.equal(t.state.searchQuotaCalls, 0, mode + ' never consumes quota');
  }
  assert.equal((await (await setup().request('video_lookup', { url: 'https://youtu.be/x' })).json()).error, 'VIDEO_URL_INVALID');

  const limited = setup();
  limited.state.searchAllowed = false;
  assert.equal((await limited.request('video_lookup', { url: 'https://youtu.be/' + videoId })).status, 429);
  assert.equal(limited.state.upstream.length, 0);

  const missing = setup();
  missing.state.videoItems = [];
  const missingRes = await missing.request('video_lookup', { url: 'https://youtu.be/' + videoId });
  assert.equal(missingRes.status, 404, 'private/deleted videos are not found');
  assert.equal((await missingRes.json()).error, 'VIDEO_NOT_FOUND');

  // Import: one item per video, under the confirmed dish, with a recipe channel.
  // #426 M10: a new video is a request that waits for administrator review.
  const saved = await (await s.request('video_import', { externalId: videoId, categoryId: DISH })).json();
  assert.equal(saved.created, true);
  assert.equal(saved.categoryId, DISH);
  assert.equal(saved.pending, true, 'a new video is reported as a pending request');
  const row = s.state.writes[0];
  assert.equal(row.category_id, DISH);
  assert.equal(row.external_source, 'youtube_video');
  assert.equal(row.external_id, videoId);
  assert.equal(row.name, '백종원 김치찌개 레시피');
  assert.equal(row.normalized_name, '백종원김치찌개레시피');
  assert.equal(row.creator_name, '요리 채널');
  assert.equal(row.official_url, 'https://www.youtube.com/watch?v=' + videoId);
  assert.equal(row.image_source_url, 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg');
  assert.equal(row.status, 'pending', 'a new video is not public before review');
  assert.equal(row.created_by, 'user', 'the requester is recorded for review and approval');
  assert.ok(Date.parse(row.external_refreshed_at));
  assert.equal(s.state.importQuotaCalls, 1, 'new items consume the external import quota');
  assert.deepEqual(JSON.parse(JSON.stringify(s.state.channels[0])),
    { item_id: saved.itemId, channel: 'recipe', target_url: 'https://www.youtube.com/watch?v=' + videoId, is_primary: true },
    'the recipe channel links the video');

  const upstreamBefore = s.state.upstream.length;
  const retried = await (await s.request('video_import', { externalId: videoId, categoryId: OTHER_DISH })).json();
  assert.deepEqual([retried.itemId, retried.categoryId, retried.created, retried.pending], [saved.itemId, DISH, false, true],
    'the requester gets the same pending request back, under its dish');
  assert.equal(s.state.upstream.length, upstreamBefore, 'a retried request does not call YouTube');
  assert.equal(s.state.writes.length, 1);

  const pendingLookup = await (await s.request('video_lookup', { url: 'https://www.youtube.com/watch?v=' + videoId + '&t=1' })).json();
  assert.equal(pendingLookup.video.existingItemId, saved.itemId, 'lookup hands the requester their own pending request');
  s.state.cache.clear();
  s.state.videoItems = [{ ...s.state.videoItems[0], snippet: { ...s.state.videoItems[0].snippet, title: '제목 바뀐 영상' } }];
  await s.request('video_lookup', { url: 'https://youtu.be/' + videoId });
  assert.equal(s.state.rows[0].status, 'pending', 'a lookup refresh never publishes a pending video');
  assert.equal(s.state.updates.length, 0, 'a pending video is not rewritten by lookups');

  for (const action of ['video_lookup', 'video_import', 'video_request']) {
    const other = setup();
    other.state.rows.push({ id: 'theirs', category_id: DISH, external_source: 'youtube_video', external_id: videoId, status: 'pending', created_by: 'someone-else' });
    const extra = action === 'video_lookup' ? { url: 'https://youtu.be/' + videoId }
      : action === 'video_import' ? { externalId: videoId, categoryId: DISH } : { externalId: videoId, dishName: '파김치' };
    const res = await other.request(action, extra);
    assert.equal(res.status, 409, action + ': a pending video requested by someone else is not taken over');
    assert.equal((await res.json()).error, 'ITEM_ALREADY_PENDING', action);
    assert.equal(other.state.writes.length + other.state.updates.length, 0, action + ' never writes');
    assert.equal(other.state.upstream.length, 0, action + ' does not call YouTube');
  }

  // After approval the video is public and behaves like any registered recipe.
  s.state.rows[0].status = 'active';
  s.state.cache.clear();
  const again = await (await s.request('video_import', { externalId: videoId, categoryId: OTHER_DISH })).json();
  assert.equal(again.created, false);
  assert.equal(again.itemId, saved.itemId, 'the same video maps to the same item');
  assert.equal(again.categoryId, DISH, 'a registered video keeps its dish');
  assert.equal(again.pending, undefined, 'an approved video is not pending');
  assert.equal(s.state.writes.length, 1);

  const known = await (await s.request('video_lookup', { url: 'https://youtu.be/' + videoId })).json();
  assert.equal(known.video.existingItemId, saved.itemId, 'lookup reports an already-registered video');
  assert.equal(known.video.existingCategoryId, DISH, 'with its dish');
  assert.deepEqual(known.suggestions, [], 'a registered video needs no dish suggestions');

  s.state.rows[0].external_refreshed_at = new Date(Date.now() - 21 * 24 * 60 * 60_000).toISOString();
  s.state.videoItems = [{ ...s.state.videoItems[0], snippet: { ...s.state.videoItems[0].snippet, title: '갱신된 레시피' } }];
  const refreshed = await (await s.request('video_import', { externalId: videoId, categoryId: DISH })).json();
  assert.equal(refreshed.created, false);
  assert.equal(s.state.rows[0].name, '갱신된 레시피', 'stale metadata is refreshed on import');
  assert.ok(Date.now() - Date.parse(s.state.rows[0].external_refreshed_at) < 60_000);
  assert.equal(s.state.importQuotaCalls, 1, 'refreshing an existing item does not consume the import quota');

  const race = setup();
  race.state.rows.push({ id: 'winner', category_id: DISH, external_source: 'youtube_video', external_id: videoId, status: 'active', external_refreshed_at: null });
  const raced = await (await race.request('video_import', { externalId: videoId, categoryId: DISH })).json();
  assert.equal(raced.itemId, 'winner');

  // A video left in the retired 레시피 category moves to the confirmed dish while unpicked.
  const legacy = setup();
  legacy.state.rows.push({ id: 'legacy', category_id: 'recipe', external_source: 'youtube_video', external_id: videoId, status: 'active', external_refreshed_at: new Date().toISOString() });
  const legacyLookup = await (await legacy.request('video_lookup', { url: 'https://youtu.be/' + videoId })).json();
  assert.equal(legacyLookup.video.existingItemId, null, 'a legacy video still asks for its dish');
  const moved = await (await legacy.request('video_import', { externalId: videoId, categoryId: DISH })).json();
  assert.equal(moved.itemId, 'legacy');
  assert.equal(moved.categoryId, DISH);
  assert.equal(legacy.state.rows[0].category_id, DISH, 'the legacy item moves to the dish');
  assert.equal(legacy.state.importQuotaCalls, 0, 'moving is not a new import');
  const pickedLegacy = setup();
  pickedLegacy.state.rows.push({ id: 'legacy', category_id: 'recipe', external_source: 'youtube_video', external_id: videoId, status: 'active' });
  pickedLegacy.state.picks.push({ id: 'pick', item_id: 'legacy' });
  assert.equal((await pickedLegacy.request('video_import', { externalId: videoId, categoryId: DISH })).status, 409,
    'a picked legacy video cannot move (its Picks stay with it)');

  // A rejected video (a turned-down request or a removed old recipe) starts over.
  const turnedDown = setup();
  turnedDown.state.rows.push({ id: 'old', category_id: 'recipe', external_source: 'youtube_video', external_id: videoId, status: 'rejected' });
  const rejectedLookup = await (await turnedDown.request('video_lookup', { url: 'https://youtu.be/' + videoId })).json();
  assert.equal(rejectedLookup.video.existingItemId, null, 'a rejected video looks unregistered');
  assert.equal(rejectedLookup.suggestions.length, 1, 'and asks for its dish');
  assert.equal(turnedDown.state.updates.length, 0, 'lookup never writes');
  const reborn = await (await turnedDown.request('video_import', { externalId: videoId, categoryId: DISH })).json();
  assert.equal(reborn.created, true, 'registering creates a new item');
  assert.equal(reborn.pending, true, 'and the new item waits for review again');
  assert.notEqual(reborn.itemId, 'old');
  assert.equal(reborn.categoryId, DISH);
  const old = turnedDown.state.rows.find((r) => r.id === 'old');
  assert.equal(old.status, 'rejected', 'the rejected row stays rejected');
  assert.equal(old.external_id, null, 'and gives up the video identity');
  assert.equal(old.external_source, null);

  for (const mode of ['no-auth', 'suspended', 'bad-id', 'missing-dish', 'not-a-dish', 'pending-item', 'no-key', 'quota', 'rate-limited']) {
    const t = setup();
    if (mode === 'suspended') t.state.suspended = true;
    if (mode === 'pending-item') t.state.rows.push({ id: 'pending', category_id: DISH, external_source: 'youtube_video', external_id: videoId, status: 'pending' });
    if (mode === 'no-key') t.state.apiKey = '';
    if (mode === 'quota') t.state.importAllowed = false;
    if (mode === 'rate-limited') t.state.searchAllowed = false;
    const categoryId = mode === 'missing-dish' ? undefined : mode === 'not-a-dish' ? 'c9999999-9999-4999-8999-999999999999' : DISH;
    const res = await t.request('video_import', { externalId: mode === 'bad-id' ? 'bad' : videoId, ...(categoryId ? { categoryId } : {}) }, mode !== 'no-auth');
    assert.ok(res.status >= 400, mode);
    if (mode === 'quota' || mode === 'rate-limited') assert.equal(res.status, 429, mode + ' is reported as RATE_LIMITED');
    assert.equal(t.state.writes.length, 0, mode);
    assert.equal(t.state.upstream.length, 0, mode + ' fails before YouTube');
  }

  // #426 H1: repeated registrations of unknown video IDs stop at the caller's
  // limits before any YouTube call, so they cannot drain the shared API key.
  for (const action of ['video_import', 'video_request']) {
    const flood = setup();
    let allowed = 2;
    flood.state.videoItems = [];
    const extra = action === 'video_import' ? { categoryId: DISH } : { dishName: '파김치' };
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      flood.state.importAllowed = allowed-- > 0;
      const unknownId = 'unknownVid' + i;
      statuses.push((await flood.request(action, { externalId: unknownId, ...extra })).status);
    }
    assert.deepEqual(statuses, [404, 404, 429, 429, 429], action + ': unknown IDs are not found until the import quota runs out');
    assert.equal(flood.state.upstream.length, 2, action + ': YouTube is called only while the caller still has quota');
    assert.equal(flood.state.importQuotaCalls, 5, action + ': every new video reserves the import quota before the call');
    assert.ok(flood.state.searchQuotaCalls >= 5, action + ': every call that could reach YouTube is rate limited first');
    const blocked = setup();
    blocked.state.searchAllowed = false;
    assert.equal((await blocked.request(action, { externalId: videoId, ...extra })).status, 429, action + ' honours the rate limit');
    assert.equal(blocked.state.upstream.length, 0, action + ': a rate-limited caller never reaches YouTube');
  }

  // A dish missing from the catalog: the video waits for item review with its
  // dish name only. Approval never receives a Pick intent.
  const req = setup();
  const pending = await (await req.request('video_request', { externalId: videoId, dishName: '  파김치 ' })).json();
  assert.equal(pending.pending, true);
  assert.equal(pending.categoryId, null);
  const pendingRow = req.state.writes[0];
  assert.equal(pendingRow.status, 'pending');
  assert.equal(pendingRow.category_id, 'pending-product-id');
  assert.equal(pendingRow.created_by, 'user');
  assert.equal(pendingRow.requested_category_label, '파김치');
  assert.equal(pendingRow.external_id, videoId);
  assert.equal(req.state.channels[0].channel, 'recipe');
  assert.equal(req.state.intents.length, 0, 'recipe requests never create pending Pick intents');
  assert.equal(req.state.importQuotaCalls, 1, 'requests share the import quota');
  for (const [mode, extra] of [['empty dish', { dishName: ' ' }], ['long dish', { dishName: '가'.repeat(61) }]]) {
    const t = setup();
    const res = await t.request('video_request', { externalId: videoId, ...extra });
    assert.equal(res.status, 400, mode);
    assert.equal(t.state.upstream.length, 0, mode + ' fails before YouTube');
  }

  // Mobile repository, service, auth return and registration route.
  const { AppError } = load('mobile/src/errors/appError.ts');
  const videoLink = client;
  const { SupabaseYouTubeCatalogRepository } = load('mobile/src/repositories/supabase/supabaseYouTubeCatalogRepository.ts', {
    '@/errors/appError': { AppError }, '@/lib/youtube/videoLink': videoLink,
  });
  const calls = []; let response = null; let failure = null;
  const repo = new SupabaseYouTubeCatalogRepository({
    auth: { getSession: async () => ({ data: { session: { access_token: 'user-jwt' } }, error: null }) },
    functions: { invoke: async (name, options) => { assert.equal(name, 'youtube-catalog'); calls.push(options); return { data: response, error: failure }; } },
  });
  response = { video: { ...mapped, existingItemId: null, existingCategoryId: null }, suggestions: [{ categoryId: DISH, name: '김치찌개', path: null }, { categoryId: 'bad', name: 'x', path: null }] };
  const looked = await repo.lookupVideo('https://www.youtube.com/watch?v=' + videoId);
  assert.equal(looked.video.externalId, videoId);
  assert.deepEqual(Array.from(looked.suggestions, (entry) => entry.categoryId), [DISH], 'malformed suggestions are dropped');
  assert.equal(calls[0].body.action, 'video_lookup');
  response = { video: { ...mapped, videoUrl: 'https://evil.example/' } };
  await assert.rejects(() => repo.lookupVideo('https://youtu.be/' + videoId), (error) => error.code === 'INTERNAL_ERROR', 'mismatched video URLs are rejected');
  response = { video: { ...mapped, thumbnailUrl: 'http://insecure' } };
  await assert.rejects(() => repo.lookupVideo('https://youtu.be/' + videoId), (error) => error.code === 'INTERNAL_ERROR');
  response = { itemId: 'c3333333-3333-4333-8333-333333333333', categoryId: DISH, created: true };
  assert.equal((await repo.importVideo(videoId, DISH)).created, true);
  assert.equal(calls.at(-1).body.action, 'video_import');
  assert.equal(calls.at(-1).body.externalId, videoId);
  assert.equal(calls.at(-1).body.categoryId, DISH);
  assert.equal(calls.at(-1).headers.Authorization, 'Bearer user-jwt');
  response = { itemId: 'c3333333-3333-4333-8333-333333333333', categoryId: null, created: true, pending: true };
  assert.equal((await repo.requestVideo(videoId, '파김치')).itemId, 'c3333333-3333-4333-8333-333333333333');
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).body)), { action: 'video_request', externalId: videoId, dishName: '파김치' });
  failure = { context: new Response(JSON.stringify({ error: 'VIDEO_URL_INVALID' }), { status: 400 }) };
  await assert.rejects(() => repo.lookupVideo('https://youtu.be/' + videoId), (error) => error.code === 'VIDEO_URL_INVALID');
  failure = { context: new Response(JSON.stringify({ error: 'VIDEO_NOT_FOUND' }), { status: 404 }) };
  await assert.rejects(() => repo.lookupVideo('https://youtu.be/' + videoId), (error) => error.code === 'ITEM_NOT_FOUND');
  failure = { context: new Response(JSON.stringify({ error: 'CATEGORY_NOT_PICKABLE' }), { status: 409 }) };
  await assert.rejects(() => repo.importVideo(videoId, DISH), (error) => error.code === 'CATEGORY_NOT_PICKABLE');
  failure = { context: new Response(JSON.stringify({ error: 'ITEM_ALREADY_PENDING' }), { status: 409 }) };
  await assert.rejects(() => repo.importVideo(videoId, DISH), (error) => error.code === 'ITEM_ALREADY_PENDING',
    'someone else’s pending video reaches the screen as ITEM_ALREADY_PENDING');

  const { YouTubeCatalogService } = load('mobile/src/services/youtubeCatalogService.ts', {
    '@/errors/appError': { AppError }, '@/lib/youtube/videoLink': videoLink,
  });
  const serviceCalls = [];
  const service = new YouTubeCatalogService({
    lookupVideo: async (...args) => { serviceCalls.push(args); return { video: mapped, suggestions: [] }; },
    requestVideo: async (...args) => { serviceCalls.push(args); return { itemId: 'x' }; },
  });
  await service.lookupVideo('  https://youtu.be/' + videoId + '  ');
  assert.equal(serviceCalls[0][0], 'https://youtu.be/' + videoId);
  await assert.rejects(() => service.lookupVideo('https://www.youtube.com/@channel'), (error) => error.code === 'VIDEO_URL_INVALID');
  assert.equal(serviceCalls.length, 1, 'invalid links never reach the Edge Function');
  await service.requestVideo(videoId, '  파   김치 ');
  assert.deepEqual(serviceCalls.at(-1), [videoId, '파 김치']);
  await assert.rejects(() => service.requestVideo(videoId, ' '), (error) => error.code === 'CATEGORY_LABEL_INVALID');

  const intents = load('mobile/src/lib/auth/authIntent.ts');
  const intent = intents.getAuthIntent({ action: 'choose_recipe', externalVideoId: videoId, categoryId: DISH });
  assert.equal(intent.action, 'choose_recipe');
  const route = intents.getPostAuthRoute(intent);
  assert.equal(route.pathname, '/pick/recipe');
  assert.equal(route.params.externalVideoId, videoId);
  assert.equal(route.params.categoryId, DISH);
  const noDish = intents.getAuthIntent({ action: 'choose_recipe', externalVideoId: videoId });
  assert.equal(noDish.action, 'choose_recipe', 'a recipe link returns after login before a dish is chosen');
  assert.equal('categoryId' in intents.getPostAuthRoute(noDish).params, false);
  assert.equal(intents.getAuthIntent({ action: 'choose_recipe', externalVideoId: 'https://evil', categoryId: DISH }).action, 'home');

  const { registrationRoute } = load('mobile/src/lib/categories/registrationRoute.ts');
  assert.equal(registrationRoute({ id: DISH, slug: 'recipe' }).pathname, '/pick/recipe');

  const screen = fs.readFileSync(path.join(root, 'mobile/src/app/pick/recipe.tsx'), 'utf8');
  assert.match(screen, /!OnePickFeatures\.foodChannelPicker/);
  assert.match(screen, /pathname: '\/pick\/find'/, 'initial MVP redirects a direct recipe route back to store registration');
  assert.match(screen, /getYouTubePolicyConsent/);
  assert.match(screen, /acceptYouTubePolicyConsent/);
  assert.match(screen, /YouTube 이용약관/);
  assert.match(screen, /Google 개인정보처리방침/);
  assert.match(screen, /YouTube는 OnePick을 후원하거나 승인하지 않아요/);
  assert.doesNotMatch(screen, /viewCount|likeCount|statistics/);
  assert.match(screen, /channel: 'recipe'/, 'the recipe is picked under the recipe channel');
  assert.match(screen, /어떤 요리의 레시피인가요\?/);
  assert.match(screen, /찾는 요리가 목록에 없어요/);
  assert.match(screen, /importVideo\.mutateAsync\(\{ externalId: entry\.externalId, categoryId: selectedDish\.id \}\)/, 'import sends the confirmed dish');
  const find = fs.readFileSync(path.join(root, 'mobile/src/app/pick/find.tsx'), 'utf8');
  assert.match(find, /selectedCategory\?\.slug === 'recipe'/, 'old recipe links still redirect to the link flow');
  assert.match(find, /YouTube 링크로 레시피 등록/);

  console.log('Recipe YouTube video passed: strict video-link parsing, quota-bounded lookup with dish suggestions, one item per video under a confirmed dish with a recipe channel, legacy moves, pending dish requests, client validation and login return.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
