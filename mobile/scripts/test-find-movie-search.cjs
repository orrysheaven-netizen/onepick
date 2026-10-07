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
  }).outputText, { exports, require: (name) => {
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name === '@/lib/items/pickChannel') return load('lib/items/pickChannel.ts');
    if (name === '@/lib/home/homeCategoryFilters') return load('lib/home/homeCategoryFilters.ts', { '@/lib/categories/categoryTree': load('lib/categories/categoryTree.ts') });
    if (name === '@/hooks/useExploreData' && !(name in imports)) return { useExploreCategories: () => ({ data: [], isPending: false, isError: false, isFetching: false, refetch() {} }) };
    if (name in imports) return imports[name];
    if (name === 'react/jsx-runtime') return require(name);
    assert.fail(name);
  } });
  return exports;
}

const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';
let state = [], stateIndex = 0, refIndex = 0, refs = [], params = {}, destination, presses = [], inputs = [];
let itemSearchArgs, movieSearchArgs, mutationMediaType;
const fakeReact = {
  ...React,
  useEffect: (effect) => { effect(); },
  useRef: (initial) => {
    const slot = refIndex++;
    if (!(slot in refs)) refs[slot] = { current: initial };
    return refs[slot];
  },
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
const movie = {
  source: 'tmdb', externalId: '157336', title: '인터스텔라', originalTitle: 'Interstellar',
  releaseYear: 2014, posterUrl: null, existingItemId: null,
};
const drama = { ...movie, source: 'tmdb_tv', externalId: '101', title: '테스트 드라마', originalTitle: 'Test Series', releaseYear: 2020 };
const categories = [
  { id: 'ramen', slug: 'ramen', label: '먹을 것 › 라면' },
  { id: 'movie', slug: 'movie', label: '콘텐츠 › 영화' },
  { id: 'drama', slug: 'drama', label: '콘텐츠 › 드라마' },
];
const imports = {
  react: fakeReact,
  'expo-router': {
    useLocalSearchParams: () => params,
    useFocusEffect: (effect) => { effect(); },
    useRouter: () => ({
      canGoBack: () => true, back() {},
      push: (route) => { destination = route; },
      replace: (route) => { destination = route; },
    }),
  },
  'react-native': native,
  'react-native-safe-area-context': { SafeAreaView: component('section') },
  '@/errors/appError': load('errors/appError.ts'),
  '@/lib/profile/profilePickGroups': { splitLabPicks: (picks) => ({ main: picks, lab: [] }), isLabCategory: () => false }, '@/components/profile-lab-entry': { ProfileLabEntry: () => null }, '@/lib/home/homeChannels': load('lib/home/homeChannels.ts'), '@/lib/categories/registrationRoute': load('lib/categories/registrationRoute.ts'),
  '@/components/pick-photo': { PickPhoto: () => null },
  '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } }),
  '@/components/music-search-link': { MusicSearchLink: () => null },
  '@/components/game-search-link': { GameSearchLink: () => null },
  '@/components/youtube-search-link': { YoutubeSearchLink: () => null },
  '@/hooks/useAuthSession': { useAuthSession: () => ({ user: null }) },
  '@/hooks/useItemSearch': { useItemSearch: (...args) => { itemSearchArgs = args; return { data: [], isWaiting: false, isFetching: false, isError: false }; } },
  '@/hooks/useMovieCatalog': {
    useMovieCatalogSearch: (...args) => {
      movieSearchArgs = args;
      return { data: args[1] && args[0] ? [args[2] === 'tv' ? drama : movie] : [], isWaiting: false, isFetching: false, isError: false };
    },
    useImportMovieCatalogItem: (mediaType) => { mutationMediaType = mediaType; return { isPending: false, isError: false, mutateAsync: async () => ({}) }; },
  },
  '@/hooks/usePlaceCatalog': {
    usePlaceCatalogCapability: () => ({ data: false, isSuccess: true, isError: false, isFetching: false, refetch() {} }),
    usePlaceCatalogSearch: () => ({ data: [], isWaiting: false, isFetching: false, isError: false, refetch() {} }),
    useSelectPlaceCatalogItem: () => ({ isPending: false, isError: false, mutateAsync: async () => { throw new Error('Unexpected place selection'); } }),
  },
  '@/hooks/useRegisterPick': { useRegistrationCategories: () => ({ data: categories, isPending: false, isError: false, refetch() {} }) },
};
const { default: Find } = load('app/pick/find.tsx', { ...imports, '@/lib/navigation/swipeBack': { useSwipeBackHandler() {} } });
const render = () => {
  stateIndex = 0; refIndex = 0; presses = []; inputs = [];
  return renderToStaticMarkup(React.createElement(Find));
};

let page = render();
assert.match(page, /어떤 메뉴의 원픽인가요/, 'MVP registration without a category starts from a menu');
assert.ok(inputs.find((input) => input.accessibilityLabel === '메뉴 검색'));
assert.doesNotMatch(page, /카테고리 선택 없이 이름만 검색하고 등록합니다/, 'The category-free search is replaced by the menu picker');
assert.equal(itemSearchArgs[0], '', 'The menu picker never runs the product search');

params = { categoryId: 'movie' };
page = render();
const movieInput = inputs.find((input) => input.accessibilityLabel === '원픽 영화 검색');
assert.ok(movieInput);
assert.equal(movieInput.editable, true);
movieInput.onChangeText('인터스텔라');
page = render();
assert.deepEqual(movieSearchArgs, ['인터스텔라', true, 'movie'], 'The existing movie branch keeps its explicit media scope');
assert.equal(mutationMediaType, 'movie');
assert.match(page, /인터스텔라/);
assert.match(page, /Interstellar/);

state = []; refs = []; params = { categoryId: 'movie', query: '인터스텔라' };
page = render();
assert.match(page, /인터스텔라/);
assert.equal(itemSearchArgs[0], '인터스텔라', 'Global search query is carried into the movie catalog screen');

state = []; refs = []; params = { categoryId: 'drama', query: '테스트' };
page = render();
assert.deepEqual(movieSearchArgs, ['테스트', true, 'tv'], 'Drama queries use TV rather than movie IDs');
assert.equal(mutationMediaType, 'tv');
assert.equal(itemSearchArgs[1], 'drama');
assert.match(page, /테스트 드라마/); assert.match(page, /2020/); assert.doesNotMatch(page, /Interstellar/);
assert.ok(inputs.find((input) => input.accessibilityLabel === '원픽 드라마 검색'));
presses.find((button) => button.accessibilityLabel === '테스트 드라마 드라마 선택').onPress();
assert.equal(destination.params.action, 'choose_drama'); assert.equal(destination.params.externalId, '101');

state = []; refs = []; params = { categoryId: 'ramen', query: '라면' };
render(); assert.equal(movieSearchArgs[1], false, 'Ordinary products do not activate either external media search');
console.log('Find screen checks passed: category-free product search, legacy scoped movie/TV routes and query/login handoff.');