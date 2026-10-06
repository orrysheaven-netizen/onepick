const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const text = (value) => value == null || typeof value === 'boolean' ? '' : Array.isArray(value) ? value.map(text).join('')
  : typeof value === 'object' ? text(value.props?.children) : String(value);
const flush = () => new Promise((resolve) => setImmediate(resolve));
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Response, URL, setTimeout, clearTimeout, require(name) {
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name === '@/lib/items/pickChannel') return load('lib/items/pickChannel.ts');
    if (name === '@/lib/home/homeCategoryFilters') return load('lib/home/homeCategoryFilters.ts', { '@/lib/categories/categoryTree': load('lib/categories/categoryTree.ts') });
    if (name === '@/hooks/useExploreData' && !(name in imports)) return { useExploreCategories: () => ({ data: [], isPending: false, isError: false, isFetching: false, refetch() {} }) };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name in imports) return imports[name];
    assert.fail(`Unexpected dependency: ${name}`);
  } });
  return exports;
}
const { AppError } = load('errors/appError.ts');
const movieCategory = 'a1111111-1111-4111-8111-111111111111';
const ramenCategory = 'b2222222-2222-4222-8222-222222222222';
const itemId = 'c3333333-3333-4333-8333-333333333333';
const movie = { source: 'tmdb', externalId: '157336', title: '인터스텔라', originalTitle: 'Interstellar', releaseYear: 2014, posterUrl: null, existingItemId: null };
const imported = { itemId, categoryId: movieCategory, created: false };

// Source-level lifecycle runner. Effects run after render, refs persist, keyed
// scopes unmount, and blur/focus cleanup is exercised. This is NOT device E2E.
function setup(overrides = {}) {
  let params = { categoryId: movieCategory, query: '인터스텔라', ...overrides };
  const auth = { user: { id: 'owner' }, isLoading: false, error: null, retries: 0, retry() { auth.retries++; } };
  const categories = { data: [
    { id: movieCategory, parentId: 'content', name: '영화', slug: 'movie', label: '콘텐츠 › 영화', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
    { id: ramenCategory, parentId: 'food', name: '라면', slug: 'ramen', label: '먹을 것 › 라면', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
  ], isError: false, refetch: async () => {} };
  const categoryCatalog = [
    { id: 'content', parentId: null, name: '콘텐츠', slug: 'content', status: 'open', isVisible: true, isPickable: false, sortOrder: 20 },
    { id: 'food', parentId: null, name: '먹을 것', slug: 'food', status: 'open', isVisible: true, isPickable: false, sortOrder: 10 },
    ...categories.data,
  ];
  const categoryTree = load('lib/categories/categoryTree.ts');
  const local = { data: [], isWaiting: false, isFetching: false, isError: false, refetch: async () => {} };
  const catalog = { data: [movie], isWaiting: false, isFetching: false, isError: false, refetch: async () => {} };
  const pending = [], writes = [], routes = [], queries = [];
  const mutation = { isPending: false, isError: false, error: null,
    mutateAsync: (id) => { writes.push(id); return new Promise((resolve, reject) => pending.push({
      resolve, reject: (error) => { mutation.isError = true; mutation.error = error; reject(error); },
    })); } };
  const scopes = new Map(); let active, used, effects, nodes = [], focused = true;
  const different = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const owner = active; const i = owner.index++;
      if (!(i in owner.slots)) owner.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [owner.slots[i], (value) => { owner.slots[i] = typeof value === 'function' ? value(owner.slots[i]) : value; }];
    },
    useRef(initial) { const i = active.index++; return active.slots[i] ??= { current: initial }; },
    useMemo(compute, deps) { const i = active.index++; const slot = active.slots[i];
      if (!slot || different(slot.deps, deps)) active.slots[i] = { value: compute(), deps };
      return active.slots[i].value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect, deps) {
      const owner = active; const i = owner.index++; const previous = owner.slots[i];
      if (!previous || different(previous.deps, deps)) effects.push(() => {
        previous?.cleanup?.();
        owner.slots[i] = { deps, cleanup: effect(), effect: true };
      });
    },
  };
  const native = { StyleSheet: { create: (styles) => styles } };
  for (const name of ['View', 'Text', 'TextInput', 'ScrollView', 'ActivityIndicator', 'Pressable']) native[name] = name;
  const { default: Find } = load('app/pick/find.tsx', { '@/lib/navigation/swipeBack': { useSwipeBackHandler() {} },
    react: hooks, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { useRouter: () => ({
      push: (route) => routes.push({ action: 'push', route }), replace: (route) => routes.push({ action: 'replace', route }),
      canGoBack: () => false, back: () => routes.push({ action: 'back' }),
    }), useLocalSearchParams: () => params, useFocusEffect: (callback) => hooks.useEffect(() => focused ? callback() : undefined, [focused, callback]) },
    '@/errors/appError': { AppError }, '@/components/pick-photo': { PickPhoto: 'PickPhoto' },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: 'PickPhoto' } }),
    '@/components/music-search-link': { MusicSearchLink: 'MusicSearchLink' },
    '@/components/game-search-link': { GameSearchLink: 'GameSearchLink' },
    '@/components/youtube-search-link': { YoutubeSearchLink: 'YoutubeSearchLink' },
    '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/hooks/useExploreData': { useExploreCategories: () => ({ data: categoryCatalog }) },
    '@/hooks/useRegistrationCategories': { useRegistrationCategories: () => categories },
    '@/hooks/useRegisterPick': { useRegistrationCategories: () => categories },
    '@/lib/categories/categoryTree': categoryTree,
    '@/lib/profile/profilePickGroups': { splitLabPicks: (picks) => ({ main: picks, lab: [] }), isLabCategory: () => false }, '@/components/profile-lab-entry': { ProfileLabEntry: () => null }, '@/lib/home/homeChannels': load('lib/home/homeChannels.ts'), '@/lib/categories/registrationRoute': load('lib/categories/registrationRoute.ts'),
    '@/hooks/useItemSearch': { useItemSearch: (...args) => { queries.push(args); return local; } },
    '@/hooks/useMovieCatalog': { useMovieCatalogSearch: () => catalog, useImportMovieCatalogItem: () => mutation },
    '@/hooks/usePlaceCatalog': {
      usePlaceCatalogCapability: () => ({ data: false, isSuccess: true, isError: false, isFetching: false, refetch: async () => {} }),
      usePlaceCatalogSearch: () => ({ data: [], isWaiting: false, isFetching: false, isError: false, refetch: async () => {} }),
      useSelectPlaceCatalogItem: () => ({ isPending: false, isError: false, mutateAsync: async () => { throw new Error('Unexpected place selection'); } }),
    },
  });
  function walk(value, location) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((child, i) => walk(child, `${location}/${i}`));
    const key = `${location}:${value.key ?? ''}`;
    if (typeof value.type === 'function') {
      let owner = scopes.get(key); if (!owner) { owner = { index: 0, slots: [] }; scopes.set(key, owner); }
      used.add(key); owner.index = 0; active = owner;
      return walk(value.type(value.props), `${key}/render`);
    }
    const node = { ...value, props: { ...value.props, children: walk(value.props.children, `${key}/children`) } };
    nodes.push(node); return node;
  }
  const cleanup = (scope) => { for (const slot of scope.slots) if (slot?.effect) slot.cleanup?.(); };
  const render = () => {
    nodes = []; used = new Set(); effects = [];
    const tree = walk(jsx(Find), 'root');
    for (const [key, scope] of scopes) if (!used.has(key)) { cleanup(scope); scopes.delete(key); }
    effects.forEach((effect) => effect());
    return text(tree);
  };
  const button = (label) => {
    const found = nodes.find((node) => node.type === 'Pressable' && (node.props.accessibilityLabel === label || text(node) === label));
    assert.ok(found, `Missing button: ${label}`); return found.props;
  };
  return { render, button, auth, categories, catalog, local, writes, pending, routes, mutation, queries,
    input: () => nodes.find((n) => n.type === 'TextInput')?.props,
    setParams: (value) => { params = value; },
    focus: (value) => { focused = value; render(); },
    unmount: () => { scopes.forEach(cleanup); scopes.clear(); },
  };
}
let checks = 0, failures = 0;
async function check(name, run) {
  checks++; try { await run(); console.log(`ok: ${name}`); }
  catch (error) { failures++; console.error(`not ok: ${name}\n${error.stack}`); }
}
async function main() {
  await check('Post-login movie import fails once and offers an explicit same-movie retry', async () => {
    const s = setup({ query: undefined, externalMovieId: '157336' }); s.render(); s.render();
    assert.equal(s.writes.join(','), '157336');
    s.pending[0].reject(new Error('offline')); await flush();
    s.render(); s.render(); assert.equal(s.writes.length, 1, 'Failure must not trigger an automatic request loop');
    s.button('선택한 영화 다시 불러오기').onPress(); assert.equal(s.writes.join(','), '157336,157336');
    s.pending[1].resolve(imported); await flush(); s.render();
    assert.equal(s.routes.length, 1); assert.equal(s.routes[0].action, 'replace');
    assert.equal(s.routes[0].route.params.itemId, itemId); assert.equal(s.routes[0].route.params.categoryId, movieCategory);
    assert.equal(s.routes[0].route.params.oneLineReview, undefined, 'Importing a catalog item is not writing a Pick');
  });
  await check('Same-frame movie taps and stale success handlers issue one catalog request', async () => {
    const s = setup(); s.render(); const tap = s.button('인터스텔라 영화 선택').onPress;
    tap(); tap(); assert.equal(s.writes.length, 1);
    s.render(); assert.equal(s.input().editable, false);
    s.pending[0].resolve(imported); await flush(); tap(); assert.equal(s.writes.length, 1); assert.equal(s.routes.length, 1);
  });
  await check('Back, blur, unmount and changed account/category cannot be hijacked by late results', async () => {
    for (const mode of ['back', 'blur', 'unmount', 'account', 'category']) {
      const s = setup(); s.render(); s.button('인터스텔라 영화 선택').onPress();
      if (mode === 'back') s.button('돌아가기').onPress();
      if (mode === 'blur') s.focus(false);
      if (mode === 'unmount') s.unmount();
      if (mode === 'account') { s.auth.user = { id: 'other' }; s.render(); }
      if (mode === 'category') { s.setParams({ categoryId: ramenCategory, query: '라면' }); s.render(); }
      const before = s.routes.length; s.pending[0].resolve(imported); await flush();
      assert.equal(s.routes.length, before, `Late ${mode} result must not navigate`);
    }
    const s = setup(); s.render(); s.button('인터스텔라 영화 선택').onPress(); s.focus(false);
    s.pending[0].resolve(imported); await flush(); s.focus(true);
    assert.equal(s.routes.length, 0); s.button('선택한 영화 다시 불러오기').onPress(); assert.equal(s.writes.length, 2);
  });
  await check('Unverified session and non-movie return routes never start movie import', async () => {
    for (const state of ['loading', 'error', 'ramen', 'array', 'invalid']) {
      const s = setup({ externalMovieId: '157336' });
      if (state === 'loading') s.auth.isLoading = true;
      if (state === 'error') s.auth.error = new Error('auth verification failed');
      if (state === 'ramen') s.setParams({ categoryId: ramenCategory, externalMovieId: '157336' });
      if (state === 'array') s.setParams({ categoryId: movieCategory, externalMovieId: ['157336'] });
      if (state === 'invalid') s.setParams({ categoryId: movieCategory, externalMovieId: '../../bad' });
      const page = s.render(); assert.equal(s.writes.length, 0, state);
      if (state === 'loading' || state === 'error') { assert.equal(s.input(), undefined); assert.doesNotMatch(page, /Interstellar/); }
      if (state === 'error') { s.button('다시 확인하기').onPress(); assert.equal(s.auth.retries, 1); }
    }
  });
  await check('Mismatched category result is rejected instead of navigating to the wrong category', async () => {
    const s = setup(); s.render(); s.button('인터스텔라 영화 선택').onPress();
    s.pending[0].resolve({ ...imported, categoryId: ramenCategory }); await flush();
    assert.equal(s.routes.length, 0); assert.match(s.render(), /카테고리/);
    assert.ok(s.button('선택한 영화 다시 불러오기'));
  });
  await check('A same-account acknowledgment during session failure can continue without re-import', async () => {
    const s = setup({ query: undefined, externalMovieId: '157336' }); s.render();
    s.auth.error = new Error('auth temporarily unavailable'); s.render();
    s.pending[0].resolve(imported); await flush(); assert.equal(s.routes.length, 0);
    s.auth.error = null; s.render(); s.render(); assert.equal(s.writes.length, 1);
    const next = s.button('선택한 영화로 계속').onPress; next(); next();
    assert.equal(s.routes.length, 1); assert.equal(s.writes.length, 1);
  });
  await check('Expired authentication keeps the exact movie and existing items need no import', async () => {
    const s = setup({ externalMovieId: '157336', query: undefined }); s.render();
    s.pending[0].reject(new AppError('AUTH_REQUIRED')); await flush(); s.render();
    s.button('다시 로그인하고 영화 선택 계속').onPress();
    assert.equal(s.routes[0].route.pathname, '/auth/login'); assert.equal(s.routes[0].route.params.action, 'choose_movie');
    assert.equal(s.routes[0].route.params.externalId, '157336'); assert.equal(s.routes[0].route.params.categoryId, movieCategory);
    const guest = setup(); guest.auth.user = null; guest.render(); guest.button('인터스텔라 영화 선택').onPress();
    assert.equal(guest.writes.length, 0); assert.equal(guest.routes[0].route.pathname, '/auth/login');
    const known = setup(); known.catalog.data = [{ ...movie, existingItemId: itemId }]; known.render(); known.button('인터스텔라 영화 선택').onPress();
    assert.equal(known.writes.length, 0); assert.equal(known.routes[0].route.params.itemId, itemId);
  });
  await check('Movie repository preserves typed auth/rate/availability errors and response context', async () => {
    const { SupabaseMovieCatalogRepository } = load('repositories/supabase/supabaseMovieCatalogRepository.ts', { '@/errors/appError': { AppError } });
    let error;
    const repo = new SupabaseMovieCatalogRepository({ functions: { invoke: async () => ({ data: null, error }) } });
    for (const [status, remote, expected] of [[401, 'AUTH_REQUIRED', 'AUTH_REQUIRED'], [429, 'RATE_LIMITED', 'RATE_LIMITED'],
      [409, 'ITEM_NOT_ELIGIBLE', 'ITEM_NOT_ELIGIBLE'], [404, 'MOVIE_NOT_FOUND', 'ITEM_NOT_FOUND'], [503, 'CATEGORY_NOT_FOUND', 'CATEGORY_NOT_FOUND'], [502, 'PRIVATE_RAW_MESSAGE', 'NETWORK_ERROR']]) {
      const response = new Response(JSON.stringify({ error: remote }), { status }); error = { context: response };
      await assert.rejects(() => repo.importMovie('157336'), (cause) => cause.code === expected && !cause.message.includes('PRIVATE_RAW_MESSAGE'));
      assert.equal(response.bodyUsed, false, 'Classifying an error must not consume its reusable context');
    }
    error = { context: new Response('not json', { status: 401 }) };
    await assert.rejects(() => repo.importMovie('157336'), (cause) => cause.code === 'AUTH_REQUIRED');
    error = { context: { json: () => assert.fail('Do not execute arbitrary error payload methods') } };
    await assert.rejects(() => repo.importMovie('157336'), (cause) => cause.code === 'NETWORK_ERROR');
  });
  await check('Overlong catalog queries do not become repeated server errors and local search stays usable', async () => {
    const { MovieCatalogService } = load('services/movieCatalogService.ts'); const calls = [];
    const service = new MovieCatalogService({ search: async (q) => { calls.push(q); return []; } });
    await service.search('a'.repeat(61)); await service.search('a'); assert.equal(calls.length, 0);
    await service.search('a'.repeat(60)); assert.equal(calls.length, 1);
    let settled = 'a'.repeat(61);
    const { useMovieCatalogSearch } = load('hooks/useMovieCatalog.ts', {
      react: { useState: () => [settled, () => {}], useEffect() {} },
      '@tanstack/react-query': { useQuery: (options) => options, useMutation: (options) => options,
        useQueryClient: () => ({ getQueryState: () => undefined }) },
      '@/lib/query/queryKeys': { queryKeys: { movieCatalog: { search: (q) => ['movie-catalog', 'search', q] } } },
      '@/services': { movieCatalogService: service },
    });
    assert.equal(useMovieCatalogSearch(settled, true).enabled, false);
    settled = 'a'.repeat(60); assert.equal(useMovieCatalogSearch(settled, true).enabled, true);
    const s = setup({ query: 'a'.repeat(61) }); s.local.data = [{ id: itemId, categoryId: movieCategory, name: '등록된 영화', status: 'active' }];
    assert.match(s.render(), /60자 이내/); s.button('등록된 영화 원픽 선택').onPress(); assert.equal(s.routes[0].route.params.itemId, itemId);
  });
  await check('Failed category reads hide stale choices and retries never create a Pick', async () => {
    const s = setup(); s.categories.isError = true; s.local.data = [{ id: itemId, categoryId: movieCategory, name: 'STALE_PRIVATE_TITLE' }];
    const page = s.render(); assert.doesNotMatch(page, /STALE_PRIVATE_TITLE|Interstellar/);
    s.button('카테고리 다시 불러오기').onPress(); assert.equal(s.writes.length, 0);
  });
  console.log(`Movie selection recovery: ${checks - failures}/${checks} groups passed.`);
  if (failures) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });