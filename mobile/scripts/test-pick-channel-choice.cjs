const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, require: (name) => {
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name in imports) return imports[name];
    if (name === 'react/jsx-runtime') return require(name);
    assert.fail(`Unexpected import: ${name}`);
  } });
  return exports;
}

// --- Channel rules -----------------------------------------------------------
const channels = load('lib/items/pickChannel.ts');
const constants = require('./design-tokens.cjs');
assert.equal(constants.OnePickFeatures.foodChannelPicker, false, 'Initial MVP hides future food channel choices');
assert.deepEqual(Array.from(channels.PICK_CHANNEL_OPTIONS, (option) => option.label), ['매장', '온라인', '레시피']);
assert.equal(channels.parsePickChannel('recipe'), 'offline', 'Search state never becomes recipe; the recipe chip opens the link flow instead');
const findScreen = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/app/pick/find.tsx'), 'utf8');
assert.match(findScreen, /if \(option\.channel === 'recipe'\) \{ openRecipe\(\); return; \}/, 'the 레시피 chip opens the recipe link flow');
assert.match(findScreen, /pathname: '\/pick\/recipe', params: \{\s+\.\.\.\(selectedCategory \? \{ categoryId: selectedCategory\.id \} : \{\}\)/, 'with the chosen menu as the dish');
assert.match(channels.PICK_CHANNEL_OPTIONS[0].description, /배달/, '매장 explicitly includes delivery');
assert.equal(channels.parsePickChannel('online'), 'online');
assert.equal(channels.parsePickChannel('delivery'), 'offline', 'Unknown route values fall back to 매장');
assert.equal(channels.parsePickChannel(undefined), 'offline');
const recipeScreen = fs.readFileSync(path.join(__dirname, '../src/app/pick/recipe.tsx'), 'utf8');
assert.match(recipeScreen, /!OnePickFeatures\.foodChannelPicker/);
const requestScreen = fs.readFileSync(path.join(__dirname, '../src/app/pick/request.tsx'), 'utf8');
assert.match(requestScreen, /!OnePickFeatures\.foodChannelPicker && params\.channel === 'online'/);
for (const url of ['https://s.baemin.com/store/1', 'https://baemin.com', 'https://web.coupangeats.com/shop/1', 'https://www.yogiyo.co.kr/x', 'https://ddangyo.com/y', 'https://S.BAEMIN.COM./z']) {
  assert.equal(channels.isDeliveryAppUrl(url), true, `${url} is a delivery app`);
}
for (const url of ['https://smartstore.naver.com/shop', 'https://notbaemin.com', 'https://baemin.com.example.com', 'not a url']) {
  assert.equal(channels.isDeliveryAppUrl(url), false, `${url} is not a delivery app`);
}
const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260926130000_block_delivery_apps_as_online_stores.sql'), 'utf8');
for (const host of channels.DELIVERY_APP_HOSTS) {
  assert.ok(migration.includes(host.replace(/\./g, '\\.')), `DB guard lists ${host} like the app does`);
}

// --- Find screen -------------------------------------------------------------
const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';
let state = [], stateIndex = 0, refIndex = 0, refs = [], params = {}, destination, presses = [], inputs = [];
let placeSearchArgs;
const fakeReact = {
  ...React,
  useEffect: (effect) => { effect(); },
  useCallback: (fn) => fn,
  useRef: (initial) => { const slot = refIndex++; if (!(slot in refs)) refs[slot] = { current: initial }; return refs[slot]; },
  useState: (initial) => {
    const slot = stateIndex++;
    if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
    return [state[slot], (value) => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }];
  },
};
const component = (tag) => ({ children }) => React.createElement(tag, null, children);
const native = {
  ActivityIndicator: () => null,
  Pressable: (props) => { presses.push(props); return React.createElement('button', null, props.children); },
  ScrollView: component('main'),
  StyleSheet: { create: (styles) => styles },
  Text: component('span'),
  TextInput: (props) => { inputs.push(props); return null; },
  View: component('div'),
};
const categories = [{ id: 'dogani', slug: 'doganitang', name: '도가니탕', label: '먹을것 › 국/탕 › 도가니탕' }];
const items = [
  { id: 'store-item', categoryId: 'dogani', name: '○○곰탕 본점', externalSource: 'onepick_place', status: 'active' },
  { id: 'online-item', categoryId: 'dogani', name: '○○곰탕 온라인몰', externalSource: 'onepick_provider', status: 'active' },
  { id: 'legacy-item', categoryId: 'dogani', name: '예전 도가니탕', externalSource: null, status: 'active' },
];
let searchResults = items;
const tree = [
  { id: 'food', parentId: null, name: '먹을것', slug: 'food', status: 'open', isVisible: true, isPickable: false, sortOrder: 10 },
  { id: 'soups', parentId: 'food', name: '국/탕', slug: 'food-soups-rice', status: 'open', isVisible: true, isPickable: false, sortOrder: 1 },
  { id: 'noodles', parentId: 'food', name: '면', slug: 'food-noodles', status: 'open', isVisible: true, isPickable: false, sortOrder: 2 },
  { id: 'gukbap', parentId: 'soups', name: '돼지국밥', slug: 'pork-gukbap', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
  { id: 'dogani', parentId: 'soups', name: '도가니탕', slug: 'doganitang', status: 'open', isVisible: true, isPickable: true, sortOrder: 22 },
  { id: 'naengmyeon', parentId: 'noodles', name: '평양냉면', slug: 'pyeongyang-naengmyeon', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
  { id: 'culture', parentId: null, name: '문화', slug: 'culture', status: 'open', isVisible: true, isPickable: false, sortOrder: 20 },
  { id: 'movie', parentId: 'culture', name: '영화', slug: 'movie', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
];
const categoryTree = load('lib/categories/categoryTree.ts');
const ui = require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } });
const { default: Find } = load('app/pick/find.tsx', { '@/lib/navigation/swipeBack': { useSwipeBackHandler() {} },
  react: fakeReact,
  'expo-router': {
    useLocalSearchParams: () => params,
    useFocusEffect: (effect) => { effect(); },
    useRouter: () => ({ canGoBack: () => true, back() {}, push: (route) => { destination = route; }, replace: (route) => { destination = route; } }),
  },
  'react-native': native,
  'react-native-safe-area-context': { SafeAreaView: component('section') },
  '@/errors/appError': load('errors/appError.ts'),
  '@/lib/profile/profilePickGroups': { splitLabPicks: (picks) => ({ main: picks, lab: [] }), isLabCategory: () => false }, '@/components/profile-lab-entry': { ProfileLabEntry: () => null }, '@/lib/home/homeChannels': load('lib/home/homeChannels.ts'), '@/lib/categories/registrationRoute': load('lib/categories/registrationRoute.ts'),
  '@/components/pick-photo': { PickPhoto: () => null },
  '@/components/ui': ui,
  '@/components/music-search-link': { MusicSearchLink: () => null },
  '@/components/game-search-link': { GameSearchLink: () => null },
  '@/components/youtube-search-link': { YoutubeSearchLink: () => null },
  '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: 'owner' }, isLoading: false, error: null }) },
  '@/hooks/useItemSearch': { useItemSearch: (query) => ({ data: query ? searchResults : [], isWaiting: false, isFetching: false, isError: false }) },
  '@/hooks/useMovieCatalog': {
    useMovieCatalogSearch: () => ({ data: [], isWaiting: false, isFetching: false, isError: false }),
    useImportMovieCatalogItem: () => ({ isPending: false, isError: false, mutateAsync: async () => ({}) }),
  },
  '@/hooks/usePlaceCatalog': {
    usePlaceCatalogCapability: () => ({ data: true, isSuccess: true, isError: false, isFetching: false, refetch() {} }),
    usePlaceCatalogSearch: (...args) => { placeSearchArgs = args; return { data: [], isWaiting: false, isFetching: false, isError: false, refetch() {} }; },
    useSelectPlaceCatalogItem: () => ({ isPending: false, isError: false, mutateAsync: async () => { throw new Error('Unexpected place selection'); } }),
  },
  '@/hooks/useRegisterPick': { useRegistrationCategories: () => ({ data: categories, isPending: false, isError: false, refetch() {} }) },
  '@/lib/items/pickChannel': channels,
  '@/hooks/useExploreData': { useExploreCategories: () => ({ data: tree, isPending: false, isError: false, isFetching: false, refetch() {} }) },
  '@/lib/home/homeCategoryFilters': load('lib/home/homeCategoryFilters.ts', { '@/lib/categories/categoryTree': categoryTree }),
});
const render = () => { stateIndex = 0; refIndex = 0; presses = []; inputs = []; return renderToStaticMarkup(React.createElement(Find)); };
const press = (label) => { const button = presses.find((p) => p.accessibilityLabel === label || textOf(p.children) === label); assert.ok(button, label); button.onPress(); };
const storeChip = () => presses.find((p) => String(p.accessibilityLabel).startsWith('매장:'));
const onlineChip = () => presses.find((p) => String(p.accessibilityLabel).startsWith('온라인:'));

// Initial public MVP: food is pinned to 매장 even if a crafted route asks for online.
params = { categoryId: 'dogani', query: '곰탕', channel: 'online' };
let page = render();
assert.doesNotMatch(page, /어디서 주문했나요|온라인:/, 'Public MVP exposes no food channel picker');
assert.equal(onlineChip(), undefined);
assert.equal(placeSearchArgs[2], true, 'Crafted channel=online still uses the public 매장 search');
assert.match(page, /○○곰탕 본점/);
assert.doesNotMatch(page, /○○곰탕 온라인몰/);

state = []; refs = []; destination = undefined; params = {};
page = render();
assert.doesNotMatch(page, /레시피가 원픽인가요|YouTube 링크로 레시피 등록|매장이나 온라인/,
  'Menu-first public entry exposes only the store continuation');

// Future rollout remains implemented behind the centralized feature gate.
constants.OnePickFeatures.foodChannelPicker = true;
state = []; refs = []; destination = undefined;
params = { categoryId: 'dogani', query: '곰탕' };
page = render();
assert.match(page, /어디서 주문했나요/);
assert.equal(storeChip().accessibilityState?.selected, true, 'Restaurant registration starts on 매장');
assert.equal(placeSearchArgs[2], true, '매장 searches the place catalog');
assert.match(page, /○○곰탕 본점/); assert.doesNotMatch(page, /온라인몰|예전 도가니탕/, '매장 lists only place-backed items');
assert.match(page, /배달앱 주문은 매장으로/);
assert.match(page, /매장 등록은 현재 서울·경기·인천 음식점만 가능해요/, '매장 search states which regions are covered');
assert.equal(channels.PLACE_COVERAGE_NOTICE, '매장 등록은 현재 서울·경기·인천 음식점만 가능해요.');

onlineChip().onPress();
page = render();
assert.equal(onlineChip().accessibilityState?.selected, true);
assert.equal(placeSearchArgs[2], false, '온라인 never queries the place catalog');
assert.doesNotMatch(page, /음식점만 가능해요/, 'Online sellers are not limited by region');
assert.ok(inputs.find((input) => input.accessibilityLabel === '원픽 온라인 판매처 검색'));
assert.match(page, /○○곰탕 온라인몰/); assert.match(page, /이 판매처를 원픽으로 고르기/);
assert.doesNotMatch(page, /본점|예전 도가니탕/, '온라인 lists only online-provider items');
press('○○곰탕 온라인몰 원픽 선택');
assert.equal(destination.pathname, '/pick/choose'); assert.equal(destination.params.itemId, 'online-item');

state = []; refs = []; destination = undefined; searchResults = [];
params = { categoryId: 'dogani', query: '없는 판매처', channel: 'online' };
page = render();
assert.equal(onlineChip().accessibilityState?.selected, true, 'A channel=online route opens the online flow');
assert.match(page, /등록된 온라인 판매처가 없어요/);
assert.doesNotMatch(page, /아직 등록된 가게가 없어요/);
press('온라인 판매처 등록 요청');
assert.equal(destination.pathname, '/pick/request');
assert.deepEqual({ ...destination.params }, { itemName: '없는 판매처', categoryId: 'dogani', channel: 'online' });

state = []; refs = []; destination = undefined;
params = { categoryId: 'dogani', query: '없는 가게' };
page = render();
assert.match(page, /아직 등록된 가게가 없어요/, '매장 still requires a verified place');
assert.equal(presses.find((p) => textOf(p.children) === '온라인 판매처 등록 요청'), undefined);
press('가게 등록 요청하기');
assert.equal(destination.pathname, '/pick/request', 'An empty 매장 search can request the store instead of creating a name-only Pick');
assert.deepEqual({ ...destination.params }, { itemName: '없는 가게', categoryId: 'dogani' });

// --- 원픽 등록 without a category: menu first, then 매장/온라인 --------------------
state = []; refs = []; destination = undefined; params = {};
page = render();
assert.match(page, /어떤 메뉴의 원픽인가요/);
assert.match(page, /자주 찾는 메뉴/);
const suggestionLabels = presses.map((p) => p.accessibilityLabel).filter((label) => String(label).endsWith(' 메뉴 선택'));
assert.deepEqual(suggestionLabels.slice(0, 3), ['돼지국밥 메뉴 선택', '평양냉면 메뉴 선택', '도가니탕 메뉴 선택'], 'Curated restaurant menus come first');
assert.ok(presses.find((p) => p.accessibilityLabel === '평양냉면 메뉴 선택'));
assert.equal(presses.find((p) => p.accessibilityLabel === '영화 메뉴 선택'), undefined, 'Non-food categories are not offered');
assert.equal(presses.find((p) => String(p.accessibilityLabel).startsWith('매장:')), undefined, 'Channel choice waits for a menu');
inputs.find((input) => input.accessibilityLabel === '메뉴 검색').onChangeText('도가 니');
page = render();
assert.match(page, /검색한 메뉴/);
press('도가니탕 메뉴 선택');
assert.equal(destination.pathname, '/pick/find');
assert.equal(destination.params.categoryId, 'dogani', 'Choosing a menu opens its 매장/온라인 search');

state = []; refs = []; destination = undefined; params = {};
render();
inputs.find((input) => input.accessibilityLabel === '메뉴 검색').onChangeText('영화');
page = render();
assert.match(page, /영화(&#x27;|')? 메뉴를 찾지 못했어요/, 'Search only covers food menus');
press('이 이름으로 등록 요청');
assert.equal(destination.pathname, '/pick/request'); assert.equal(destination.params.itemName, '영화');

// --- 링크로 원픽 찾기: delivery links are 매장, never analyzed as online -----------
let linkPresses = [], linkInputs = [], linkCalls = 0;
const linkState = [];
let linkIndex = 0;
const linkReact = { ...React, useState: (initial) => { const slot = linkIndex++; if (!(slot in linkState)) linkState[slot] = typeof initial === 'function' ? initial() : initial; return [linkState[slot], (v) => { linkState[slot] = typeof v === 'function' ? v(linkState[slot]) : v; }]; }, useMemo: (fn) => fn() };
const linkNative = { ...native, Pressable: (props) => { linkPresses.push(props); return React.createElement('button', null, props.children); }, TextInput: (props) => { linkInputs.push(props); return null; } };
const { default: Link } = load('app/pick/link.tsx', {
  react: linkReact,
  'react-native': linkNative,
  'react-native-safe-area-context': { SafeAreaView: component('section') },
  'expo-router': { useLocalSearchParams: () => ({}), useRouter: () => ({ push: (route) => { destination = route; }, back() {} }) },
  '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': linkNative, '@/components/pick-photo': { PickPhoto: () => null } }),
  '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: 'owner' }, isLoading: false, error: null }) },
  '@/hooks/useLinkCategorySuggestions': { useLinkCategorySuggestions: () => ({ data: undefined, isPending: false, isError: false, reset() {}, mutateAsync: async () => { linkCalls++; return { places: [], suggestions: [], categories: [] }; } }) },
  '@/lib/items/pickChannel': channels,
});
const renderLink = () => { linkIndex = 0; linkPresses = []; linkInputs = []; return renderToStaticMarkup(React.createElement(Link)); };
renderLink();
linkInputs.find((input) => input.accessibilityLabel === '원픽 링크').onChangeText('https://s.baemin.com/store/123');
const linkPage = renderLink();
assert.match(linkPage, /배달앱 링크는 매장 원픽이에요/, 'Delivery links explain the 매장 rule');
const analyzeButton = linkPresses.find((p) => textOf(p.children) === '링크 확인하고 추천받기');
assert.equal(analyzeButton.disabled, true, 'Delivery links are not analyzed as online links');
linkPresses.find((p) => textOf(p.children) === '메뉴 고르고 매장 찾기').onPress();
assert.equal(destination, '/pick/find', 'The guidance leads to the menu → 매장 flow');
assert.equal(linkCalls, 0);

console.log('Pick channel choice checks passed: MVP store-only gate plus preserved future 매장/온라인/레시피 flows and delivery guidance.');
