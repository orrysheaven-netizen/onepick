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
assert.deepEqual(Array.from(channels.PICK_CHANNEL_OPTIONS, (option) => option.label), ['매장', '온라인']);
assert.match(channels.PICK_CHANNEL_OPTIONS[0].description, /배달/, '매장 explicitly includes delivery');
assert.equal(channels.parsePickChannel('online'), 'online');
assert.equal(channels.parsePickChannel('delivery'), 'offline', 'Unknown route values fall back to 매장');
assert.equal(channels.parsePickChannel(undefined), 'offline');
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
const ui = require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } });
const { default: Find } = load('app/pick/find.tsx', {
  react: fakeReact,
  'expo-router': {
    useLocalSearchParams: () => params,
    useFocusEffect: (effect) => { effect(); },
    useRouter: () => ({ canGoBack: () => true, back() {}, push: (route) => { destination = route; }, replace: (route) => { destination = route; } }),
  },
  'react-native': native,
  'react-native-safe-area-context': { SafeAreaView: component('section') },
  '@/errors/appError': load('errors/appError.ts'),
  '@/lib/home/homeChannels': load('lib/home/homeChannels.ts'),
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
});
const render = () => { stateIndex = 0; refIndex = 0; presses = []; inputs = []; return renderToStaticMarkup(React.createElement(Find)); };
const press = (label) => { const button = presses.find((p) => p.accessibilityLabel === label || textOf(p.children) === label); assert.ok(button, label); button.onPress(); };
const storeChip = () => presses.find((p) => String(p.accessibilityLabel).startsWith('매장:'));
const onlineChip = () => presses.find((p) => String(p.accessibilityLabel).startsWith('온라인:'));

params = { categoryId: 'dogani', query: '곰탕' };
let page = render();
assert.match(page, /어디서 주문했나요/);
assert.equal(storeChip().accessibilityState?.selected, true, 'Restaurant registration starts on 매장');
assert.equal(placeSearchArgs[2], true, '매장 searches the place catalog');
assert.match(page, /○○곰탕 본점/); assert.doesNotMatch(page, /온라인몰|예전 도가니탕/, '매장 lists only place-backed items');
assert.match(page, /배달앱 주문은 매장으로/);

onlineChip().onPress();
page = render();
assert.equal(onlineChip().accessibilityState?.selected, true);
assert.equal(placeSearchArgs[2], false, '온라인 never queries the place catalog');
assert.ok(inputs.find((input) => input.accessibilityLabel === '원픽 온라인 판매처 검색'));
assert.match(page, /○○곰탕 온라인몰/); assert.match(page, /이 판매처를 원픽으로 선택/);
assert.doesNotMatch(page, /본점|예전 도가니탕/, '온라인 lists only online-provider items');
press('○○곰탕 온라인몰 원픽 선택');
assert.equal(destination.pathname, '/pick/choose'); assert.equal(destination.params.itemId, 'online-item');

state = []; refs = []; destination = undefined; searchResults = [];
params = { categoryId: 'dogani', query: '없는 판매처', channel: 'online' };
page = render();
assert.equal(onlineChip().accessibilityState?.selected, true, 'A channel=online route opens the online flow');
assert.match(page, /등록된 온라인 판매처가 없어요/);
assert.doesNotMatch(page, /일치하는 장소를 찾지 못했어요/);
press('온라인 판매처 등록 요청');
assert.equal(destination.pathname, '/pick/request');
assert.deepEqual({ ...destination.params }, { itemName: '없는 판매처', categoryId: 'dogani', channel: 'online' });

state = []; refs = []; destination = undefined;
params = { categoryId: 'dogani', query: '없는 가게' };
page = render();
assert.match(page, /일치하는 장소를 찾지 못했어요/, '매장 still requires a verified place');
assert.equal(presses.find((p) => textOf(p.children) === '온라인 판매처 등록 요청'), undefined);

console.log('Pick channel choice checks passed: delivery-as-store rule, DB host parity, 매장/온라인 search scopes, online selection and seller request handoff.');
