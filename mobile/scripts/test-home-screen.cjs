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
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    assert.fail(name);
  } });
  return exports;
}

const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';
let presses = [], destination, sessionRetries = 0, queryRetries = 0, width = 1200, pullToRefresh, endReached, pageCalls = 0, itemSearchProps, homeDataArgs;
const component = (tag) => ({ children }) => React.createElement(tag, null, children);
const auth = { user: { id: 'owner' }, isLoading: false, error: null, retry: () => sessionRetries++ };
const own = { pick: { id: 'mine', userId: 'owner', itemId: 'ramen', oneLineReview: '내 실제 선택 이유', status: 'active' }, item: { name: '신라면' }, category: { name: '라면' }, profile: { username: 'owner' } };
const other = { ...own, pick: { ...own.pick, id: 'other', userId: 'friend', itemId: 'jin', oneLineReview: '다른 사람의 이유' }, item: { name: '진라면' }, profile: { username: 'friend' } };
const privatePick = { ...own, pick: { ...own.pick, id: 'private', status: 'needs_review', oneLineReview: '비공개 확인 대기 원픽' } };
const query = { isPending: false, isError: false, isFetching: false, isRefetching: false,
  hasNextPage: true, isFetchNextPageError: false, fetchNextPage: (options) => { assert.equal(options.cancelRefetch, false); pageCalls++; },
  refetch: (options) => { assert.equal(options.cancelRefetch, false); queryRetries++; }, data: {
  currentPicks: [own, privatePick], picks: [
    // Newest first; the server already excluded the viewer's own Picks.
    { pickId: 'other', userId: 'friend', username: 'friend', profileImageUrl: null, itemId: 'jin', name: '진라면', categoryId: 'ramen', categoryName: '라면', oneLineReview: '다른 사람의 이유', thumbnailUrl: null, startedAt: '2026-09-21T09:00:00.000000+00:00' },
    { pickId: 'same-as-mine', userId: 'neighbor', username: 'neighbor', profileImageUrl: null, itemId: 'ramen', name: '신라면', categoryId: 'ramen', categoryName: '라면', oneLineReview: '이웃도 신라면', thumbnailUrl: null, startedAt: '2026-09-20T09:00:00.000000+00:00' },
  ], openCategories: [
    { id: 'ramen', parentId: 'food', name: '라면', slug: 'ramen', label: '먹을것 › 면류 › 라면' },
    { id: 'book', parentId: 'culture', name: '책', slug: 'book', label: '문화 › 책' },
    { id: 'youtube', parentId: 'culture', name: '유튜브', slug: 'youtube', label: '문화 › 유튜브' },
  ], singleCategoryItems: [],
} };
const native = {
    Text: component('span'), View: component('div'), ActivityIndicator: () => null, RefreshControl: () => null,
    ScrollView: component('nav'),
    FlatList: (props) => { pullToRefresh = props.refreshControl; endReached = props.onEndReached; return React.createElement('main', null, props.ListHeaderComponent, props.data.map((item) => React.createElement('div', { key: item.itemId }, props.renderItem({ item }))), props.ListFooterComponent); },
    Pressable: (props) => { presses.push(props); return React.createElement('button', null, props.children); },
    StyleSheet: { create: (styles) => styles }, Platform: { OS: 'web' }, useWindowDimensions: () => ({ width }),
};
const pickPhoto = { PickPhoto: () => null };
const ui = require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': pickPhoto });
const onepickConstants = load('constants/onepick.ts', {
  './font-family': load('constants/font-family.web.ts'),
});
const followingQuery = {
  data: { items: [query.data.picks[0]], nextCursor: null },
  isPending: false, isError: false, isFetching: false, isRefetching: false,
  hasNextPage: false, isFetchingNextPage: false, isFetchNextPageError: false,
  refetch: async () => {}, fetchNextPage: async () => {},
};
const { default: Home } = load('app/(tabs)/index.tsx', {
  'expo-router': { useRouter: () => ({ push: (route) => { destination = route; } }) },
  'react-native': native,
  'react-native-safe-area-context': { SafeAreaView: component('section') },
  '@/components/onepick-brand': { OnePickBrand: () => null },
  '@/components/notification-button': { NotificationButton: ({ userId }) => React.createElement('span', { 'data-notification-user': userId }, '알림') },
  '@/components/pick-photo': pickPhoto,
  '@/components/ui': ui,
  '@/components/home-feed-card': load('components/home-feed-card.tsx', { '@/components/ui': ui, '@/lib/format/relativeTime': load('lib/format/relativeTime.ts') }),
  '@/hooks/useFollow': { useFollowingFeed: () => followingQuery },
  '@/components/item-pick-count': { ItemPickCount: () => null },
  '@/components/item-search': { ItemSearch: (props) => { itemSearchProps = props; return null; } },
  '@/constants/onepick': onepickConstants,
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useExploreData': { useExploreCategories: () => ({ data: [
    { id: 'food', parentId: null, name: '먹을것', slug: 'food', status: 'open', isVisible: true, isPickable: false, sortOrder: 10 },
    { id: 'noodles', parentId: 'food', name: '면류', slug: 'noodles', status: 'open', isVisible: true, isPickable: false, sortOrder: 1 },
    { id: 'culture', parentId: null, name: '문화', slug: 'culture', status: 'open', isVisible: true, isPickable: false, sortOrder: 20 },
    { id: 'ramen', parentId: 'noodles', name: '라면', slug: 'ramen', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
    { id: 'snacks', parentId: 'food', name: '과자', slug: 'snacks', status: 'open', isVisible: true, isPickable: true, sortOrder: 2 },
    { id: 'movie', parentId: 'culture', name: '영화', slug: 'movie', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
    { id: 'book', parentId: 'culture', name: '책', slug: 'book', status: 'open', isVisible: true, isPickable: true, sortOrder: 5 },
    { id: 'youtube', parentId: 'culture', name: '유튜브', slug: 'youtube', status: 'open', isVisible: true, isPickable: true, sortOrder: 6 },
  ] }) },
  '@/hooks/useHomeData': { useHomeData: (...args) => { homeDataArgs = args; return query; } },
  '@/lib/categories/categoryTree': load('lib/categories/categoryTree.ts'),
  '@/lib/home/homeCategoryFilters': load('lib/home/homeCategoryFilters.ts', {
    '@/lib/categories/categoryTree': load('lib/categories/categoryTree.ts'),
  }),
});
const render = () => { presses = []; return renderToStaticMarkup(React.createElement(Home)); };
const refreshButton = () => presses.find((p) => p.accessibilityLabel === '홈 원픽 새로고침');
const press = (label) => {
  const button = presses.find((p) => p.accessibilityLabel === label || textOf(p.children) === label);
  assert.ok(button, label); button.onPress();
};

// The real enabled follow flag must not force a new member into an empty feed.
const allFirstPage = render();
assert.match(allFirstPage, /팔로잉/, 'Following remains an available member scope');
assert.match(allFirstPage, /알림/, 'Signed-in Home exposes the notifications entry in the header');
assert.match(allFirstPage, /data-notification-user="owner"/, 'Notification entry is scoped to the signed-in user');
assert.match(allFirstPage, /@friend/);
assert.match(allFirstPage, /@neighbor/, 'Member Home renders the public feed first');
assert.match(allFirstPage, /원픽 더 둘러보기/, 'The public-feed footer belongs to the default scope');
assert.equal(homeDataArgs[2], true, 'All Home enables the visible public feed');
assert.equal(presses.find((p) => p.accessibilityLabel === '전체 원픽 보기').accessibilityState.selected, true);
assert.equal(presses.find((p) => p.accessibilityLabel === '팔로잉 원픽 보기').accessibilityState.selected, false);
assert.ok(refreshButton(), 'Successful web Home retains a manual refresh button');

for (width of [390, 800, 1200]) {
  const page = render();
  assert.match(page, /@friend/); assert.match(page, /“다른 사람의 이유”/, 'Each card quotes that person’s own reason');
  assert.match(page, /@neighbor/); assert.match(page, /이웃도 신라면/);
  assert.match(page, /내 원픽/, 'A card for the item I already picked is badged');
  assert.match(page, /이미 내 원픽이에요/); assert.match(page, /나도 이게 원픽/); assert.doesNotMatch(page, /나는 다른 원픽|의견 나누기/, 'Home cards drop the finder and comment shortcuts; comments live on the item screen');
  assert.doesNotMatch(page, /명이 추천|추천 이유|MY PICK/, 'No aggregate counts or English badges on the people feed');
  assert.ok(page.indexOf('@friend') < page.indexOf('진라면'), 'Person comes before the item');
  assert.ok(page.indexOf('진라면') < page.indexOf('신라면'), 'Home preserves newest-first service order instead of prioritizing the viewer’s picks');
  assert.doesNotMatch(page, /아직 선택하지 않은 카테고리/, 'Signed-in Home no longer lists unselected categories');
  assert.match(page, /전체/);
  assert.equal(presses.find((p) => p.accessibilityLabel === '먹을것 카테고리 보기'), undefined, 'Two loaded Picks do not show category filters');
  assert.equal(presses.find((p) => p.accessibilityLabel === '문화 카테고리 보기'), undefined);
  assert.equal(typeof itemSearchProps.onSearchBook, 'function');
  assert.equal(typeof itemSearchProps.onSearchYouTube, 'function');
  assert.equal(typeof itemSearchProps.onSubmitSearch, 'function');
  assert.ok(page.indexOf('신라면') < page.indexOf('원픽 더 둘러보기'));
  assert.ok(page.indexOf('원픽 더 둘러보기') < page.indexOf('내 원픽 2개 모아보기'));
  assert.doesNotMatch(page, /비공개 확인 대기 원픽/);
  press('신라면 제품 상세 보기'); assert.equal(destination.params.itemId, 'ramen');
  press('진라면 제품 상세 보기'); assert.equal(destination.params.itemId, 'jin');
  press('@friend 프로필 보기'); assert.equal(destination.pathname, '/u/[username]'); assert.equal(destination.params.username, 'friend');
  press('진라면 나도 이게 원픽'); assert.equal(destination.pathname, '/pick/choose'); assert.equal(destination.params.itemId, 'jin'); assert.equal(destination.params.categoryId, 'ramen');
  press('신라면 내 한줄평 보기'); assert.equal(destination.pathname, '/pick/choose'); assert.equal(destination.params.itemId, 'ramen', 'My own item opens my review instead of a duplicate pick');
  press('원픽 더 둘러보기'); assert.equal(destination, '/explore');
  press('내 원픽 2개 모아보기'); assert.equal(destination, '/profile');
  assert.doesNotMatch(page, /라면 원픽 찾기/, 'Signed-in Home hides the category grid');
  itemSearchProps.onSearchBook('아리랑');
  assert.equal(destination.pathname, '/pick/book');
  assert.equal(destination.params.categoryId, 'book');
  assert.equal(destination.params.query, '아리랑');
  itemSearchProps.onSearchYouTube('최재천의 아마존');
  assert.equal(destination.pathname, '/pick/youtube');
  assert.equal(destination.params.categoryId, 'youtube');
  itemSearchProps.onSubmitSearch('최재천의 아마존');
  assert.equal(destination.pathname, '/explore');
  assert.equal(destination.params.search, '1');
  assert.equal(destination.params.query, '최재천의 아마존');
}

// Test the actual boundary using unique loaded records, without changing thresholds.
const smallFeed = query.data.picks;
query.data.picks = Array.from({ length: 19 }, (_, i) => ({ ...smallFeed[0], pickId: `pick-${i}`, itemId: `item-${i}` }));
render(); assert.equal(presses.find((p) => p.accessibilityLabel === '먹을것 카테고리 보기'), undefined);
query.data.picks.push({ ...smallFeed[1], pickId: 'pick-19', itemId: 'item-19' });
render(); assert.ok(presses.find((p) => p.accessibilityLabel === '먹을것 카테고리 보기'));
assert.ok(presses.find((p) => p.accessibilityLabel === '문화 카테고리 보기'));
query.data.picks = smallFeed;

render(); endReached(); assert.equal(pageCalls, 1);
query.isFetching = true; render(); endReached(); assert.equal(pageCalls, 1);
query.isFetching = false; query.isFetchNextPageError = true;
assert.match(render(), /다음 원픽을 불러오지 못했어요/); endReached(); assert.equal(pageCalls, 1, 'Do not repeatedly retry a failed next page');
press('다음 원픽 다시 불러오기'); assert.equal(pageCalls, 2);
query.isFetchNextPageError = false; query.hasNextPage = false; render(); endReached(); assert.equal(pageCalls, 2);
assert.match(render(), /모두 확인했어요/);
auth.user = null;
const publicPage = render();
assert.match(publicPage, /진라면/); assert.match(publicPage, /신라면/);
assert.doesNotMatch(publicPage, /data-notification-user=/, 'Signed-out Home does not render a user notification entry');
assert.equal(presses.find((p) => p.accessibilityLabel === '내 프로필'), undefined, 'Signed-out Home hides the own-profile avatar');
assert.match(publicPage, /어떤 취향부터 골라볼까요/);
assert.doesNotMatch(publicPage, /먹을것 › 면류 › 라면/, 'Home category cards show only the leaf name');
press('라면 원픽 찾기'); assert.equal(destination.params.categoryId, 'ramen');
assert.doesNotMatch(publicPage, /비공개 확인 대기 원픽|내 원픽|이미 내 원픽이에요/, 'Visitors see only the public feed, never the cached private collection');
assert.match(publicPage, /나도 이게 원픽/, 'Visitors can still follow a Pick; the choose screen asks them to log in');
press('진라면 제품 상세 보기'); assert.equal(destination.params.itemId, 'jin');
query.data.mode = 'single_category'; query.data.singleCategoryItems = [{ id: 'public', name: '공개 제품' }];
assert.doesNotMatch(render(), /공개 제품/, 'The legacy single-category catalog must not bypass the threshold');

auth.user = { id: 'owner' }; auth.error = new Error('offline');
assert.doesNotMatch(render(), /신라면|진라면/);
assert.equal(pullToRefresh, undefined, 'Session errors must not refresh data for an unverified user');
press('다시 불러오기'); assert.equal(sessionRetries, 1);
auth.error = null; query.isError = true;
const stalePage = render();
assert.match(stalePage, /신라면/); assert.match(stalePage, /진라면/);
assert.match(stalePage, /마지막으로 불러온 내용/);
assert.doesNotMatch(stalePage, /원픽을 불러오지 못했어요/);
press('신라면 제품 상세 보기'); assert.equal(destination.params.itemId, 'ramen');
press('다시 불러오기'); assert.equal(queryRetries, 1);
pullToRefresh.props.onRefresh(); assert.equal(queryRetries, 2);
query.isFetching = true; query.isRefetching = true;
assert.match(render(), /새로고침 중/);
assert.equal(refreshButton().disabled, true); assert.equal(pullToRefresh.props.refreshing, true);
refreshButton().onPress(); pullToRefresh.props.onRefresh();
assert.equal(queryRetries, 2, 'Repeated refreshes must not cancel an active request');
query.isFetching = false; query.isRefetching = false; query.isError = false;
assert.doesNotMatch(render(), /마지막으로 불러온 내용/);
assert.ok(refreshButton(), 'Web refresh remains available after recovery');
pullToRefresh.props.onRefresh(); assert.equal(queryRetries, 3);
const cached = query.data; query.data = undefined; query.isError = true;
assert.match(render(), /원픽을 불러오지 못했어요/);
assert.equal(refreshButton(), undefined);
press('다시 불러오기'); assert.equal(queryRetries, 4);
query.data = cached;
auth.isLoading = true;
assert.doesNotMatch(render(), /신라면|진라면/);
assert.equal(pullToRefresh, undefined);
auth.isLoading = false; auth.user = null;
assert.match(render(), /진라면/);
assert.doesNotMatch(render(), /비공개 확인 대기 원픽|내 원픽/);
refreshButton().onPress(); assert.equal(queryRetries, 5, 'Public Home supports error refresh too');
query.data = { ...cached, picks: [], currentPicks: [] }; query.isError = false;
assert.match(render(), /아직 공개된 원픽이 없어요/);
assert.doesNotMatch(render(), /명 이상/, 'No minimum pick count on the people feed');
query.isError = false; query.isPending = true;
assert.match(render(), /원픽을 불러오고 있어요/);
console.log('Home screen checks passed: all-first member entry, filter boundary, public-feed cards/actions, routes, empty states, refresh recovery and session privacy.');
