const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '../..');
function load(file, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, Request, Response, AbortController, console, ...globals,
    require: (name) => { if (name in imports) return imports[name]; throw new Error(name); } });
  return exports;
}
const mapping = load('supabase/functions/movie-catalog/movieCatalog.ts');
const { mapTmdbDrama, createDramaHandler } = load('supabase/functions/movie-catalog/dramaCatalog.ts', { './movieCatalog.ts': mapping });
const raw = { id: 101, name: '테스트 드라마', original_name: 'Test Series', first_air_date: '2020-01-02',
  genre_ids: [18], poster_path: '/fixture.jpg', adult: false };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function setup() {
  const state = { rows: [], writes: [], calls: [], upstream: [], cache: new Map(), auth: true, suspended: false, race: false,
    categories: [ { id: 'drama', parent_id: 'content', slug: 'drama', status: 'open', is_visible: true, is_pickable: true },
      { id: 'content', parent_id: null, slug: 'content', status: 'open', is_visible: true, is_pickable: false } ],
    remote: raw, results: [raw], remoteError: null };
  const client = {
    auth: { getUser: async () => { state.calls.push('auth'); return { data: { user: state.auth ? { id: 'user' } : null }, error: null }; } },
    rpc: async (name) => { assert.equal(name, 'catalog_user_is_suspended'); return { data: state.suspended, error: null }; },
    from(table) {
      assert.ok(['categories','items'].includes(table), 'No Pick, profile or unrelated write');
      const filters = []; let insert = null, limit = Infinity;
      const run = async (single) => {
        if (insert) {
          state.writes.push(insert);
          if (state.race) { state.race = false; state.rows.push({ ...insert, id: 'winner' }); return { data: null, error: { code: '23505' } }; }
          if (state.rows.some((r) => r.external_source === insert.external_source && r.external_id === insert.external_id)) return { data: null, error: { code: '23505' } };
          const saved = { ...insert, id: 'saved-'+state.rows.length }; state.rows.push(saved); return { data: saved, error: null };
        }
        const rows = (table === 'categories' ? state.categories : state.rows).filter((r) => filters.every((f) => f(r))).slice(0, limit);
        return { data: single ? rows[0] ?? null : rows, error: null };
      };
      const q = { select: () => q, eq: (k,v) => { filters.push((r) => r[k] === v); return q; },
        in: (k,vs) => { filters.push((r) => vs.includes(r[k])); return q; }, limit: (n) => { limit = n; return q; },
        insert: (row) => { assert.equal(table, 'items'); insert = row; return q; },
        maybeSingle: () => run(true), then: (resolve,reject) => run(false).then(resolve,reject) };
      return q;
    },
  };
  const handle = createDramaHandler({
    client: () => client,
    json,
    readCache: async (_client, key) => state.cache.get(key) ?? null,
    writeCache: async (_client, key, payload) => { state.cache.set(key, payload); },
    fetchTmdb: async (url) => {
      state.upstream.push(url);
      return state.remoteError ? { error: state.remoteError } : { data: url.pathname.endsWith('/search/tv') ? { results: state.results } : state.remote };
    },
  });
  const request = (action, extra = {}, auth = true) => handle({ action, mediaType: 'tv', query: '테스트', externalId: '101', ...extra },
    new Request('https://edge.test', { headers: auth ? { Authorization: 'Bearer test-session' } : {} }));
  return { state, request };
}
async function main() {
  const mapped = mapTmdbDrama(raw);
  assert.equal(mapped.source, 'tmdb_tv'); assert.equal(mapped.releaseYear, 2020);
  assert.equal(mapped.title, raw.name); assert.match(mapped.posterUrl, /image.tmdb.org\/t\/p\/w342\/fixture.jpg$/);
  assert.equal(mapTmdbDrama({ ...raw, name: '', original_name: 'Fallback' }).title, 'Fallback');
  assert.equal(mapTmdbDrama({ ...raw, poster_path: 'https://bad.test/a.jpg' }).posterUrl, null);
  assert.equal(mapTmdbDrama({ ...raw, first_air_date: '' }).releaseYear, null);
  assert.ok(mapTmdbDrama({ ...raw, genre_ids: [35] }), 'Scripted comedy series belongs with drama');
  assert.ok(mapTmdbDrama({ ...raw, genre_ids: undefined, genres: [{ id: 18 }], type: 'Miniseries' }));
  for (const value of [null, [], {}, { ...raw, adult: true }, { ...raw, genre_ids: [] }, { ...raw, genre_ids: [18,16] },
    { ...raw, genre_ids: [18,99] }, { ...raw, genre_ids: [10764] }, { ...raw, type: 'Reality' }, { ...raw, id: -1 }, { ...raw, name: '', original_name: '' }]) assert.equal(mapTmdbDrama(value), null);
  assert.equal(mapping.mapTmdbMovie({ id: 101, title: '영화' }).source, 'tmdb', 'Existing movie namespace unchanged');
  const s = setup();
  s.state.rows.push({ id: 'movie-same-number', category_id: 'movie', external_source: 'tmdb', external_id: '101', status: 'active' });
  s.state.results = [raw, raw, null, { ...raw, id: 102, genre_ids: [16] }];
  const search = await (await s.request('search', {}, false)).json();
  assert.equal(search.movies.length, 1); assert.equal(search.movies[0].existingItemId, null);
  assert.equal(s.state.writes.length, 0, 'Searching does not accumulate unselected works');
  assert.equal(s.state.upstream[0].pathname, '/3/search/tv');
  assert.equal(s.state.upstream[0].searchParams.get('language'), 'ko-KR');
  assert.equal(s.state.upstream[0].searchParams.get('include_adult'), 'false');
  assert.equal(s.state.cache.size, 1, 'First drama search caches the upstream result');
  const saved = await (await s.request('import')).json();
  assert.equal(saved.categoryId, 'drama'); assert.equal(saved.created, true);
  assert.equal(s.state.writes[0].external_source, 'tmdb_tv'); assert.equal(s.state.writes[0].official_url, 'https://www.themoviedb.org/tv/101');
  assert.equal(s.state.writes[0].release_year, 2020); assert.equal(s.state.writes[0].name, raw.name);
  const upstream = s.state.upstream.length;
  const again = await (await s.request('import')).json();
  assert.equal(again.itemId, saved.itemId); assert.equal(again.created, false); assert.equal(s.state.upstream.length, upstream);
  assert.equal(s.state.writes.length, 1, 'Repeated selection reuses adopted catalog row');
  const known = await (await s.request('search', {}, false)).json(); assert.equal(known.movies[0].existingItemId, saved.itemId);
  assert.equal(s.state.upstream.length, upstream, 'Repeated drama search reuses the cached TMDB response');
  const hidden = s.state.rows.find((r) => r.external_source === 'tmdb_tv'); hidden.status = 'hidden';
  assert.equal((await s.request('import')).status, 409); assert.equal(hidden.status, 'hidden');
  const race = setup(); race.state.race = true;
  const winner = await (await race.request('import')).json(); assert.equal(winner.itemId, 'winner'); assert.equal(winner.created, false);
  for (const mode of ['no-auth','expired','suspended','hidden-category','hidden-parent','non-leaf','bad-id','bad-query']) {
    const t = setup();
    if (mode === 'expired') t.state.auth = false;
    if (mode === 'suspended') t.state.suspended = true;
    if (mode === 'hidden-category') t.state.categories[0].is_visible = false;
    if (mode === 'hidden-parent') t.state.categories[1].is_visible = false;
    if (mode === 'non-leaf') t.state.categories.push({ id:'child', parent_id:'drama' });
    const res = await t.request(mode === 'bad-query' ? 'search' : 'import', mode === 'bad-id' ? { externalId:'../101' } : mode === 'bad-query' ? { query:'a' } : {}, mode !== 'no-auth');
    assert.ok(res.status >= 400, mode); assert.equal(t.state.upstream.length, 0, mode); assert.equal(t.state.writes.length, 0, mode);
  }
  const wrong = setup(); wrong.state.remote = { ...raw, genre_ids: [16] };
  assert.equal((await wrong.request('import')).status, 404); assert.equal(wrong.state.writes.length, 0);
  wrong.state.remote = { ...raw, id: 999 }; assert.equal((await wrong.request('import')).status, 404);
  const unavailable = setup(); unavailable.state.remoteError = json({ error:'RATE_LIMITED' }, 429);
  assert.equal((await unavailable.request('search')).status, 429);
  const { AppError } = load('mobile/src/errors/appError.ts');
  const { SupabaseMovieCatalogRepository } = load('mobile/src/repositories/supabase/supabaseMovieCatalogRepository.ts', { '@/errors/appError': { AppError } });
  const calls = []; let failure = null;
  const repo = new SupabaseMovieCatalogRepository({ functions: { invoke: async (name, options) => {
    calls.push(options); assert.equal(name,'movie-catalog');
    return { data: options.body.action === 'search' ? { movies:[mapped,{ ...mapped, source:'tmdb' }] } :
      { itemId:'c3333333-3333-4333-8333-333333333333',categoryId:'d4444444-4444-4444-8444-444444444444',created:false }, error:failure };
  } } });
  const signal = new AbortController().signal;
  assert.equal((await repo.search('테스트',signal,'tv'))[0].source,'tmdb_tv'); assert.equal(calls[0].signal,signal);
  assert.equal(calls[0].body.mediaType,'tv'); assert.equal((await repo.search('테스트'))[0].source,'tmdb'); assert.equal(calls[1].body.mediaType,undefined);
  await repo.importMovie('101','tv'); assert.equal(calls.at(-1).body.mediaType,'tv');
  failure = { context: new Response(JSON.stringify({ error:'DRAMA_NOT_FOUND' }),{ status:404 }) };
  await assert.rejects(() => repo.importMovie('101','tv'), (error) => error.code === 'ITEM_NOT_FOUND');
  const { queryKeys } = load('mobile/src/lib/query/queryKeys.ts'); const passed = [];
  const hooks = load('mobile/src/hooks/useMovieCatalog.ts', {
    react: { useState: () => ['테스트',()=>{}], useEffect() {} },
    '@tanstack/react-query': { useQuery: (options) => options, useMutation: (options) => options, useQueryClient: () => ({ getQueryState: () => undefined }) },
    '@/lib/query/queryKeys': { queryKeys }, '@/services': { movieCatalogService: { search: (...args) => passed.push(args), importMovie: (...args) => passed.push(args) } },
  });
  const movieOptions = hooks.useMovieCatalogSearch('테스트',true);
  const tvOptions = hooks.useMovieCatalogSearch('테스트',true,'tv');
  assert.notDeepEqual(tvOptions.queryKey,movieOptions.queryKey); tvOptions.queryFn({ signal });
  assert.equal(passed[0][2],'tv'); assert.equal(passed[0][1],signal);
  hooks.useImportMovieCatalogItem('tv').mutationFn('101'); assert.equal(passed[1][1],'tv');
  const intents = load('mobile/src/lib/auth/authIntent.ts');
  const intent = intents.getAuthIntent({ action:'choose_drama',externalId:'101',categoryId:'d4444444-4444-4444-8444-444444444444' });
  assert.equal(intents.getPostAuthRoute(intent).params.externalDramaId,'101'); assert.equal(intents.getPostAuthRoute(intent).params.externalMovieId,undefined);
  assert.equal(intents.getAuthIntent({ action:'choose_drama',externalId:['101'],categoryId:intent.categoryId }).action,'home');
  console.log('Drama catalog passed: scripted series mapping, namespace isolation, on-demand import, idempotency/race, category/auth protection, media cache and login return.');
}
main().catch((error) => { console.error(error); process.exitCode=1; });
