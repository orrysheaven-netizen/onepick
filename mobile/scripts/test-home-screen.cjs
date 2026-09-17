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
let presses = [], destination, sessionRetries = 0, queryRetries = 0, width = 1200;
const component = (tag) => ({ children }) => React.createElement(tag, null, children);
const auth = { user: { id: 'owner' }, isLoading: false, error: null, retry: () => sessionRetries++ };
const own = { pick: { id: 'mine', productId: 'ramen', oneLineReview: '내 실제 선택 이유', status: 'active' }, product: { name: '신라면' }, category: { name: '라면' }, profile: { username: 'owner' } };
const other = { ...own, pick: { ...own.pick, id: 'other', oneLineReview: '다른 사람의 이유' }, product: { name: '진라면' }, profile: { username: 'friend' } };
const query = { isPending: false, isError: false, refetch: () => queryRetries++, data: {
  mode: 'multi_category', currentPicks: [own], feed: [other], categoriesToPick: [{ category: { id: 'snacks', name: '과자' } }], openCategories: [{ id: 'ramen', name: '라면' }], singleCategoryProducts: [],
} };
const { default: Home } = load('app/(tabs)/index.tsx', {
  'expo-router': { useRouter: () => ({ push: (route) => { destination = route; } }) },
  'react-native': {
    Text: component('span'), View: component('div'), ScrollView: component('main'), ActivityIndicator: () => null,
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
const press = (label) => {
  const button = presses.find((p) => p.accessibilityLabel === label || textOf(p.children) === label);
  assert.ok(button, label); button.onPress();
};

for (width of [390, 800, 1200]) {
  const page = render();
  assert.match(page, /내 실제 선택 이유/); assert.match(page, /다른 사람의 이유/); assert.match(page, /MY PICK/);
  press('신라면 원픽 상세 보기'); assert.equal(destination.params.pickId, 'mine');
  press('신라면 제품 상세 보기'); assert.equal(destination.params.productId, 'ramen');
  press('진라면 원픽 상세 보기'); assert.equal(destination.params.pickId, 'other');
  press('과자 원픽 찾기'); assert.equal(destination.params.categoryId, 'snacks');
  press('＋ 원픽 등록'); assert.equal(destination.pathname, '/pick/find');
}

auth.user = null;
assert.doesNotMatch(render(), /내 실제 선택 이유|다른 사람의 이유|MY PICK/, 'Anonymous rendering never exposes cached personal cards');
press('라면 원픽 찾기'); assert.equal(destination.params.categoryId, 'ramen');
query.data.mode = 'single_category'; query.data.singleCategoryProducts = [{ id: 'public', name: '공개 제품' }];
render(); press('공개 제품 제품 상세 보기'); assert.equal(destination.params.productId, 'public');

auth.user = { id: 'owner' }; auth.error = new Error('offline');
assert.doesNotMatch(render(), /내 실제 선택 이유|다른 사람의 이유/);
press('다시 불러오기'); assert.equal(sessionRetries, 1);
auth.error = null; query.isError = true;
assert.doesNotMatch(render(), /내 실제 선택 이유|다른 사람의 이유/);
press('다시 불러오기'); assert.equal(queryRetries, 1);
query.isError = false; query.isPending = true;
assert.match(render(), /원픽을 불러오고 있어요/);
console.log('Home screen checks passed: personalized/public states, error recovery and collection routes across responsive layouts.');
