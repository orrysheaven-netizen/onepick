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
let presses = [], destination, sessionRetries = 0, queryRetries = 0, width = 1200, pullToRefresh;
const component = (tag) => ({ children }) => React.createElement(tag, null, children);
const auth = { user: { id: 'owner' }, isLoading: false, error: null, retry: () => sessionRetries++ };
const own = { pick: { id: 'mine', itemId: 'ramen', oneLineReview: '내 실제 선택 이유', status: 'active' }, item: { name: '신라면' }, category: { name: '라면' }, profile: { username: 'owner' } };
const other = { ...own, pick: { ...own.pick, id: 'other', oneLineReview: '다른 사람의 이유' }, item: { name: '진라면' }, profile: { username: 'friend' } };
const query = { isPending: false, isError: false, isFetching: false, isRefetching: false,
  refetch: (options) => { assert.equal(options.cancelRefetch, false); queryRetries++; }, data: {
  mode: 'multi_category', currentPicks: [own], feed: [other], categoriesToPick: [{ category: { id: 'snacks', name: '과자' } }], openCategories: [{ id: 'ramen', name: '라면' }], singleCategoryItems: [],
} };
const { default: Home } = load('app/(tabs)/index.tsx', {
  'expo-router': { useRouter: () => ({ push: (route) => { destination = route; } }) },
  'react-native': {
    Text: component('span'), View: component('div'), ActivityIndicator: () => null, RefreshControl: () => null,
    ScrollView: (props) => { pullToRefresh = props.refreshControl; return React.createElement('main', null, props.children); },
    Pressable: (props) => { presses.push(props); return React.createElement('button', null, props.children); },
    StyleSheet: { create: (styles) => styles }, Platform: { OS: 'web' }, useWindowDimensions: () => ({ width }),
  },
  'react-native-safe-area-context': { SafeAreaView: component('section') },
  '@/components/onepick-brand': { OnePickBrand: () => null },
  '@/components/pick-photo': { PickPhoto: () => null },
  '@/constants/onepick': load('constants/onepick.ts'),
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useHomeData': { useHomeData: () => query },
});
const render = () => { presses = []; return renderToStaticMarkup(React.createElement(Home)); };
const refreshButton = () => presses.find((p) => p.accessibilityLabel === '홈 원픽 새로고침');
const press = (label) => {
  const button = presses.find((p) => p.accessibilityLabel === label || textOf(p.children) === label);
  assert.ok(button, label); button.onPress();
};

for (width of [390, 800, 1200]) {
  const page = render();
  assert.match(page, /내 실제 선택 이유/); assert.match(page, /다른 사람의 이유/); assert.match(page, /MY PICK/);
  press('신라면 원픽 상세 보기'); assert.equal(destination.params.pickId, 'mine');
  press('신라면 제품 상세 보기'); assert.equal(destination.params.itemId, 'ramen');
  press('진라면 원픽 상세 보기'); assert.equal(destination.params.pickId, 'other');
  press('과자 원픽 찾기'); assert.equal(destination.params.categoryId, 'snacks');
  press('＋ 원픽 등록'); assert.equal(destination.pathname, '/pick/find');
}

auth.user = null;
assert.doesNotMatch(render(), /내 실제 선택 이유|다른 사람의 이유|MY PICK/, 'Anonymous rendering never exposes cached personal cards');
press('라면 원픽 찾기'); assert.equal(destination.params.categoryId, 'ramen');
query.data.mode = 'single_category'; query.data.singleCategoryItems = [{ id: 'public', name: '공개 제품' }];
render(); press('공개 제품 제품 상세 보기'); assert.equal(destination.params.itemId, 'public');

auth.user = { id: 'owner' }; auth.error = new Error('offline');
assert.doesNotMatch(render(), /내 실제 선택 이유|다른 사람의 이유/);
assert.equal(pullToRefresh, undefined, 'Session errors must not refresh data for an unverified user');
press('다시 불러오기'); assert.equal(sessionRetries, 1);
auth.error = null; query.isError = true;
const stalePage = render();
assert.match(stalePage, /내 실제 선택 이유/); assert.match(stalePage, /다른 사람의 이유/);
assert.match(stalePage, /마지막으로 불러온 내용/);
assert.doesNotMatch(stalePage, /원픽을 불러오지 못했어요/);
press('신라면 원픽 상세 보기'); assert.equal(destination.params.pickId, 'mine');
press('다시 불러오기'); assert.equal(queryRetries, 1);
pullToRefresh.props.onRefresh(); assert.equal(queryRetries, 2);
query.isFetching = true; query.isRefetching = true;
assert.match(render(), /새로고침 중/);
assert.equal(refreshButton().disabled, true); assert.equal(pullToRefresh.props.refreshing, true);
refreshButton().onPress(); pullToRefresh.props.onRefresh();
assert.equal(queryRetries, 2, 'Repeated refreshes must not cancel an active request');
query.isFetching = false; query.isRefetching = false; query.isError = false;
assert.doesNotMatch(render(), /마지막으로 불러온 내용/);
refreshButton().onPress(); assert.equal(queryRetries, 3);
const cached = query.data; query.data = undefined; query.isError = true;
assert.match(render(), /원픽을 불러오지 못했어요/);
assert.equal(refreshButton(), undefined);
press('다시 불러오기'); assert.equal(queryRetries, 4);
query.data = cached;
auth.isLoading = true;
assert.doesNotMatch(render(), /내 실제 선택 이유|다른 사람의 이유/);
assert.equal(pullToRefresh, undefined);
auth.isLoading = false; auth.user = null;
assert.doesNotMatch(render(), /내 실제 선택 이유|다른 사람의 이유|MY PICK/);
refreshButton().onPress(); assert.equal(queryRetries, 5, 'Public Home supports refresh too');
query.isError = false; query.isPending = true;
assert.match(render(), /원픽을 불러오고 있어요/);
console.log('Home screen checks passed: personalized/public states, cached-error recovery, refresh controls, session privacy and collection routes across responsive layouts.');
