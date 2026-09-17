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

async function main() {
  let presses = [], destination, refreshes = 0, requestRefreshes = 0, historyRefreshes = 0, pullToRefresh;
  const component = (tag) => ({ children }) => React.createElement(tag, null, children);
  const native = {
    Text: component('span'), View: component('div'), ActivityIndicator: () => null,
    ScrollView: (props) => { pullToRefresh = props.refreshControl; return React.createElement('main', null, props.children); },
    RefreshControl: () => null,
    Pressable: (props) => { presses.push(props); return React.createElement('button', null, props.children); },
    StyleSheet: { create: (styles) => styles }, useWindowDimensions: () => ({ width: 390 }),
  };
  const { AppError } = load('errors/appError.ts');
  const auth = { user: { id: 'owner' }, isLoading: false, error: null };
  const category = { id: 'ramen', name: '라면' };
  const request = (id, status, mergedIntoItem = null) => ({
    item: { id, name: `${id} 제품`, status }, category, mergedIntoItem,
  });
  const profileQuery = {
    data: {
      profile: { username: 'owner' }, currentPicks: [],
    },
    isPending: false, isError: false, isFetching: false, isRefetching: false, isRefetchError: false,
    refetch: async () => {
      refreshes++;
    },
  };
  const listQuery = () => ({
    data: [], isPending: false, isError: false, isFetching: false,
    isRefetching: false, isFetchNextPageError: false, hasNextPage: false,
    refetch: async () => {}, fetchNextPage: async () => {},
  });
  const historyQuery = listQuery(), requestsQuery = listQuery();
  requestsQuery.data = [request('waiting', 'pending')];
  requestsQuery.refetch = async () => { requestRefreshes++; requestsQuery.data = [request('waiting', 'active')]; };
  historyQuery.refetch = async () => { historyRefreshes++; };
  let historyUser, requestsUser;
  const { default: Profile } = load('app/(tabs)/profile.tsx', {
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: component('section') },
    'expo-router': { useRouter: () => ({ push: (route) => { destination = route; } }) },
    '@/components/pick-photo': { PickPhoto: () => null },
    '@/components/unselected-categories': { UnselectedCategories: () => null },
    '@/components/sign-out-button': { SignOutButton: () => null },
    '@/errors/appError': { AppError },
    '@/hooks/useAdmin': { useAdminAccess: () => ({ data: false }) },
    '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/hooks/useMyProfile': { useMyProfile: () => profileQuery },
    '@/hooks/useMyProfileLists': {
      useMyPickHistory: (userId) => { historyUser = userId; return historyQuery; },
      useMyItemRequests: (userId) => { requestsUser = userId; return requestsQuery; },
    },
  });
  const render = () => { presses = []; return renderToStaticMarkup(React.createElement(Profile)); };
  const button = (label) => presses.find((props) => textOf(props.children).includes(label));
  const refreshButton = () => presses.find((props) => props.accessibilityLabel === '프로필과 제품 등록 요청 상태 새로고침');

  assert.match(render(), /승인 대기/);
  assert.equal(historyUser, 'owner'); assert.equal(requestsUser, 'owner');
  assert.equal(button('waiting 제품'), undefined, 'Pending requests must not navigate to a selectable item');
  await refreshButton().onPress();
  assert.equal(refreshes, 1);
  assert.match(render(), /승인됨/);
  button('waiting 제품').onPress();
  assert.equal(destination.pathname, '/item/[itemId]');
  assert.equal(destination.params.itemId, 'waiting', 'Approval leads to the same shared item');
  await pullToRefresh.props.onRefresh();
  assert.equal(refreshes, 2);
  assert.equal(requestRefreshes, 2); assert.equal(historyRefreshes, 2, 'Both refresh actions update all three queries');

  profileQuery.isFetching = true; profileQuery.isRefetching = true;
  assert.match(render(), /최신 상태 확인 중/);
  assert.equal(refreshButton().disabled, true);
  assert.equal(pullToRefresh.props.refreshing, true);
  profileQuery.isFetching = false; profileQuery.isRefetching = false;

  requestsQuery.data = [
    request('merged', 'merged', { id: 'canonical', name: '정식 라면', status: 'active' }),
    request('merged-hidden', 'merged', { id: 'private', name: '숨긴 제품', status: 'hidden' }),
    request('merged-missing', 'merged'),
    request('rejected', 'rejected'), request('hidden', 'hidden'), request('old', 'discontinued'),
  ];
  render();
  button('merged 제품').onPress();
  assert.equal(destination.params.itemId, 'canonical', 'Merged requests open the canonical item, not the duplicate');
  for (const id of ['merged-hidden', 'merged-missing', 'rejected', 'hidden']) {
    assert.equal(button(`${id} 제품`), undefined, `${id} must not open a non-public item`);
  }
  button('old 제품').onPress();
  assert.equal(destination.params.itemId, 'old');

  profileQuery.isError = true; profileQuery.isRefetchError = true;
  const stale = render();
  assert.match(stale, /마지막으로 확인한 내용을 표시/);
  assert.match(stale, /내 제품 등록 요청/, 'A transient refresh error keeps already loaded requests visible');
  assert.ok(refreshButton());
  profileQuery.isError = false; profileQuery.isRefetchError = false;

  // Each list retains its cards on errors and retries the appropriate operation.
  for (const [query, label] of [[requestsQuery, '등록 요청'], [historyQuery, '이전 기록']]) {
    let nextCalls = 0, refetchCalls = 0, nextOptions;
    query.fetchNextPage = async (options) => { nextCalls++; nextOptions = options; };
    query.refetch = async () => { refetchCalls++; };
    query.hasNextPage = true;
    const control = () => presses.find((props) => props.accessibilityLabel?.startsWith(`${label} `));
    assert.match(render(), /불러온 이전 선택/);
    assert.match(control().accessibilityLabel, /더 보기/);
    await control().onPress();
    assert.equal(nextCalls, 1); assert.equal(nextOptions.cancelRefetch, false);
    query.isError = true; query.isFetchNextPageError = true;
    assert.match(render(), /다음 목록을 불러오지 못했어요/);
    assert.ok(button('merged 제품'), 'A page error preserves already loaded requests');
    await control().onPress(); assert.equal(nextCalls, 2); assert.equal(refetchCalls, 0);
    query.isFetching = true;
    render(); assert.equal(control().disabled, true); assert.equal(refreshButton().disabled, true);
    await control().onPress(); await refreshButton().onPress();
    assert.equal(nextCalls, 2); assert.equal(refetchCalls, 0, 'Refresh and more actions must not interrupt a pending page');
    query.isFetching = false; query.isFetchNextPageError = false;
    assert.match(render(), /최신 목록을 확인하지 못했어요/);
    await control().onPress(); assert.equal(refetchCalls, 1); assert.equal(nextCalls, 2);
    const data = query.data; query.data = undefined; query.hasNextPage = false;
    assert.match(render(), new RegExp(`${label}을 불러오지 못했어요`));
    await control().onPress(); assert.equal(refetchCalls, 2);
    assert.match(render(), /지금의 원픽/, 'A failed list must not take down the profile');
    query.isPending = true; query.isError = false;
    render(); assert.equal(control(), undefined, 'The pending list must not offer a misleading retry');
    query.isPending = false; query.data = data;
  }

  historyQuery.data = [{ pick: { id: 'old-pick', oneLineReview: 'Previous choice', status: 'replaced' }, item: { name: '이전 제품' }, category }];
  render(); button('이전 제품').onPress();
  assert.equal(destination.pathname, '/pick/[pickId]'); assert.equal(destination.params.pickId, 'old-pick');
  const cached = profileQuery.data;
  profileQuery.data = undefined;
  assert.match(render(), /프로필을 불러오지 못했어요/);
  assert.equal(historyUser, undefined); assert.equal(requestsUser, undefined);
  profileQuery.data = cached;
  auth.user = null;
  const loggedOut = render();
  assert.match(loggedOut, /로그인하기/);
  assert.doesNotMatch(loggedOut, /내 제품 등록 요청|merged 제품/, 'Logging out must hide cached private requests');
  assert.equal(historyUser, undefined); assert.equal(requestsUser, undefined);
  auth.user = { id: 'owner' }; auth.isLoading = true;
  assert.doesNotMatch(render(), /merged 제품|이전 제품/);
  assert.equal(historyUser, undefined); assert.equal(requestsUser, undefined);
  console.log('Request status checks passed: approval/merge routes, refresh, independent list pagination/loading/errors/retries, history routes and logout privacy.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
