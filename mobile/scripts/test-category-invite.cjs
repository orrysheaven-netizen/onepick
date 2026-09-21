// A category invite link opens the existing Pick finder already scoped to that
// category, so the ask in a chat is "여기서 하나 눌러" rather than "가입해서 찾아서 골라".
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
  }).outputText, {
    exports, process: { env: {} },
    require: (name) => {
      if (name === '@/constants/onepick') return require('./design-tokens.cjs');
      if (name in imports) return imports[name];
      if (name === 'react/jsx-runtime') return require(name);
      assert.fail(name);
    },
  });
  return exports;
}

// --- The link itself -------------------------------------------------------

function loadLinks(platform, base, browser) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/share/shareLinks.ts'), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    {
      exports, process: { env: { EXPO_PUBLIC_SHARE_BASE_URL: base } },
      ...(browser ? { window: browser } : {}),
      require: (name) => { assert.equal(name, 'react-native'); return { Platform: { OS: platform } }; },
    },
  );
  return exports;
}

const browser = { location: { origin: 'https://onepick.example' } };
const web = loadLinks('web', '', browser);
assert.equal(web.createCategoryInviteUrl('ramen'), 'https://onepick.example/pick/find?category=ramen');
assert.equal(web.createCategoryInviteUrl('  RAMEN  '), 'https://onepick.example/pick/find?category=ramen',
  'A slug pasted from anywhere still resolves');
assert.equal(web.createCategoryInviteUrl('a/b?c'), 'https://onepick.example/pick/find?category=a%2Fb%3Fc');
assert.equal(loadLinks('ios', undefined, browser).createCategoryInviteUrl('ramen'), 'onepick://pick/find?category=ramen');
assert.equal(loadLinks('android', ' https://onepick.example/// ', browser).createCategoryInviteUrl('snack'),
  'https://onepick.example/pick/find?category=snack');

// --- The screen it opens ---------------------------------------------------

let state = [], stateIndex = 0, refIndex = 0, refs = [], params = {}, presses = [], inputs = [];
let itemSearchArgs;
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
const categories = [
  { id: 'ramen-id', slug: 'ramen', label: '먹을 것 › 라면' },
  { id: 'movie-id', slug: 'movie', label: '콘텐츠 › 영화' },
];
const { default: Find } = load('app/pick/find.tsx', {
  react: fakeReact,
  'expo-router': {
    useLocalSearchParams: () => params,
    useFocusEffect: (effect) => { effect(); },
    useRouter: () => ({ canGoBack: () => true, back() {}, push() {}, replace() {} }),
  },
  'react-native': native,
  'react-native-safe-area-context': { SafeAreaView: component('section') },
  '@/errors/appError': load('errors/appError.ts'),
  '@/components/pick-photo': { PickPhoto: () => null },
  '@/components/ui': require('./ui-components.cjs').loadUi({
    'react-native': native, '@/components/pick-photo': { PickPhoto: () => null },
  }),
  '@/components/music-search-link': { MusicSearchLink: () => null },
  '@/components/game-search-link': { GameSearchLink: () => null },
  '@/components/youtube-search-link': { YoutubeSearchLink: () => null },
  '@/hooks/useAuthSession': { useAuthSession: () => ({ user: null }) },
  '@/hooks/useItemSearch': {
    useItemSearch: (...args) => {
      itemSearchArgs = args;
      return { data: [], isWaiting: false, isFetching: false, isError: false };
    },
  },
  '@/hooks/useMovieCatalog': {
    useMovieCatalogSearch: () => ({ data: [], isWaiting: false, isFetching: false, isError: false }),
    useImportMovieCatalogItem: () => ({ isPending: false, isError: false, mutateAsync: async () => ({}) }),
  },
  '@/hooks/useRegisterPick': {
    useRegistrationCategories: () => ({ data: categories, isPending: false, isError: false, refetch() {} }),
  },
});
const render = () => {
  stateIndex = 0; refIndex = 0; presses = []; inputs = [];
  return renderToStaticMarkup(React.createElement(Find));
};

params = { category: 'ramen' };
let page = render();
assert.match(page, /먹을 것 › 라면 안에서 찾는 중/, 'An invite link lands already scoped to its category');
assert.equal(itemSearchArgs[1], 'ramen-id', 'The slug resolves to the category the search is scoped to');
assert.equal(inputs[0].editable, true, 'A guest who followed the link can search straight away');
assert.doesNotMatch(page, /카테고리는 비워두고/, 'A scoped invite is not the category-free registration flow');

params = { category: '  RAMEN  ' };
page = render();
assert.match(page, /먹을 것 › 라면 안에서 찾는 중/, 'Case and padding survive a pasted link');
assert.equal(itemSearchArgs[1], 'ramen-id');

params = { category: 'no-such-category' };
page = render();
assert.match(page, /링크의 카테고리를 찾지 못했어요/, 'A stale invite says so instead of silently searching nothing');
assert.equal(itemSearchArgs[1], undefined, 'An unresolved scope never widens into a full-catalog search');
assert.equal(inputs[0].editable, false);

params = { categoryId: 'movie-id' };
page = render();
assert.match(page, /콘텐츠 › 영화 안에서 찾는 중/, 'The existing id-scoped entry still works');
assert.doesNotMatch(page, /링크의 카테고리를 찾지 못했어요/);

params = {};
page = render();
assert.match(page, /카테고리는 비워두고 상품 등록만 진행합니다/, 'The unscoped finder is unchanged');
assert.doesNotMatch(page, /링크의 카테고리를 찾지 못했어요/);
assert.equal(itemSearchArgs[1], undefined);

console.log('Category invite checks passed: slug link format, scoped landing, stale link notice and unchanged existing entries.');
