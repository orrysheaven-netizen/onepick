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
    if (name in imports) return imports[name];
    if (name === 'react/jsx-runtime') return require(name);
    assert.fail(name);
  } });
  return exports;
}

const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';
let state = [], stateIndex = 0, refIndex = 0, refs = [], params = {}, destination, presses = [], inputs = [];
let itemSearchArgs, movieSearchArgs;
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
const categories = [
  { id: 'ramen', slug: 'ramen', label: '먹을 것 › 라면' },
  { id: 'movie', slug: 'movie', label: '콘텐츠 › 영화' },
];
const imports = {
  react: fakeReact,
  'expo-router': {
    useLocalSearchParams: () => params,
    useRouter: () => ({
      canGoBack: () => true, back() {},
      push: (route) => { destination = route; },
      replace: (route) => { destination = route; },
    }),
  },
  'react-native': native,
  'react-native-safe-area-context': { SafeAreaView: component('section') },
  '@/components/pick-photo': { PickPhoto: () => null },
  '@/hooks/useAuthSession': { useAuthSession: () => ({ user: null }) },
  '@/hooks/useItemSearch': { useItemSearch: (...args) => { itemSearchArgs = args; return { data: [], isWaiting: false, isFetching: false, isError: false }; } },
  '@/hooks/useMovieCatalog': {
    useMovieCatalogSearch: (...args) => {
      movieSearchArgs = args;
      return { data: args[1] && args[0] ? [movie] : [], isWaiting: false, isFetching: false, isError: false };
    },
    useImportMovieCatalogItem: () => ({ isPending: false, isError: false, mutateAsync: async () => ({}) }),
  },
  '@/hooks/useRegisterPick': { useRegistrationCategories: () => ({ data: categories, isPending: false, isError: false, refetch() {} }) },
};
const { default: Find } = load('app/pick/find.tsx', imports);
const render = () => {
  stateIndex = 0; refIndex = 0; presses = []; inputs = [];
  return renderToStaticMarkup(React.createElement(Find));
};

let page = render();
assert.match(page, /먼저 카테고리를 선택해주세요/);
assert.equal(itemSearchArgs[0], '', 'Generic registration must not run an unscoped item search');
assert.equal(inputs[0].editable, false);
const movieCategoryButton = presses.find((button) => button.accessibilityLabel === '콘텐츠 › 영화 카테고리 선택');
assert.ok(movieCategoryButton);
movieCategoryButton.onPress();
assert.equal(destination.params.categoryId, 'movie');

params = { categoryId: 'movie' };
page = render();
const movieInput = inputs.find((input) => input.accessibilityLabel === '원픽 영화 검색');
assert.ok(movieInput);
assert.equal(movieInput.editable, true);
movieInput.onChangeText('인터스텔라');
page = render();
assert.deepEqual(movieSearchArgs, ['인터스텔라', true]);
assert.match(page, /인터스텔라/);
assert.match(page, /Interstellar/);

state = []; refs = []; params = { categoryId: 'movie', query: '인터스텔라' };
page = render();
assert.match(page, /인터스텔라/);
assert.equal(itemSearchArgs[0], '인터스텔라', 'Global search query is carried into the movie catalog screen');

console.log('Find screen checks passed: category-first search, movie catalog activation and global-query handoff.');
