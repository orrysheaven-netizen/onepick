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
let presses = [], destination, sessionRetries = 0, queryRetries = 0, pullToRefresh, endReached, pageCalls = 0, renderedKeys = [], photos = [];
const component = (tag) => ({ children }) => React.createElement(tag, null, children);
const auth = { user: { id: 'owner' }, isLoading: false, error: null, retry: () => sessionRetries++ };
const own = { pick: { id: 'mine', userId: 'owner', categoryId: 'ramen', itemId: 'shin', oneLineReview: '내 실제 선택 이유', status: 'active' }, item: { name: '신라면' } };
const privatePick = { ...own, pick: { ...own.pick, id: 'private', categoryId: 'review', status: 'needs_review', oneLineReview: '비공개 확인 대기 원픽' } };
const entry = (pickId, userId, itemId, name, reason) => ({ pickId, userId, username: userId, itemId, name,
  categoryId: 'ramen', categoryName: '라면', thumbnailUrl: null, profileImageUrl: null, oneLineReview: reason });
const query = { isPending: false, isError: false, isFetching: false, isRefetching: false,
  hasNextPage: true, isFetchNextPageError: false, fetchNextPage: (options) => { assert.equal(options.cancelRefetch, false); pageCalls++; },
  refetch: (options) => { assert.equal(options.cancelRefetch, false); queryRetries++; }, data: {
    currentPicks: [own, privatePick], featuredPicks: [
      entry('a', 'friend', 'jin', '진라면', '다른 사람의 이유'),
      entry('b', 'second', 'jin', '진라면', '같은 제품을 고른 또 다른 이유'),
      entry('c', 'third', 'shin', '신라면', '나와 같은 취향'),
      entry('self', 'owner', 'own-product', '숨겨야 할 내 카드', '홈에 내 카드 중복 없음'),
    ],
    categoriesToPick: [{ category: { id: 'snacks', name: '과자' } }], openCategories: [{ id: 'ramen', name: '라면' }],
  } };
const { default: Home } = load('app/(tabs)/index.tsx', {
  'expo-router': { useRouter: () => ({ push: (route) => { destination = route; } }) },
  'react-native': {
    Text: component('span'), View: component('div'), Image: component('img'), ActivityIndicator: () => null, RefreshControl: () => null,
    FlatList: (props) => {
      pullToRefresh = props.refreshControl; endReached = props.onEndReached; renderedKeys = props.data.map(props.keyExtractor);
      return React.createElement('main', null, props.ListHeaderComponent, props.data.map((item) => React.createElement('div', { key: props.keyExtractor(item) }, props.renderItem({ item }))), props.ListFooterComponent);
    },
    Pressable: (props) => { presses.push(props); return React.createElement('button', null, props.children); },
    StyleSheet: { create: (styles) => styles },
  },
  'react-native-safe-area-context': { SafeAreaView: component('section') },
  '@/components/notification-button': { NotificationButton: ({ userId }) => React.createElement('span', null, '알림 ' + userId) },
  '@/components/onepick-brand': { OnePickBrand: () => null },
  '@/components/pick-photo': { PickPhoto: (props) => { photos.push(props); return null; } },
  '@/components/item-search': { ItemSearch: () => React.createElement('span', null, '공통 검색') },
  '@/constants/onepick': load('constants/onepick.ts'),
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useHomeData': { useHomeData: () => query },
});
const render = () => { presses = []; photos = []; return renderToStaticMarkup(React.createElement(Home)); };
const refreshButton = () => presses.find((p) => p.accessibilityLabel === '홈 원픽 새로고침');
const press = (label) => {
  const button = presses.find((p) => p.accessibilityLabel === label || textOf(p.children) === label);
  assert.ok(button, label); button.onPress();
};
let page = render();
assert.match(page, /@friend/); assert.match(page, /@second/); assert.match(page, /다른 사람의 이유/); assert.match(page, /같은 제품을 고른 또 다른 이유/);
assert.ok(page.indexOf('@friend') < page.indexOf('진라면'), 'Person is displayed before the product');
assert.ok(page.indexOf('다른 사람의 이유') < page.indexOf('나도 이게 원픽'), 'Read the opinion before choosing');
assert.ok(page.indexOf('진라면') < page.indexOf('상품 바로 찾기'), 'Home begins with people, not a product search');
assert.equal(renderedKeys.join(','), 'a,b,c', 'Same product retains separate cards; self is excluded');
assert.equal(photos[0].itemId, 'jin', 'Missing-photo action still has the saved product target');
assert.doesNotMatch(page, /비공개 확인 대기 원픽|숨겨야 할 내 카드|명이 원픽으로 선택|명 이상|팔로우|싫어요/);
assert.match(page, /이미 내 원픽이에요/); assert.match(page, /현재 내 원픽: 신라면/);
press('진라면 나도 이게 원픽'); assert.equal(destination.pathname, '/pick/choose'); assert.equal(destination.params.itemId, 'jin'); assert.equal(destination.params.categoryId, 'ramen');
assert.equal(destination.params.oneLineReview, undefined, 'Do not copy another person’s opinion');
press('라면 나는 다른 원픽 찾기'); assert.equal(destination.pathname, '/pick/find'); assert.equal(destination.params.categoryId, 'ramen'); assert.equal(destination.params.itemId, undefined);
press('신라면 내 한줄평 보기'); assert.equal(destination.pathname, '/item/[itemId]'); assert.equal(destination.params.itemId, 'shin'); assert.equal(destination.params.pickId, 'mine');
press('@friend의 진라면 의견 나누기'); assert.equal(destination.params.itemId, 'jin'); assert.equal(destination.params.pickId, 'a', 'Open this author’s thread, not an arbitrary product review');
press('@second 프로필 보기'); assert.equal(destination.pathname, '/u/[username]'); assert.equal(destination.params.username, 'second');
press('진라면 제품 상세 보기'); assert.equal(destination.params.itemId, 'jin'); assert.equal(destination.params.pickId, undefined);
press('원픽 더 둘러보기'); assert.equal(destination, '/explore');
press('내 원픽 2개 모아보기'); assert.equal(destination, '/profile');
press('과자 원픽 찾기'); assert.equal(destination.params.categoryId, 'snacks');
assert.ok(page.indexOf('신라면') < page.indexOf('내 원픽 2개 모아보기'));
assert.ok(page.indexOf('내 원픽 2개 모아보기') < page.indexOf('아직 선택하지 않은 카테고리'));

render(); endReached(); assert.equal(pageCalls, 1);
query.isFetching = true; render(); endReached(); assert.equal(pageCalls, 1); press('원픽 더 보기'); assert.equal(pageCalls, 1);
query.isFetching = false; query.isFetchNextPageError = true;
assert.match(render(), /다음 원픽을 불러오지 못했어요/); endReached(); assert.equal(pageCalls, 1);
press('다음 원픽 다시 불러오기'); assert.equal(pageCalls, 2);
query.isFetchNextPageError = false; query.hasNextPage = false; render(); endReached(); assert.equal(pageCalls, 2);
assert.match(render(), /모두 확인했어요/);
auth.user = null;
const guest = render();
assert.match(guest, /진라면/); assert.match(guest, /어떤 취향부터 골라볼까요/);
assert.doesNotMatch(guest, /비공개 확인 대기 원픽|이미 내 원픽|현재 내 원픽|내 원픽 2개 모아보기|알림 owner/);
press('진라면 나도 이게 원픽'); assert.equal(destination.pathname, '/auth/login'); assert.equal(destination.params.action, 'choose_pick'); assert.equal(destination.params.itemId, 'jin'); assert.equal(destination.params.categoryId, 'ramen');
press('라면 나는 다른 원픽 찾기'); assert.equal(destination.pathname, '/pick/find', 'Different-product browsing does not require login');
press('라면 원픽 찾기'); assert.equal(destination.params.categoryId, 'ramen');
query.data.mode = 'single_category'; query.data.singleCategoryItems = [{ id: 'fake', name: '가짜 추천 제품' }];
assert.doesNotMatch(render(), /가짜 추천 제품/, 'No product-only fallback masquerading as a person');

auth.user = { id: 'owner' }; auth.error = new Error('offline');
assert.doesNotMatch(render(), /진라면|신라면/); assert.equal(pullToRefresh, undefined);
press('다시 불러오기'); assert.equal(sessionRetries, 1);
auth.error = null; query.isError = true;
page = render(); assert.match(page, /진라면/); assert.match(page, /마지막으로 불러온 내용/);
assert.doesNotMatch(page, /원픽을 불러오지 못했어요/);
press('다시 불러오기'); assert.equal(queryRetries, 1); pullToRefresh.props.onRefresh(); assert.equal(queryRetries, 2);
query.isFetching = true; query.isRefetching = true;
assert.match(render(), /새로고침 중/); assert.equal(refreshButton().disabled, true); assert.equal(pullToRefresh.props.refreshing, true);
refreshButton().onPress(); pullToRefresh.props.onRefresh(); assert.equal(queryRetries, 2);
query.isFetching = false; query.isRefetching = false; query.isError = false;
assert.doesNotMatch(render(), /마지막으로 불러온 내용/); refreshButton().onPress(); assert.equal(queryRetries, 3);
const cached = query.data; query.data = undefined; query.isError = true;
assert.match(render(), /원픽을 불러오지 못했어요/); assert.equal(refreshButton(), undefined);
press('다시 불러오기'); assert.equal(queryRetries, 4);
query.data = cached; auth.isLoading = true;
assert.doesNotMatch(render(), /진라면|신라면/); assert.equal(pullToRefresh, undefined);
auth.isLoading = false; auth.user = null; render(); refreshButton().onPress(); assert.equal(queryRetries, 5);
query.data = { ...cached, featuredPicks: [], currentPicks: [] }; query.isError = false;
assert.match(render(), /아직 둘러볼 다른 사람의 원픽이 없어요/); assert.doesNotMatch(render(), /명 이상/);
press('나만의 원픽 찾기'); assert.equal(destination.pathname, '/pick/find');
query.isPending = true; assert.match(render(), /원픽을 불러오고 있어요/);
console.log('Home screen passed: people first, same/different selection routes, own-choice protection, exact discussion, photos, public login intent, pagination, empty/loading/retry and session privacy.');
