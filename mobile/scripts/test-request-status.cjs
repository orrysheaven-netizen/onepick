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
  let presses = [], destination, refreshes = 0, pullToRefresh;
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
  const request = (id, status, mergedIntoProduct = null) => ({
    product: { id, name: `${id} 제품`, status }, category, mergedIntoProduct,
  });
  const profileQuery = {
    data: {
      profile: { username: 'owner' }, currentPicks: [], history: [],
      productRequests: [request('waiting', 'pending')],
    },
    isPending: false, isError: false, isFetching: false, isRefetching: false, isRefetchError: false,
    refetch: async () => {
      refreshes++;
      profileQuery.data.productRequests = [request('waiting', 'active')];
    },
  };
  const { default: Profile } = load('app/(tabs)/profile.tsx', {
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: component('section') },
    'expo-router': { useRouter: () => ({ push: (route) => { destination = route; } }) },
    '@/components/pick-photo': { PickPhoto: () => null },
    '@/components/sign-out-button': { SignOutButton: () => null },
    '@/errors/appError': { AppError },
    '@/hooks/useAdmin': { useAdminAccess: () => ({ data: false }) },
    '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/hooks/useMyProfile': { useMyProfile: () => profileQuery },
  });
  const render = () => { presses = []; return renderToStaticMarkup(React.createElement(Profile)); };
  const button = (label) => presses.find((props) => textOf(props.children).includes(label));
  const refreshButton = () => presses.find((props) => props.accessibilityLabel === '프로필과 제품 등록 요청 상태 새로고침');

  assert.match(render(), /승인 대기/);
  assert.equal(button('waiting 제품'), undefined, 'Pending requests must not navigate to a selectable product');
  await refreshButton().onPress();
  assert.equal(refreshes, 1);
  assert.match(render(), /승인됨/);
  button('waiting 제품').onPress();
  assert.equal(destination.pathname, '/product/[productId]');
  assert.equal(destination.params.productId, 'waiting', 'Approval leads to the same shared product');
  await pullToRefresh.props.onRefresh();
  assert.equal(refreshes, 2, 'Native pull-to-refresh uses the same profile query');

  profileQuery.isFetching = true; profileQuery.isRefetching = true;
  assert.match(render(), /최신 상태 확인 중/);
  assert.equal(refreshButton().disabled, true);
  assert.equal(pullToRefresh.props.refreshing, true);
  profileQuery.isFetching = false; profileQuery.isRefetching = false;

  profileQuery.data.productRequests = [
    request('merged', 'merged', { id: 'canonical', name: '정식 라면', status: 'active' }),
    request('merged-hidden', 'merged', { id: 'private', name: '숨긴 제품', status: 'hidden' }),
    request('merged-missing', 'merged'),
    request('rejected', 'rejected'), request('hidden', 'hidden'), request('old', 'discontinued'),
  ];
  render();
  button('merged 제품').onPress();
  assert.equal(destination.params.productId, 'canonical', 'Merged requests open the canonical product, not the duplicate');
  for (const id of ['merged-hidden', 'merged-missing', 'rejected', 'hidden']) {
    assert.equal(button(`${id} 제품`), undefined, `${id} must not open a non-public product`);
  }
  button('old 제품').onPress();
  assert.equal(destination.params.productId, 'old');

  profileQuery.isError = true; profileQuery.isRefetchError = true;
  const stale = render();
  assert.match(stale, /마지막으로 확인한 내용을 표시/);
  assert.match(stale, /내 제품 등록 요청/, 'A transient refresh error keeps already loaded requests visible');
  assert.ok(refreshButton());
  const cached = profileQuery.data;
  profileQuery.data = undefined;
  assert.match(render(), /프로필을 불러오지 못했어요/);
  profileQuery.data = cached;
  auth.user = null;
  const loggedOut = render();
  assert.match(loggedOut, /로그인하기/);
  assert.doesNotMatch(loggedOut, /내 제품 등록 요청|merged 제품/, 'Logging out must hide cached private requests');
  console.log('Request status checks passed: refresh after approval, merge targets, inaccessible products, cached-error recovery and logout privacy.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
