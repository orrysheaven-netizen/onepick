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
    if (name in imports) return imports[name];
    if (name === '@/components/profile-ai-panel') return { ProfileAiPanel: () => null };
    if (name === '@/components/profile-taste-composition') return { ProfileTasteComposition: () => null };
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react') return require(name);
    assert.fail(name);
  } });
  return exports;
}

// History, SNS and item requests are hidden in the MVP; keep covering their retained behaviour for when they return.
Object.assign(require('./design-tokens.cjs').OnePickFeatures, { profilePickHistory: true, profileSocialLinks: true, profileItemRequests: true });

const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function main() {
  let presses = [], destination, refreshes = 0, requestRefreshes = 0, historyRefreshes = 0, pullToRefresh;
  const component = (tag) => ({ children }) => React.createElement(tag, null, children);
  const native = {
    Platform: { OS: 'ios' },
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
      profile: { id: 'owner', username: 'owner' }, currentPicks: [],
    },
    isPending: false, isError: false, isFetching: false, isRefetching: false, isRefetchError: false,
    refetch: async () => {
      refreshes++;
    },
  };
  const listQuery = () => ({
    data: [], isPending: false, isError: false, isFetching: false,
    get isSuccess() { return !this.isPending && !this.isError && this.data !== undefined; },
    isRefetching: false, isFetchNextPageError: false, hasNextPage: false,
    refetch: async () => {}, fetchNextPage: async () => {},
  });
  const historyQuery = listQuery(), requestsQuery = listQuery(), profileCommentsQuery = listQuery();
  requestsQuery.data = [request('waiting', 'pending')];
  requestsQuery.refetch = async () => { requestRefreshes++; requestsQuery.data = [request('waiting', 'active')]; };
  historyQuery.refetch = async () => { historyRefreshes++; };
  let commentsRefreshes = 0;
  profileCommentsQuery.refetch = async () => { commentsRefreshes++; };
  let historyUser, requestsUser, profileCommentsUser, socialProps, bioProps;
  const { default: Profile } = load('app/(tabs)/(profile)/profile.tsx', {
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: component('section') },
    'expo-router': { useRouter: () => ({ push: (route) => { destination = route; } }) },
    '@/components/pick-photo': { PickPhoto: () => null },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } }),
    '@/components/profile-pick-card': {
      ProfilePickCard: (props) => React.createElement(
        native.Pressable,
        { accessibilityRole: 'button', accessibilityLabel: `${props.itemName} 원픽 상세 보기`, onPress: props.onPressPick },
        React.createElement(native.Text, null, props.itemName),
      ),
    },
    '@/components/profile-pick-groups': { ProfilePickGroups: () => null },
    '@/components/profile-ai-panel': { ProfileAiPanel: () => null },
    '@/components/profile-bio-editor': { ProfileBioEditor: (props) => { bioProps = props; return null; } },
    '@/components/profile-social-links': { ProfileSocialLinks: (props) => { socialProps = props; return null; } },
    '@/components/profile-follow-counts': { ProfileFollowCounts: () => null },
    '@/components/sign-out-button': { SignOutButton: () => null },
    '@/errors/appError': { AppError },
    '@/hooks/useAdmin': { useAdminAccess: () => ({ data: false }) },
    '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/hooks/useExploreData': { useExploreCategories: () => ({ data: [] }) },
    '@/hooks/useMyProfile': { useMyProfile: () => profileQuery },
    '@/lib/categories/categoryTree': load('lib/categories/categoryTree.ts'),
    '@/lib/categories/registrationRoute': load('lib/categories/registrationRoute.ts'),
    '@/lib/profile/profilePickGroups': { splitLabPicks: (picks) => ({ main: picks, lab: [] }), filterMainProfileByChannel: (picks) => picks, isLabCategory: () => false }, '@/components/profile-lab-entry': { ProfileLabEntry: () => null }, '@/lib/home/homeChannels': load('lib/home/homeChannels.ts'),
    '@/lib/share/shareProfile': { shareProfile: async () => {} },
    '@/hooks/useMyProfileLists': {
      useMyPickHistory: (userId) => { historyUser = userId; return historyQuery; },
      useMyItemRequests: (userId) => { requestsUser = userId; return requestsQuery; },
      useMyComments: (userId) => { profileCommentsUser = userId; return profileCommentsQuery; },
    },
  });
  const render = () => { presses = []; socialProps = undefined; bioProps = undefined; return renderToStaticMarkup(React.createElement(Profile)); };
  const button = (label) => presses.find((props) => textOf(props.children).includes(label));
  const refreshButton = () => presses.find((props) => props.accessibilityLabel === '프로필과 원픽 등록 요청 상태 새로고침');

  assert.match(render(), /승인 대기/);
  assert.match(render(), /댓글/, 'Profile keeps the comment-count entry');

  // The profile-entry 댓글 screen: signed-out visitors get a login that returns here; members see their list.
  let commentsUser, commentsScope, commentsProps, loginRoute;
  const commentsQuery = listQuery();
  const { default: MyComments } = load('app/(tabs)/comments.tsx', {
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: component('section') },
    'expo-router': { useRouter: () => ({ push: (route) => { loginRoute = route; } }) },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } }),
    '@/components/profile-my-comments': { ProfileMyComments: (props) => { commentsProps = props; return React.createElement(native.Text, null, 'MY_COMMENTS_LIST'); } },
    '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/lib/home/homeCategoryFilters': { HOME_FEED_ROOT_SLUG: 'food' },
    '@/hooks/useMyProfileLists': { useMyComments: (userId, scope) => { commentsUser = userId; commentsScope = scope; return commentsQuery; } },
  });
  const renderMyComments = () => { presses = []; commentsProps = undefined; return renderToStaticMarkup(React.createElement(MyComments)); };
  const profileSource = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/(profile)/profile.tsx'), 'utf8');
  assert.match(profileSource, /accessibilityLabel="내 댓글 보기"[\s\S]*router\.push\('\/comments'\)/);
  const myCommentsScreen = renderMyComments();
  assert.match(myCommentsScreen, /MY_COMMENTS_LIST/); assert.doesNotMatch(myCommentsScreen, /내 댓글/, 'The screen is just 댓글');
  assert.equal(commentsUser, 'owner'); assert.equal(commentsProps.query, commentsQuery);
  // Top tabs split the MVP theme from the rest, and the theme tab is the default.
  assert.deepEqual(presses.filter((props) => props.accessibilityRole === 'tab').map((props) => [props.accessibilityLabel, props.accessibilityState.selected]),
    [['음식 댓글 보기', true], ['기타 댓글 보기', false]]);
  assert.deepEqual({ ...commentsScope }, { rootSlug: 'food', inside: true });
  assert.match(commentsProps.emptyText, /음식 한줄평/);
  auth.user = null;
  assert.match(renderMyComments(), /로그인하기/); assert.equal(commentsUser, undefined); assert.equal(commentsProps, undefined);
  button('로그인하기').onPress(); assert.equal(loginRoute.params.action, 'my_comments');
  auth.user = { id: 'owner' };

  // The 댓글 list itself: newest-first rows open the focused review; unreadable reviews stay inert.
  const { ProfileMyComments } = load('components/profile-my-comments.tsx', {
    'react-native': native,
    'expo-router': { useRouter: () => ({ push: (route) => { destination = route; } }) },
    '@/components/pick-photo': { PickPhoto: () => null },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } }),
    '@/lib/format/relativeTime': { formatRelativeTime: () => '방금' },
    '@/services': { commentService: { locateComment: async (commentId) => commentId === 'c1' ? {
      rootCommentId: 'c1', pickId: 'p1', itemId: 'i1', categoryId: 'ramen', channel: 'offline',
      reviewIsCurrent: false, reviewIsDeleted: false,
      pageCursor: { timestamp: '2026-09-24T00:00:00Z', id: 'cursor-1' },
    } : null } },
  });
  const myComments = listQuery();
  const renderComments = () => { presses = []; return renderToStaticMarkup(React.createElement(ProfileMyComments, { query: myComments })); };
  assert.match(renderComments(), /아직 남긴 댓글이 없어요/);
  myComments.data = [
    { comment: { id: 'c1', body: '저도 이거 좋아요', createdAt: '2026-09-26T00:00:00Z' }, pick: { id: 'p1', itemId: 'i1', oneLineReview: '국물이 좋아요' }, pickAuthor: { username: 'friend' }, item: { name: '신라면' } },
    { comment: { id: 'c2', body: '숨겨진 곳의 댓글', createdAt: '2026-09-25T00:00:00Z' }, pick: null, pickAuthor: null, item: null },
  ];
  const list = renderComments();
  assert.match(list, /신라면 · @friend의 한줄평/); assert.match(list, /국물이 좋아요/); assert.match(list, /저도 이거 좋아요/);
  assert.match(list, /볼 수 없는 한줄평/); assert.match(list, /숨겨진 곳의 댓글/);
  assert.equal(presses.length, 1, 'Only rows with a visible review are pressable');
  presses[0].onPress(); await flush();
  assert.equal(destination.pathname, '/pick/[pickId]');
  assert.deepEqual({ ...destination.params }, {
    pickId: 'p1', itemId: 'i1', focusCommentId: 'c1',
    commentAfterTime: '2026-09-24T00:00:00Z', commentAfterId: 'cursor-1',
  }, 'Rows locate and open the exact comment inside the review conversation');
  let nextPages = 0;
  Object.assign(myComments, { hasNextPage: true, fetchNextPage: async (options) => { assert.equal(options.cancelRefetch, false); nextPages++; } });
  renderComments(); presses.find((props) => props.accessibilityLabel === '댓글 더 보기').onPress(); assert.equal(nextPages, 1);
  Object.assign(myComments, { data: undefined, isError: true });
  assert.match(renderComments(), /댓글을 불러오지 못했어요/);
  render(); // Back on the profile screen: its pull-to-refresh and press targets.
  assert.equal(bioProps.profileUserId, 'owner');
  assert.equal(socialProps.profileUserId, 'owner'); assert.equal(socialProps.editable, true);
  assert.equal(historyUser, 'owner'); assert.equal(requestsUser, 'owner'); assert.equal(profileCommentsUser, 'owner');
  assert.equal(button('waiting 제품'), undefined, 'Pending requests must not navigate to a selectable item');
  assert.equal(refreshButton(), undefined, 'Healthy profile has no manual refresh');
  await pullToRefresh.props.onRefresh();
  assert.equal(refreshes, 1);
  assert.match(render(), /승인됨/);
  button('waiting 제품').onPress();
  assert.equal(destination.pathname, '/item/[itemId]');
  assert.equal(destination.params.itemId, 'waiting', 'Approval leads to the same shared item');
  profileQuery.isRefetchError = true;
  render(); await refreshButton().onPress();
  assert.equal(refreshes, 2);
  assert.equal(requestRefreshes, 2); assert.equal(historyRefreshes, 2); assert.equal(commentsRefreshes, 2, 'Pull refresh and error retry update all profile queries');

  profileQuery.isFetching = true; profileQuery.isRefetching = true;
  assert.match(render(), /확인 중…/);
  assert.equal(refreshButton().disabled, true);
  assert.equal(pullToRefresh.props.refreshing, true);
  profileQuery.isFetching = false; profileQuery.isRefetching = false; profileQuery.isRefetchError = false;

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
  assert.match(stale, /내 원픽 등록 요청/, 'A transient refresh error keeps already loaded requests visible');
  assert.ok(refreshButton());
  profileQuery.isError = false; profileQuery.isRefetchError = false;

  // Each list retains its cards on errors and retries the appropriate operation.
  for (const [query, label] of [[requestsQuery, '등록 요청'], [historyQuery, '활동']]) {
    let nextCalls = 0, refetchCalls = 0, nextOptions;
    query.fetchNextPage = async (options) => { nextCalls++; nextOptions = options; };
    query.refetch = async () => { refetchCalls++; };
    query.hasNextPage = true;
    const control = () => presses.find((props) => props.accessibilityLabel?.startsWith(`${label} `));
    assert.match(render(), /활동 기록/);
    assert.match(control().accessibilityLabel, /더 보기/);
    await control().onPress();
    assert.equal(nextCalls, 1); assert.equal(nextOptions.cancelRefetch, false);
    query.isError = true; query.isFetchNextPageError = true;
    assert.match(render(), /다음 목록을 불러오지 못했어요/);
    assert.ok(button('merged 제품'), 'A page error preserves already loaded requests');
    await control().onPress(); assert.equal(nextCalls, 2); assert.equal(refetchCalls, 0);
    query.isFetching = true;
    render(); assert.equal(control().disabled, true); assert.equal(refreshButton(), undefined);
    await control().onPress(); await pullToRefresh.props.onRefresh();
    assert.equal(nextCalls, 2); assert.equal(refetchCalls, 0, 'Refresh and more actions must not interrupt a pending page');
    query.isFetching = false; query.isFetchNextPageError = false;
    assert.match(render(), /최신 목록을 확인하지 못했어요/);
    await control().onPress(); assert.equal(refetchCalls, 1); assert.equal(nextCalls, 2);
    const data = query.data; query.data = undefined; query.hasNextPage = false;
    assert.match(render(), new RegExp(`${label}을 불러오지 못했어요`));
    await control().onPress(); assert.equal(refetchCalls, 2);
    assert.match(render(), /첫 원픽을 골라보세요/, 'A failed list must not take down the profile');
    query.isPending = true; query.isError = false;
    render(); assert.equal(control(), undefined, 'The pending list must not offer a misleading retry');
    query.isPending = false; query.data = data;
  }

  historyQuery.data = [{ pick: { id: 'old-pick', oneLineReview: 'Previous choice', status: 'replaced' }, item: { name: '이전 제품' }, category }];
  render(); button('이전 제품').onPress();
  assert.equal(destination.pathname, '/pick/[pickId]'); assert.equal(destination.params.pickId, 'old-pick');

  const savedRequests = requestsQuery.data, savedHistory = historyQuery.data;
  requestsQuery.data = []; historyQuery.data = [];
  assert.doesNotMatch(render(), /활동 기록|내 원픽 등록 요청|원픽 활동|불러온 \d+개/, 'Confirmed-empty activity is entirely absent');
  assert.equal(historyUser, 'owner'); assert.equal(requestsUser, 'owner', 'Hidden lists retain their active user scope');
  historyQuery.isPending = true; historyQuery.data = undefined;
  assert.match(render(), /활동 기록/); assert.match(render(), /원픽 활동/, 'Pending is not confirmed empty');
  historyQuery.isPending = false; historyQuery.data = [];
  requestsQuery.isError = true;
  assert.match(render(), /내 원픽 등록 요청/, 'An empty cached list still exposes its error and retry');
  requestsQuery.isError = false; requestsQuery.data = savedRequests; historyQuery.data = savedHistory;

  const cached = profileQuery.data;
  profileQuery.data = undefined;
  assert.match(render(), /프로필을 불러오지 못했어요/);
  assert.equal(historyUser, undefined); assert.equal(requestsUser, undefined); assert.equal(profileCommentsUser, undefined);
  profileQuery.data = cached;
  auth.user = null;
  const loggedOut = render();
  assert.equal(bioProps, undefined, 'Logging out hides the bio editor');
  assert.equal(socialProps, undefined, 'Logging out hides the SNS editor');
  assert.match(loggedOut, /로그인하기/);
  assert.doesNotMatch(loggedOut, /내 원픽 등록 요청|merged 제품/, 'Logging out must hide cached private requests');
  assert.equal(historyUser, undefined); assert.equal(requestsUser, undefined); assert.equal(profileCommentsUser, undefined);
  auth.user = { id: 'owner' }; auth.isLoading = true;
  assert.doesNotMatch(render(), /merged 제품|이전 제품/);
  assert.equal(historyUser, undefined); assert.equal(requestsUser, undefined); assert.equal(profileCommentsUser, undefined);
  console.log('Request status checks passed: approval/merge routes, error-only refresh, confirmed-empty sections, independent pagination/loading/errors/retries, history routes and logout privacy.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
