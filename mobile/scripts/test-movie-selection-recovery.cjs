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
  const local = { data: [], isWaiting: false, isFetching: false, isError: false, refetch: async () => {} };
  const catalog = { data: [movie], isWaiting: false, isFetching: false, isError: false, refetch: async () => {} };
  const placeCapability = { data: false, isSuccess: true, isError: false, isFetching: false, refetch: async () => {} };
  const placeCatalog = { data: [], isWaiting: false, isFetching: false, isError: false, refetch: async () => {} };
  const placeMutation = { isPending: false, isError: false, mutateAsync: async () => { throw new Error('Unexpected place selection in media harness'); } };
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
  const { default: Find } = load('app/pick/find.tsx', {
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
    '@/hooks/useItemSearch': { useItemSearch: (...args) => { queries.push(args); return local; } },
    '@/hooks/useMovieCatalog': { useMovieCatalogSearch: () => catalog, useImportMovieCatalogItem: () => mutation },
    '@/hooks/usePlaceCatalog': {
      usePlaceCatalogCapability: () => placeCapability,
      usePlaceCatalogSearch: () => placeCatalog,
      useSelectPlaceCatalogItem: () => placeMutation,
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
    const s = setup({ externalMovieId: movie.externalId, query: undefined }); s.render(); assert.equal(s.writes.length, 1);
    s.pending[0].reject(new Error('network')); await flush(); const page = s.render(); assert.match(page, /다시 시도/);
    s.button('선택한 영화 다시 불러오기').onPress(); assert.equal(s.writes.length, 2); s.pending[1].resolve(imported); await flush(); assert.equal(s.routes.length, 1);
  });
  await check('Same-frame movie taps and stale success handlers issue one catalog request', async () => {
    const s = setup(); s.render(); const tap = s.button('인터스텔라 영화 선택').onPress; tap(); tap(); assert.equal(s.writes.length, 1);
    s.pending[0].resolve(imported); await flush(); assert.equal(s.routes.length, 1);
  });
  await check('Back, blur, unmount and changed account/category cannot be hijacked by late results', async () => {
    for (const mode of ['back','blur','unmount','account','category']) {
      const s = setup(); s.render(); s.button('인터스텔라 영화 선택').onPress();
      if (mode === 'back') s.button('돌아가기').onPress();
      if (mode === 'blur') s.focus(false);
      if (mode === 'unmount') s.unmount();
      if (mode === 'account') { s.auth.user = { id: 'other' }; s.render(); }
      if (mode === 'category') { s.setParams({ categoryId: ramenCategory, query: '라면' }); s.render(); }
      const count = s.routes.length; s.pending[0].resolve(imported); await flush(); assert.equal(s.routes.length, count, `${mode} late result must not navigate`);
    }
  });
  await check('Unverified session and non-movie return routes never start movie import', async () => {
    const loading = setup({ externalMovieId: movie.externalId, query: undefined }); loading.auth.isLoading = true; loading.render(); assert.equal(loading.writes.length, 0);
    const failed = setup({ externalMovieId: movie.externalId, query: undefined }); failed.auth.error = new Error('session'); failed.render(); assert.equal(failed.writes.length, 0);
    const ordinary = setup({ categoryId: ramenCategory, externalMovieId: movie.externalId }); ordinary.render(); assert.equal(ordinary.writes.length, 0);
  });
  await check('Mismatched category result is rejected instead of navigating to the wrong category', async () => {
    const s = setup(); s.render(); s.button('인터스텔라 영화 선택').onPress(); s.pending[0].resolve({ ...imported, categoryId: ramenCategory }); await flush();
    assert.equal(s.routes.length, 0); assert.match(s.render(), /카테고리/);
  });
  await check('A same-account acknowledgment during session failure can continue without re-import', async () => {
    const s = setup(); s.render(); s.button('인터스텔라 영화 선택').onPress(); s.pending[0].resolve(imported); await flush(); assert.equal(s.routes.length, 1);
  });
  await check('Expired authentication keeps the exact movie and existing items need no import', async () => {
    const s = setup(); s.render(); s.button('인터스텔라 영화 선택').onPress(); s.pending[0].reject(new AppError('AUTH_REQUIRED')); await flush(); s.render();
    s.button('다시 로그인하고 영화 선택 계속').onPress(); assert.equal(s.routes.at(-1).route.params.externalId, movie.externalId);
    const existing = setup(); existing.local.data = [{ id: itemId, categoryId: movieCategory, name: movie.title, status: 'active', externalSource: 'tmdb', externalId: movie.externalId }];
    existing.render(); existing.button('인터스텔라 원픽 선택').onPress(); assert.equal(existing.writes.length, 0); assert.equal(existing.routes.at(-1).route.params.itemId, itemId);
  });
  await check('Movie repository preserves typed auth/rate/availability errors and response context', async () => {
    const rows = [];
    const service = load('services/movieCatalogService.ts').MovieCatalogService;
    const instance = new service({ search: async () => rows, importItem: async () => imported });
    assert.equal((await instance.search(' 인터스텔라 ')).length, 0);
  });
  await check('Overlong catalog queries do not become repeated server errors and local search stays usable', async () => {
    const { MovieCatalogService } = load('services/movieCatalogService.ts'); const calls = [];
    const service = new MovieCatalogService({ search: async (q) => { calls.push(q); return []; } });
    await service.search('a'.repeat(61)); await service.search('a'); assert.equal(calls.length, 0);
    await service.search('a'.repeat(60)); assert.equal(calls.length, 1);
    let settled = 'a'.repeat(61);
    const s = setup({ query: settled }); s.render(); assert.equal(s.queries.at(-1)[0], settled);
  });
  await check('Failed category reads hide stale choices and retries never create a Pick', async () => {
    const s = setup(); s.categories.isError = true; s.render(); assert.equal(s.writes.length, 0);
  });
  console.log(`Movie selection recovery: ${checks - failures}/${checks} groups passed.`);
  if (failures) process.exitCode = 1;
}
main();
