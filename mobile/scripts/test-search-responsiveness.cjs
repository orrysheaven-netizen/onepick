const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient, QueryObserver } = require('@tanstack/react-query');
const { createClient } = require('@supabase/supabase-js');

function load(file, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Response, URL, ...globals, require: (name) => {
    if (name in imports) return imports[name];
    assert.fail(`Unexpected dependency: ${name}`);
  } });
  return exports;
}
const { queryKeys } = load('lib/query/queryKeys.ts');
const { AppError } = load('errors/appError.ts');
const { mapItemRow } = load('repositories/mappers/itemMapper.ts');
const { SupabaseItemRepository } = load('repositories/supabase/supabaseItemRepository.ts', {
  '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
  '@/repositories/mappers/itemMapper': { mapItemRow },
  '@/repositories/supabase/itemChannels': { fetchItemChannels: async () => new Map() },
  '@/repositories/supabase/itemProviders': { fetchItemProviderIds: async () => new Map() },
});
const { ItemService } = load('services/itemService.ts', { '@/errors/appError': { AppError } });
const { MovieCatalogService } = load('services/movieCatalogService.ts');
const { SupabaseMovieCatalogRepository } = load('repositories/supabase/supabaseMovieCatalogRepository.ts', { '@/errors/appError': { AppError } });

function hook(file, name, cache, services) {
  let settled = '', callback, delay, cleanup;
  const api = load(file, {
    react: { useState: () => [settled, (value) => { settled = value; }],
      useEffect: (effect) => { cleanup?.(); cleanup = effect(); } },
    '@tanstack/react-query': { useQuery: (options) => options, useQueryClient: () => cache, useMutation: (options) => options },
    '@/lib/query/queryKeys': { queryKeys }, '@/services': services,
    '@/services/itemServiceInstance': { itemService: services.itemService },
  }, {
    setTimeout: (fn, ms) => { callback = fn; delay = ms; return 1; },
    clearTimeout: () => { callback = undefined; },
  });
  return {
    read: (...args) => api[name](...args),
    fire: () => { assert.ok(callback); callback(); },
    delay: () => delay,
    reset: () => { settled = ''; },
    stop: () => { cleanup?.(); assert.equal(callback, undefined); },
  };
}
const cat = 'a1111111-1111-4111-8111-111111111111';
const nextCat = 'b2222222-2222-4222-8222-222222222222';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await pause(5); }
  assert.fail('Async test operation did not settle');
}

async function main() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const calls = [];
  const services = {
    itemService: { search: async (...args) => { calls.push(['item', ...args]); return []; } },
    movieCatalogService: { search: async (...args) => { calls.push(['movie', ...args]); return []; }, importMovie: () => assert.fail('Searching must not import or save a Pick') },
  };
  const local = hook('hooks/useItemSearch.ts', 'useItemSearch', cache, services);
  const movie = hook('hooks/useMovieCatalog.ts', 'useMovieCatalogSearch', cache, services);
  for (const [h, scope, wait] of [[local, cat, 150], [movie, true, 200]]) {
    h.reset(); let options = h.read('인터', scope);
    assert.equal(options.enabled, false); assert.equal(options.isWaiting, true); assert.equal(h.delay(), wait);
    h.read('인터스텔라', scope); h.fire(); options = h.read('인터스텔라', scope);
    assert.equal(options.enabled, true); assert.equal(options.isWaiting, false);
    const ac = new AbortController(); await options.queryFn({ signal: ac.signal });
    assert.equal(calls.at(-1).at(-1), ac.signal, 'Cancellation reaches the service unchanged');
    assert.equal(calls.at(-1)[1], '인터스텔라', 'Only latest normalized input starts a query');
    assert.equal(options.staleTime, 30000, 'Keep the existing short cache-freshness window');
    h.reset(); cache.setQueryData(options.queryKey, []);
    let cachedOptions = h.read('  인터스텔라  ', scope);
    assert.equal(cachedOptions.isWaiting, false, 'Exact recent results, including empty results, bypass the delay');
    assert.equal(cachedOptions.enabled, true);
    assert.equal(JSON.stringify(cachedOptions.queryKey), JSON.stringify(options.queryKey));
    const before = calls.length;
    await cache.fetchQuery(cachedOptions);
    assert.equal(calls.length, before, 'A fresh cached result requires zero duplicate service calls');
    await cache.invalidateQueries({ queryKey: options.queryKey });
    assert.equal(h.read('인터스텔라', scope).isWaiting, true, 'Mutation invalidation forbids instant reuse');
    cache.setQueryData(options.queryKey, [], { updatedAt: Date.now() - 31000 });
    assert.equal(h.read('인터스텔라', scope).isWaiting, true, 'Expired data cannot bypass debounce');
    cache.setQueryData(options.queryKey, []);
    cache.getQueryCache().find({ queryKey: options.queryKey }).setState({ status: 'error', error: new Error('offline') });
    assert.equal(h.read('인터스텔라', scope).isWaiting, true, 'Failure must not be hidden by an old successful body');
    cache.removeQueries({ queryKey: options.queryKey });
    cache.setQueryData(options.queryKey, []);
    assert.equal(h.read('다른 검색어', scope).isWaiting, true, 'Never show another search term as the current result');
    h.stop(); cache.clear();
  }
  local.reset(); let key = local.read('라면', cat).queryKey; cache.setQueryData(key, [{ id: 'ramen' }]);
  assert.equal(local.read('라면', cat).isWaiting, false);
  assert.equal(local.read('라면', nextCat).isWaiting, true, 'Same text in another category has separate results');
  assert.equal(local.read('라면').isWaiting, true, 'Global search is not category-restricted cached data');
  assert.equal(local.read(' ').enabled, false); assert.equal(local.read(' ').hasSearchText, false);
  for (const input of ['', 'a', 'a'.repeat(61)]) assert.equal(movie.read(input, true).enabled, false);
  assert.equal(movie.read('인터스텔라', false).enabled, false, 'Category/session gates still disable external search');
  cache.clear(); local.reset(); assert.equal(local.read('라면', cat).isWaiting, true, 'Clearing app cache clears reuse as well');
  local.stop(); movie.stop();

  let requests = 0, input;
  const searchSource = { search: async (value) => { requests++; input = value; return [{ id: 'result' }]; } };
  const categories = { getOpenCategories: () => assert.fail('Redundant serial category lookup'), getById: () => assert.fail('Redundant category lookup') };
  const itemService = new ItemService(searchSource, {}, categories, {});
  assert.equal((await itemService.search(' ')).length, 0); assert.equal(requests, 0);
  const ac = new AbortController();
  assert.equal((await itemService.search(' 라면 ', cat, ac.signal))[0].id, 'result');
  assert.equal(requests, 1); assert.equal(input.query, '라면'); assert.equal(input.categoryId, cat);
  assert.equal(input.limit, 20); assert.equal(input.signal, ac.signal);
  await itemService.search('영화'); assert.equal(requests, 2); assert.equal(input.categoryId, undefined);
  let forwarded;
  const movieService = new MovieCatalogService({ search: async (q, signal) => { forwarded = { q, signal }; return []; } });
  await movieService.search(' 인터   스텔라 ', ac.signal);
  assert.equal(forwarded.q, '인터 스텔라'); assert.equal(forwarded.signal, ac.signal);

  // Exercise installed TanStack + Supabase clients with a controlled Fetch
  // transport. No request leaves this process; this is not production latency.
  const transport = [];
  const supabase = createClient('https://search-test.supabase.co', 'test-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options) => new Promise((resolve, reject) => {
      const record = { url: String(url), options, resolve }; transport.push(record);
      const abort = () => reject(Object.assign(new Error('Aborted search'), { name: 'AbortError' }));
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener('abort', abort, { once: true });
    }) },
  });
  const repository = new SupabaseItemRepository(supabase);
  const integratedService = new ItemService(repository, {}, categories, {});
  const actual = hook('hooks/useItemSearch.ts', 'useItemSearch', cache, { itemService: integratedService });
  actual.read('old', cat); actual.fire(); const oldOptions = actual.read('old', cat);
  const observer = new QueryObserver(cache, { ...oldOptions, retry: false });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await until(() => transport.length === 1);
    assert.match(transport[0].url, /\/rest\/v1\/rpc\/search_items$/);
    assert.equal(JSON.parse(transport[0].options.body).p_query, 'old');
    // Change the key as soon as the input changes, before the next debounce expires.
    const waiting = actual.read('new', cat); observer.setOptions(waiting);
    await until(() => transport[0].options.signal.aborted);
    assert.equal(transport.length, 1, 'Typing delay does not send an intermediate request');
    actual.fire(); observer.setOptions(actual.read('new', cat));
    await until(() => transport.length === 2);
    const body = JSON.parse(transport[1].options.body);
    assert.equal(body.p_query, 'new'); assert.equal(body.p_category_ids[0], cat); assert.equal(body.p_limit, 20);
    transport[1].resolve(new Response(JSON.stringify([{ id: 'new-result', category_id: cat, name: 'New result', status: 'active', image_path: null, thumbnail_path: null, image_source_url: null }]), { headers: { 'Content-Type': 'application/json' } }));
    await until(() => observer.getCurrentResult().isSuccess);
    assert.equal(observer.getCurrentResult().data[0].id, 'new-result');
    assert.equal(cache.getQueryData(oldOptions.queryKey), undefined, 'Cancelled read must not become a fake empty-success cache entry');
    assert.equal(transport.length, 2, 'One search RPC for each actually started keyword, no category waterfall');
  } finally { unsubscribe(); actual.stop(); cache.clear(); }

  const movieRepo = new SupabaseMovieCatalogRepository(supabase);
  const movieAbort = new AbortController(); const before = transport.length;
  const cancelled = movieRepo.search('인터스텔라', movieAbort.signal).then(() => assert.fail('Cancelled movie search must reject'), (error) => error);
  await until(() => transport.length === before + 1);
  const movieRequest = transport.at(-1);
  assert.match(movieRequest.url, /\/functions\/v1\/movie-catalog$/);
  assert.equal(JSON.parse(movieRequest.options.body).action, 'search');
  movieAbort.abort(); await cancelled;
  assert.equal(movieRequest.options.signal.aborted, true);
  cache.clear();
  console.log('Search responsiveness passed: 150/200ms debounce, exact fresh-cache zero-request reuse, expiry/invalidation/category gates, one-RPC service and real-client transport cancellation with latest-result isolation.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
