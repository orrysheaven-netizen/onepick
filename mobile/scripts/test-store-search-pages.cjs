const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { QueryClient, InfiniteQueryObserver } = require('@tanstack/react-query');

function load(file, imports, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, ...globals, require: (name) => {
    if (name === 'react/jsx-runtime') return require(name);
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name === '@/lib/pick/registrationFooterLayout') return load('lib/pick/registrationFooterLayout.ts');
    assert.ok(name in imports, `Unexpected import ${name}`); return imports[name];
  } });
  return exports;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const textOf = (node) => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';

// Render the real registration screen, preserving its state and executing its
// native event callbacks. Only native host components and unrelated hooks are
// stubbed; pagination uses the real hook, observer and service below.
function screenHarness(service, serviceModule, routeParams = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const states = [], refs = [], nextOptions = [], selections = [];
  let observer, unsubscribe, settled = '', options, stateIndex, refIndex, dirty;
  let pressables, inputs, scrolls, cards, indicators, refetches = 0;
  let auth = { user: { id: 'pagination-owner' }, isLoading: false };
  let provider = { data: null, isLoading: false, isError: false };
  let lastSearch;
  const fakeReact = { ...React,
    useState(initial) {
      const i = stateIndex++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], (value) => {
        const next = typeof value === 'function' ? value(states[i]) : value;
        if (!Object.is(next, states[i])) { states[i] = next; dirty = true; }
      }];
    },
    useRef(initial) {
      const i = refIndex++;
      if (!(i in refs)) refs[i] = { current: initial };
      return refs[i];
    },
    useMemo: (fn) => fn(),
  };
  const part = (tag) => ({ children }) => React.createElement(tag, null, children);
  const native = {
    View: part('div'), Text: part('span'), Image: () => null,
    ScrollView: (props) => { scrolls.push(props); return React.createElement('main', null, props.children); },
    TextInput: (props) => { inputs.push(props); return React.createElement('input', { 'aria-label': props.accessibilityLabel }); },
    Pressable: (props) => {
      pressables.push(props);
      return React.createElement('button', null, typeof props.children === 'function' ? props.children({ pressed: false }) : props.children);
    },
    ActivityIndicator: (props) => { indicators.push(props); return null; },
    StyleSheet: { create: (value) => value },
  };
  const paged = load('hooks/useStoreFirst.ts', {
    react: { useState: () => [settled, (value) => { settled = value; }], useEffect: (fn) => fn() },
    '@tanstack/react-query': { useInfiniteQuery(value) {
      options = value;
      if (!observer) {
        observer = new InfiniteQueryObserver(client, value);
        unsubscribe = observer.subscribe(() => {});
      } else observer.setOptions(value);
      return { ...observer.getCurrentResult(),
        fetchNextPage: (value) => { nextOptions.push(value); return observer.fetchNextPage(value); },
        refetch: () => { refetches++; return observer.refetch(); },
      };
    } },
    '@/services': {}, '@/services/storeFirstService': { storeFirstService: service },
  }, { setTimeout: () => 1, clearTimeout() {} });
  const mutation = (run = async () => null) => ({ isPending: false, isError: false, error: null, reset() {}, mutateAsync: run });
  const { default: Screen } = load('app/pick/new.tsx', {
    react: fakeReact, 'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: part('section'), useSafeAreaInsets: () => ({ bottom: 0 }) },
    'expo-crypto': { randomUUID: () => 'pagination-request' },
    'expo-router': { useLocalSearchParams: () => routeParams,
      useRouter: () => ({ push() {}, replace() {}, back() {}, canGoBack: () => true }) },
    '@/components/ui': { Icon: () => null, StateCard: (props) => {
      cards.push(props);
      return React.createElement('section', null, props.title, props.text,
        props.action ? React.createElement(native.Pressable, {
          accessibilityLabel: props.action.label, onPress: props.action.onPress,
        }, props.action.label) : null);
    } },
    '@/components/ui/dialog-labels': { DIALOG_CANCEL_LABEL: '취소해요' },
    '@/errors/appError': { AppError: Error },
    '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/hooks/useItemDetail': { useItemDetail: () => ({ data: undefined }) },
    '@/hooks/useRegisterPick': {
      useChoosePhoto: () => mutation(), useReadCurrentPickSlot: () => mutation(), useRegisterItemPick: () => mutation(),
    },
    '@/hooks/useLinkCategorySuggestions': { useLinkCategorySuggestions: () => ({ data: undefined, isPending: false, reset() {} }) },
    '@/hooks/useStoreFirst': {
      useProviderStorePrefill: () => provider,
      useStoreSearch: (channel, query, enabled) => { lastSearch = paged.useStoreSearch(channel, query, enabled); return lastSearch; },
      useMenuOptions: () => ({ data: [{ categoryId: 'menu-coffee', name: '아메리카노', groupName: '음료', placeEnabled: true }], isSuccess: true }),
      useMenuSuggestions: () => ({ data: undefined, isFetching: false }),
      useSelectStoreItem: () => mutation(async (input) => {
        selections.push(input);
        return { itemId: 'existing-coffee', categoryId: input.categoryId, hasPhoto: true, pending: false, brand: null };
      }),
    },
    '@/lib/items/pickChannel': { PLACE_COVERAGE_NOTICE: '매장을 검색해주세요.' },
    '@/lib/items/pickSavedToast': { armPickSavedToast() {} },
    '@/lib/photos/photoFailure': { showPhotoFailure() {}, isPhotoFailure: () => false },
    '@/lib/pick/pickDraft': { pickDraftStore: () => ({ load: () => null, save() {}, savePhoto() {}, clear() {} }) },
    '@/lib/navigation/swipeBack': { useSwipeBackHandler() {} },
    '@/services/storeFirstService': serviceModule,
  });
  const render = () => {
    let page;
    for (let pass = 0; pass < 10; pass++) {
      dirty = false; stateIndex = 0; refIndex = 0;
      pressables = []; inputs = []; scrolls = []; cards = []; indicators = [];
      page = renderToStaticMarkup(React.createElement(Screen));
      if (!dirty) return page;
    }
    assert.fail('Registration render did not settle');
  };
  const input = (label) => {
    const found = inputs.find((props) => props.accessibilityLabel === label);
    assert.ok(found, `Expected input: ${label}`); return found;
  };
  const press = (label) => {
    const found = pressables.find((props) => props.accessibilityLabel === label);
    assert.ok(found, `Expected control: ${label}`);
    assert.ok(!found.disabled, `Disabled control: ${label}`);
    return found.onPress();
  };
  const scroll = (y = 2400) => {
    assert.equal(scrolls.length, 1, 'registration uses its visible outer scroll view');
    scrolls[0].onScroll?.({ nativeEvent: {
      contentOffset: { x: 0, y }, layoutMeasurement: { width: 390, height: 700 }, contentSize: { width: 390, height: 3100 },
    } });
  };
  return {
    render, input, press, scroll, nextOptions, selections,
    settle: async (value) => { settled = value; render(); await flush(); return render(); },
    get rows() { return pressables.filter((props) => props.accessibilityLabel?.endsWith(' 선택')); },
    get cards() { return cards; }, get indicators() { return indicators; }, get scrollProps() { return scrolls[0]; },
    get search() { return lastSearch; }, get queryOptions() { return options; }, get refetches() { return refetches; },
    setAuth: (value) => { auth = value; }, setProvider: (value) => { provider = value; },
    dispose() { unsubscribe?.(); observer?.destroy(); client.clear(); },
  };
}

async function screenPagination(service, serviceModule, calls, setFail) {
  const screen = screenHarness(service, serviceModule);
  try {
    let page = screen.render();
    assert.match(page, /네이버 지도 링크를 입력해주세요/, 'default entry preserves the link-first flow');
    assert.equal(screen.queryOptions.enabled, false);
    screen.scroll();
    assert.equal(calls.length, 0, 'link entry does not load the store catalog');
    screen.press('URL 없음'); screen.render();
    screen.input('매장명 검색').onChangeText('카페인중독'); screen.render();
    assert.equal(screen.search.isWaiting, true);
    screen.scroll();
    assert.equal(calls.length, 0, 'debounce does not issue a premature append');
    await screen.settle('카페인중독');
    assert.equal(screen.rows.length, 20);
    assert.equal(calls.length, 1);
    assert.equal(typeof screen.scrollProps.onScroll, 'function', 'the actual registration ScrollView must load later pages');

    // Cached hasNextPage remains true while the hook masks stale/disabled rows.
    // Fire the actual screen callback in each state: it must respect those masks.
    for (const value of ['다른 매장', '', '카', '가'.repeat(101)]) {
      screen.input('매장명 검색').onChangeText(value); screen.render();
      assert.equal(screen.rows.length, 0, `old rows hidden for ${value.length} characters`);
      screen.scroll();
      assert.equal(calls.length, 1, 'stale or invalid input does not append cached results');
    }
    screen.input('매장명 검색').onChangeText('카페인중독'); screen.render();
    screen.press('이전 단계'); page = screen.render();
    assert.match(page, /네이버 지도 링크를 입력해주세요/);
    screen.scroll();
    assert.equal(calls.length, 1, 'returning to link entry disables a cached search');
    screen.press('URL 없음'); screen.render();
    screen.press('찾는 매장이 없어요.'); screen.render();
    assert.equal(screen.input('등록 요청 이름').value, '카페인중독');
    screen.scroll();
    assert.equal(calls.length, 1, 'new-store entry does not append hidden search results');
    screen.press('이전 단계'); screen.render();

    // Keep a live next cursor while leaving the result screen; a terminal page
    // would make these assertions pass even if the screen ignored its state.
    screen.rows[0].onPress(); page = screen.render();
    assert.match(page, /2 \/ 4/);
    assert.equal(screen.search.hasNextPage, true);
    screen.scroll();
    assert.equal(calls.length, 1, 'menu step does not append a cached, unfinished store search');
    screen.press('이전 단계'); screen.render();
    screen.setAuth({ user: null, isLoading: false }); page = screen.render();
    assert.match(page, /로그인하고 원픽을 등록해보세요/);
    assert.equal(screen.search.hasNextPage, true);
    screen.scroll();
    assert.equal(calls.length, 1, 'disabled signed-out flow does not append cached results');
    screen.setAuth({ user: { id: 'pagination-owner' }, isLoading: false }); screen.render();

    screen.scroll(0);
    assert.equal(calls.length, 1, 'scrolling away from the bottom does not prefetch every page');
    // Two events before React can render is the race cancelRefetch:false handles.
    screen.scroll(); screen.scroll(); screen.render();
    assert.equal(calls.length, 2, 'rapid end scrolls issue one request');
    assert.equal(calls.at(-1).args.p_cursor, 'opaque-20');
    assert.equal(screen.rows.length, 20, 'visible rows survive an in-flight append');
    assert.ok(screen.indicators.length > 0, 'append has a visible loading indicator');
    const duringFetch = screen.nextOptions.length;
    screen.scroll();
    assert.equal(screen.nextOptions.length, duringFetch, 'a rendered in-flight state blocks another append');
    assert.ok(screen.nextOptions.every((value) => value.cancelRefetch === false), 'rapid events must not cancel the append');
    await flush(); page = screen.render();
    assert.equal(screen.rows.length, 40, 'actual screen scrolling reaches the second page');

    setFail(true);
    screen.scroll(); await flush(); page = screen.render();
    assert.equal(screen.rows.length, 40, 'append failure retains both successful pages');
    assert.equal(screen.search.isFetchNextPageError, true);
    assert.equal(screen.cards.length, 1, 'append failure exposes a single recovery action');
    assert.ok(screen.cards[0].action?.onPress, 'append error can be retried from the screen');
    const failedCalls = calls.length;
    screen.scroll();
    assert.equal(calls.length, failedCalls, 'failing append is not automatically retried on every scroll');
    setFail(false);
    screen.cards[0].action.onPress(); screen.render();
    assert.equal(screen.refetches, 0, 'append retry must not refetch successful pages');
    assert.equal(calls.at(-1).args.p_cursor, 'opaque-40', 'screen retry repeats only the failed cursor');
    assert.equal(screen.rows.length, 40, 'retry keeps existing results visible');
    await flush(); page = screen.render();
    assert.equal(screen.rows.length, 41);
    assert.match(page, /검색 결과를 모두 확인했어요/, 'terminal results have a visible end-of-list message');
    assert.equal(screen.cards.length, 0, 'successful retry clears the error');
    assert.equal(screen.search.hasNextPage, false);
    const terminalCalls = calls.length;
    screen.scroll(); await flush();
    assert.equal(calls.length, terminalCalls, 'screen stops requesting at the terminal cursor');
    assert.deepEqual(screen.rows.map((props) => textOf(props.children).match(/· (본점|지점\d+)/)?.[1]),
      Array.from({ length: 41 }, (_, i) => i === 0 ? '본점' : `지점${i}`), 'screen preserves global server order without duplicate branches');

    screen.rows[40].onPress(); page = screen.render();
    assert.match(page, /2 \/ 4 · 카페인중독 · 지점40/, 'the 41st result is selectable');
    screen.scroll();
    assert.equal(calls.length, terminalCalls, 'menu step does not request store pages');
    screen.input('메뉴 이름').onChangeText('아메리카노'); screen.render();
    // The app classifies the exact menu automatically; no category button is needed.
    screen.press('다음'); await flush();
    page = screen.render();
    assert.equal(screen.selections[0].store.catalogId, 'store-40', 'menu preflight receives the selected page-three catalog identity');
    assert.match(page, /4 \/ 4 · 카페인중독 · 지점40/, 'selected store survives the existing-photo step transition');
  } finally { screen.dispose(); setFail(false); }

  const prefill = { kind: 'place', catalogId: 'store-prefill', name: '서울집', branchName: '성수점',
    region: '서울 성동구', address: null, providerCategory: '카페', mapUrl: 'https://naver.me/prefill' };
  for (const provider of [{ data: prefill, isLoading: false }, { data: null, isLoading: true }]) {
    const prefilling = screenHarness(service, serviceModule, { providerId: '11111111-1111-1111-1111-111111111111' });
    try {
      prefilling.setProvider(provider); prefilling.render();
      const before = calls.length;
      if (provider.data) assert.equal(prefilling.input('매장명 검색').value, '서울집 성수점');
      else {
        prefilling.input('매장명 검색').onChangeText('카페인중독');
        await prefilling.settle('카페인중독');
      }
      assert.equal(prefilling.queryOptions.enabled, false, 'provider context owns the store while selected or loading');
      prefilling.scroll();
      assert.equal(calls.length, before, 'provider context does not start an unrelated catalog search');
    } finally { prefilling.dispose(); }
  }
}

async function selectedStoreRegression(StoreFirstService) {
  const categoryId = '22222222-2222-2222-2222-222222222222';
  const otherCategoryId = '33333333-3333-3333-3333-333333333333';
  const selected = { kind: 'place', catalogId: 'store-40', name: '카페인중독', branchName: '지점40',
    region: '서울 관악구', address: null, providerCategory: '카페', mapUrl: null };
  function fixture() {
    const tables = {
      place_catalog: Array.from({ length: 41 }, (_, i) => ({ id: `store-${i}`, name: selected.name,
        place_provider: 'sbiz', provider_place_id: `sbiz-${i}`, business_status: 'open' })),
      places: Array.from({ length: 41 }, (_, i) => ({ id: `place-${i}`,
        place_provider: 'sbiz', provider_place_id: `sbiz-${i}`, is_visible: true })),
      item_places: [
        { place_id: 'place-0', category_id: categoryId, item_id: 'first-item' },
        { place_id: 'place-40', category_id: otherCategoryId, item_id: 'different-category-item' },
        { place_id: 'place-40', category_id: categoryId, item_id: 'branch-item' },
      ],
      items: [
        { id: 'first-item', category_id: categoryId, status: 'active', image_path: 'first.jpg' },
        { id: 'different-category-item', category_id: otherCategoryId, status: 'active', image_path: 'other.jpg' },
        { id: 'branch-item', category_id: categoryId, status: 'active', image_path: 'branch.jpg' },
        { id: 'brand-item', category_id: categoryId, status: 'active', thumbnail_path: 'brand-thumb.jpg' },
      ],
      providers: [{ id: 'provider-40', place_id: 'place-40', brand_id: 'brand-40', status: 'active' }],
      brands: [{ id: 'brand-40', name: selected.name, logo_path: 'brand-logo.png', is_active: true }],
      item_brand_scopes: [{ brand_id: 'brand-40', category_id: categoryId, item_id: 'brand-item' }],
    };
    const reads = [];
    const state = { enabled: true, errorAt: null };
    const failure = new Error('fixture database failure');
    const service = new StoreFirstService({
      async rpc(name, args) {
        if (name === 'category_uses_place_catalog') {
          assert.equal(args.p_category_id, categoryId);
          return { data: state.enabled, error: state.errorAt === 'category' ? failure : null };
        }
        // Model the old first-20 search faithfully, so the pre-fix service fails
        // on the selected row's identity rather than an unexpected mock call.
        if (name === 'search_place_catalog') return { data: tables.place_catalog.slice(0, args.p_limit).map((row) => ({
          ...row, catalog_id: row.id, existing_item_id: row.id === 'store-0' ? 'first-item' : null,
        })), error: null };
        assert.fail(`Unexpected selection RPC: ${name}`);
      },
      from(table) {
        assert.ok(table in tables, `Unexpected selection table: ${table}`);
        const filters = [];
        let columns = '';
        reads.push({ table, filters });
        const valueAt = (row, field) => field === 'items.status'
          ? tables.items.find((item) => item.id === row.item_id)?.status : row[field];
        return {
          select(value) { columns = value; return this; },
          eq(field, value) { filters.push({ field, matches: (row) => valueAt(row, field) === value }); return this; },
          in(field, values) { filters.push({ field, matches: (row) => values.includes(valueAt(row, field)) }); return this; },
          async maybeSingle() {
            if (state.errorAt === table) return { data: null, error: failure };
            const rows = tables[table].filter((row) => filters.every((filter) => {
              // A left embedded relation does not filter its parent row; the
              // status constraint must belong to an inner items relation.
              if (filter.field.startsWith('items.') && !columns.includes('items!inner(')) return true;
              return filter.matches(row);
            }));
            assert.ok(rows.length <= 1, `Selection is not scoped to one ${table} row`);
            return { data: rows[0] ?? null, error: null };
          },
        };
      },
      storage: { from: () => ({ getPublicUrl: (logo) => ({ data: { publicUrl: `https://example.test/${logo}` } }) }) },
    });
    return { service, tables, reads, state, failure };
  }
  const full = fixture();
  const result = await full.service.selectItem(categoryId, selected);
  assert.equal(result.itemId, 'branch-item', 'page-three selection resolves the exact store, not a same-name first-page branch');
  assert.equal(result.hasPhoto, true, 'a later result keeps its existing photo');
  assert.equal(result.pending, false);
  assert.equal(result.brand?.providerId, 'provider-40');
  assert.equal(result.brand?.brandId, 'brand-40', 'a later result keeps the branch/brand choice');
  assert.equal(result.brand?.itemId, 'brand-item');
  assert.equal(result.brand?.hasPhoto, true, 'brand-wide photo state is preserved');
  assert.equal(result.brand?.logoUrl, 'https://example.test/brand-logo.png');

  const disabled = fixture(); disabled.state.enabled = false;
  const unavailable = await disabled.service.selectItem(categoryId, selected);
  assert.equal(unavailable.itemId, null);
  assert.equal(unavailable.brand, null);
  assert.equal(disabled.reads.length, 0, 'a disabled place category does not read store or item relations');

  for (const [name, mutate] of [
    ['missing catalog', (tables) => { tables.place_catalog.pop(); }],
    ['closed catalog', (tables) => { tables.place_catalog.at(-1).business_status = 'closed'; }],
    ['missing place', (tables) => { tables.places.pop(); }],
    ['hidden place', (tables) => { tables.places.at(-1).is_visible = false; }],
  ]) {
    const test = fixture(); mutate(test.tables);
    const absent = await test.service.selectItem(categoryId, selected);
    assert.equal(absent.itemId, null, `${name} must not expose an existing item`);
    assert.equal(absent.brand, null, `${name} must not expose brand scope`);
  }
  for (const status of ['pending', 'rejected', 'discontinued']) {
    const test = fixture();
    test.tables.items.find((row) => row.id === 'branch-item').status = status;
    const state = await test.service.selectItem(categoryId, selected);
    assert.equal(state.itemId, status === 'discontinued' ? 'branch-item' : null, `preflight preserves existing eligibility for ${status} items`);
  }
  const wrongCategory = fixture();
  wrongCategory.tables.items.find((row) => row.id === 'branch-item').category_id = otherCategoryId;
  assert.equal((await wrongCategory.service.selectItem(categoryId, selected)).itemId, null, 'item category is rechecked after resolving the relation');
  for (const errorAt of ['category', 'place_catalog', 'places', 'item_places']) {
    const test = fixture(); test.state.errorAt = errorAt;
    await assert.rejects(test.service.selectItem(categoryId, selected), (error) => error === test.failure,
      `${errorAt} failure must not masquerade as a new store/item`);
  }
}

async function main() {
  const serviceModule = load('services/storeFirstService.ts', {
    '@/errors/appError': { AppError: Error }, '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
    '@/lib/supabase/client': { supabase: {} },
  });
  const { StoreFirstService } = serviceModule;
  const calls = [];
  let fail = false;
  const rows = Array.from({ length: 41 }, (_, i) => ({
    catalog_id: `store-${i}`, name: '카페인중독', branch_name: i === 0 ? '본점' : `지점${i}`,
    region_1: '서울특별시', region_2: '관악구', road_address: null, address: '상세 주소',
    provider_category: null, map_url: 'https://naver.me/example',
  }));
  const service = new StoreFirstService({ rpc: (name, args) => {
    calls.push({ name, args });
    const start = args.p_cursor === null ? 0 : Number(args.p_cursor.slice(7));
    const next = start + 20 < rows.length ? `opaque-${start + 20}` : null;
    const response = Promise.resolve(fail ? { error: new Error('offline') } : {
      data: rows.slice(start, start + 20).map((row) => ({ ...row, next_cursor: next })), error: null,
    });
    response.abortSignal = (signal) => { calls.at(-1).signal = signal; return response; };
    return response;
  } });
  let options, settled = '카페인중독';
  const hook = load('hooks/useStoreFirst.ts', {
    '@tanstack/react-query': { useInfiniteQuery: (value) => { options = value; return { data: { pages: [{ items: ['old'] }] } }; } },
    react: { useState: () => [settled, (value) => { settled = value; }], useEffect: (fn) => fn() },
    '@/services': {}, '@/services/storeFirstService': { storeFirstService: service },
  }, { setTimeout: () => 1, clearTimeout() {} });
  const use = (value, enabled = true) => hook.useStoreSearch('offline', value, enabled);
  assert.equal(use('다른 매장').data, undefined, 'old rows disappear during debounce');
  assert.equal(options.enabled, false);
  assert.equal(use('').data, undefined, 'clear hides old rows');
  assert.equal(use(settled, false).data, undefined, 'inactive screen does not expose results');
  hook.useStoreSearch('online', settled, true);
  assert.equal(Object.hasOwn(options, 'retry'), false, 'online search retains the shared retry policy');
  use(settled);
  assert.equal(options.retry, false, 'offline pagination leaves retries to the visible recovery action');
  assert.equal(options.initialPageParam, null);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const observer = new InfiniteQueryObserver(client, options);
  await observer.refetch();
  let result = observer.getCurrentResult();
  assert.equal(result.data.pages[0].items.length, 20);
  assert.equal(result.hasNextPage, true);
  assert.equal(calls[0].name, 'search_store_catalog_page');
  assert.equal(calls[0].args.p_limit, 20);
  assert.equal(calls[0].args.p_cursor, null);
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.equal(result.data.pages[0].items[0].region, '서울특별시 관악구');
  assert.equal(result.data.pages[0].items[0].mapUrl, rows[0].map_url);
  fail = true;
  await observer.fetchNextPage({ cancelRefetch: false });
  result = observer.getCurrentResult();
  assert.equal(result.isFetchNextPageError, true);
  assert.equal(result.data.pages.length, 1, 'failed append preserves visible page');
  fail = false;
  await observer.fetchNextPage({ cancelRefetch: false });
  assert.equal(calls.at(-1).args.p_cursor, 'opaque-20', 'retry uses the same opaque cursor');
  await observer.fetchNextPage({ cancelRefetch: false });
  result = observer.getCurrentResult();
  assert.deepEqual(result.data.pages.map((page) => page.items.length), [20, 20, 1]);
  assert.deepEqual(result.data.pages.flatMap((page) => page.items.map((item) => item.catalogId)), rows.map((row) => row.catalog_id), 'retain server order without duplicates');
  assert.equal(result.hasNextPage, false);
  const count = calls.length;
  await observer.fetchNextPage({ cancelRefetch: false });
  assert.equal(calls.length, count, 'no request beyond terminal cursor');
  settled = '새 매장'; use(settled); observer.setOptions(options); await observer.refetch();
  assert.equal(calls.at(-1).args.p_cursor, null, 'changed search starts a fresh cursor');
  assert.equal(observer.getCurrentResult().data.pages.length, 1);
  observer.destroy(); client.clear();
  calls.length = 0;
  await screenPagination(service, serviceModule, calls, (value) => { fail = value; });
  await selectedStoreRegression(StoreFirstService);
  console.log('Store search pages passed: screen scroll 20/20/1, rapid-scroll deduplication, visible append recovery, cursor retry, terminal status, stale/disabled/provider guards, server order, and page-three item/photo/brand selection.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

