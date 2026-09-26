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

function setup() {
  const state = {
    rows: [], writes: [], updates: [], upstream: [], cache: new Map(), auth: true, suspended: false,
    searchAllowed: true, searchQuotaCalls: 0, importAllowed: true, importQuotaCalls: 0, apiKey: 'server-key',
    categories: [
      { id: 'recipe', parent_id: 'food', slug: 'recipe', status: 'open', is_visible: true, is_pickable: true },
      { id: 'food', parent_id: null, slug: 'food', status: 'open', is_visible: true, is_pickable: false },
    ],
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
    rpc: async (name) => {
      if (name === 'catalog_user_is_suspended') return { data: state.suspended, error: null };
      if (name === 'reserve_youtube_catalog_search') { state.searchQuotaCalls++; return { data: state.searchAllowed, error: null }; }
      if (name === 'reserve_external_catalog_import') { state.importQuotaCalls++; return { data: state.importAllowed, error: null }; }
      throw new Error('Unexpected RPC: ' + name);
    },
    from(table) {
      assert.ok(['categories', 'items'].includes(table));
      const filters = []; let insert = null, update = null, limit = Infinity;
      const run = async (single) => {
        if (insert) {
          state.writes.push(insert);
          if (state.rows.some((r) => r.external_source === insert.external_source && r.external_id === insert.external_id)) {
            return { data: null, error: { code: '23505' } };
          }
          const saved = { ...insert, id: 'saved-' + state.rows.length };
          state.rows.push(saved);
          return { data: saved, error: null };
        }
        if (update) {
          const matched = state.rows.filter((r) => filters.every((f) => f(r)));
          matched.forEach((row) => Object.assign(row, update));
          state.updates.push(update);
          return { data: single ? (matched[0] ?? null) : matched, error: null };
        }
        const source = table === 'categories' ? state.categories : state.rows;
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

  // Lookup: authenticated, quota-bounded, cached, and never writes.
  const s = setup();
  const lookupRes = await s.request('video_lookup', { url: 'https://youtu.be/' + videoId + '?si=tracking' });
  assert.equal(lookupRes.status, 200);
  const lookup = (await lookupRes.json()).video;
  assert.equal(lookup.externalId, videoId);
  assert.equal(lookup.existingItemId, null);
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

  // Import: one item per video in the recipe category.
  const saved = await (await s.request('video_import', { externalId: videoId })).json();
  assert.equal(saved.created, true);
  assert.equal(saved.categoryId, 'recipe');
  const row = s.state.writes[0];
  assert.equal(row.category_id, 'recipe');
  assert.equal(row.external_source, 'youtube_video');
  assert.equal(row.external_id, videoId);
  assert.equal(row.name, '백종원 김치찌개 레시피');
  assert.equal(row.normalized_name, '백종원김치찌개레시피');
  assert.equal(row.creator_name, '요리 채널');
  assert.equal(row.official_url, 'https://www.youtube.com/watch?v=' + videoId);
  assert.equal(row.image_source_url, 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg');
  assert.equal(row.status, 'active');
  assert.ok(Date.parse(row.external_refreshed_at));
  assert.equal(s.state.importQuotaCalls, 1, 'new items consume the external import quota');

  const upstreamBefore = s.state.upstream.length;
  const again = await (await s.request('video_import', { externalId: videoId })).json();
  assert.equal(again.created, false);
  assert.equal(again.itemId, saved.itemId, 'the same video maps to the same item');
  assert.equal(s.state.upstream.length, upstreamBefore, 'fresh items are reused without calling YouTube');
  assert.equal(s.state.writes.length, 1);

  const known = await (await s.request('video_lookup', { url: 'https://youtu.be/' + videoId })).json();
  assert.equal(known.video.existingItemId, saved.itemId, 'lookup reports an already-registered video');

  s.state.rows[0].external_refreshed_at = new Date(Date.now() - 21 * 24 * 60 * 60_000).toISOString();
  s.state.videoItems = [{ ...s.state.videoItems[0], snippet: { ...s.state.videoItems[0].snippet, title: '갱신된 레시피' } }];
  const refreshed = await (await s.request('video_import', { externalId: videoId })).json();
  assert.equal(refreshed.created, false);
  assert.equal(s.state.rows[0].name, '갱신된 레시피', 'stale metadata is refreshed on import');
  assert.ok(Date.now() - Date.parse(s.state.rows[0].external_refreshed_at) < 60_000);
  assert.equal(s.state.importQuotaCalls, 1, 'refreshing an existing item does not consume the import quota');

  const race = setup();
  race.state.rows.push({ id: 'winner', category_id: 'recipe', external_source: 'youtube_video', external_id: videoId, status: 'active', external_refreshed_at: null });
  const raced = await (await race.request('video_import', { externalId: videoId })).json();
  assert.equal(raced.itemId, 'winner');

  for (const mode of ['no-auth', 'suspended', 'bad-id', 'hidden-category', 'hidden-parent', 'non-leaf', 'other-category', 'pending-item', 'no-key', 'quota']) {
    const t = setup();
    if (mode === 'suspended') t.state.suspended = true;
    if (mode === 'hidden-category') t.state.categories[0].is_visible = false;
    if (mode === 'hidden-parent') t.state.categories[1].is_visible = false;
    if (mode === 'non-leaf') t.state.categories.push({ id: 'child', parent_id: 'recipe' });
    if (mode === 'other-category') t.state.rows.push({ id: 'elsewhere', category_id: 'youtube', external_source: 'youtube_video', external_id: videoId, status: 'active' });
    if (mode === 'pending-item') t.state.rows.push({ id: 'pending', category_id: 'recipe', external_source: 'youtube_video', external_id: videoId, status: 'pending' });
    if (mode === 'no-key') t.state.apiKey = '';
    if (mode === 'quota') t.state.importAllowed = false;
    const res = await t.request('video_import', { externalId: mode === 'bad-id' ? 'bad' : videoId }, mode !== 'no-auth');
    assert.ok(res.status >= 400, mode);
    assert.equal(t.state.writes.length, 0, mode);
    if (!['quota'].includes(mode)) assert.equal(t.state.upstream.length, 0, mode + ' fails before YouTube');
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
  response = { video: { ...mapped, existingItemId: null } };
  assert.equal((await repo.lookupVideo('https://www.youtube.com/watch?v=' + videoId)).externalId, videoId);
  assert.equal(calls[0].body.action, 'video_lookup');
  response = { video: { ...mapped, videoUrl: 'https://evil.example/' } };
  await assert.rejects(() => repo.lookupVideo('https://youtu.be/' + videoId), (error) => error.code === 'INTERNAL_ERROR', 'mismatched video URLs are rejected');
  response = { video: { ...mapped, thumbnailUrl: 'http://insecure' } };
  await assert.rejects(() => repo.lookupVideo('https://youtu.be/' + videoId), (error) => error.code === 'INTERNAL_ERROR');
  response = { itemId: 'c3333333-3333-4333-8333-333333333333', categoryId: 'd4444444-4444-4444-8444-444444444444', created: true };
  assert.equal((await repo.importVideo(videoId)).created, true);
  assert.equal(calls.at(-1).body.action, 'video_import');
  assert.equal(calls.at(-1).body.externalId, videoId);
  assert.equal(calls.at(-1).headers.Authorization, 'Bearer user-jwt');
  failure = { context: new Response(JSON.stringify({ error: 'VIDEO_URL_INVALID' }), { status: 400 }) };
  await assert.rejects(() => repo.lookupVideo('https://youtu.be/' + videoId), (error) => error.code === 'VIDEO_URL_INVALID');
  failure = { context: new Response(JSON.stringify({ error: 'VIDEO_NOT_FOUND' }), { status: 404 }) };
  await assert.rejects(() => repo.lookupVideo('https://youtu.be/' + videoId), (error) => error.code === 'ITEM_NOT_FOUND');

  const { YouTubeCatalogService } = load('mobile/src/services/youtubeCatalogService.ts', {
    '@/errors/appError': { AppError }, '@/lib/youtube/videoLink': videoLink,
  });
  const serviceCalls = [];
  const service = new YouTubeCatalogService({ lookupVideo: async (...args) => { serviceCalls.push(args); return mapped; } });
  await service.lookupVideo('  https://youtu.be/' + videoId + '  ');
  assert.equal(serviceCalls[0][0], 'https://youtu.be/' + videoId);
  await assert.rejects(() => service.lookupVideo('https://www.youtube.com/@channel'), (error) => error.code === 'VIDEO_URL_INVALID');
  assert.equal(serviceCalls.length, 1, 'invalid links never reach the Edge Function');

  const intents = load('mobile/src/lib/auth/authIntent.ts');
  const categoryId = 'd4444444-4444-4444-8444-444444444444';
  const intent = intents.getAuthIntent({ action: 'choose_recipe', externalVideoId: videoId, categoryId });
  assert.equal(intent.action, 'choose_recipe');
  const route = intents.getPostAuthRoute(intent);
  assert.equal(route.pathname, '/pick/recipe');
  assert.equal(route.params.externalVideoId, videoId);
  assert.equal(intents.getAuthIntent({ action: 'choose_recipe', externalVideoId: 'https://evil', categoryId }).action, 'home');

  const { registrationRoute } = load('mobile/src/lib/categories/registrationRoute.ts');
  assert.equal(registrationRoute({ id: categoryId, slug: 'recipe' }).pathname, '/pick/recipe');

  const screen = fs.readFileSync(path.join(root, 'mobile/src/app/pick/recipe.tsx'), 'utf8');
  assert.match(screen, /getYouTubePolicyConsent/);
  assert.match(screen, /acceptYouTubePolicyConsent/);
  assert.match(screen, /YouTube 이용약관/);
  assert.match(screen, /Google 개인정보처리방침/);
  assert.match(screen, /YouTube는 OnePick을 후원하거나 승인하지 않습니다/);
  assert.doesNotMatch(screen, /viewCount|likeCount|statistics/);
  const find = fs.readFileSync(path.join(root, 'mobile/src/app/pick/find.tsx'), 'utf8');
  assert.match(find, /selectedCategory\?\.slug === 'recipe'/, 'name search redirects recipe to the link flow');
  assert.match(find, /YouTube 링크로 레시피 등록/);

  console.log('Recipe YouTube video passed: strict video-link parsing, quota-bounded lookup, one item per video, refresh/reuse, category and auth guards, client validation and login return.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
