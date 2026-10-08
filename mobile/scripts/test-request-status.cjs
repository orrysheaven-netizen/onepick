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

// 기록 (history + requests) is on since #757; SNS stays hidden in the MVP but keeps its retained behaviour covered.
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
  let historyUser, requestsUser, profileCommentsUser, socialProps, bioProps, tabsProps, recordsProps, followCountsProfile;
  const { default: Profile } = load('app/(tabs)/(profile)/profile.tsx', {
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: component('section') },
    'expo-router': { useRouter: () => ({ push: (route) => { destination = route; } }) },
    '@/components/pick-photo': { PickPhoto: () => null },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } }),
    '@/components/profile-current-pick-row': { ProfileCurrentPickRow: () => null },
    '@/components/profile-identity': { ProfileIdentity: (props) => React.createElement(native.Text, null, props.stats.map((stat) => `${stat.label} ${stat.value}`).join(' ')) },
    '@/components/profile-tabs': { ProfileTabs: (props) => { tabsProps = props; return null; } },
    '@/components/profile-records': { ProfileRecords: (props) => { recordsProps = props; return null; } },
    '@/hooks/useFollow': { usePublicFollowCounts: (profileId) => { followCountsProfile = profileId; return { data: { followerCount: 3, followingCount: 4 } }; } },
    '@/lib/profile/profileName': load('lib/profile/profileName.ts'),
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
    '@/components/profile-photo-control': { ProfilePhotoControl: ({ children }) => children(null) },
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
  const render = () => { presses = []; socialProps = undefined; bioProps = undefined; tabsProps = undefined; recordsProps = undefined; return renderToStaticMarkup(React.createElement(Profile)); };
  const button = (label) => presses.find((props) => textOf(props.children).includes(label));
  const refreshButton = () => presses.find((props) => props.accessibilityLabel === '프로필과 원픽 등록 요청 상태 새로고침');

  // #757: the profile shows 원픽 팔로워 팔로잉 (no 댓글 count) and opens on the 원픽 tab.
  const firstProfile = render();
  assert.match(firstProfile, /원픽 0 팔로워 3 팔로잉 4/);
  assert.doesNotMatch(firstProfile, /댓글/, '내가 쓴 댓글 moved to Settings');
  assert.equal(followCountsProfile, 'owner');
  assert.equal(tabsProps.value, 'picks'); assert.equal(recordsProps, undefined, '기록 renders only on its tab');
  assert.match(firstProfile, /첫 원픽을 골라보세요/);

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
  assert.doesNotMatch(profileSource, /'\/comments'/, 'The profile no longer links 내가 쓴 댓글');
  const settingsSource = fs.readFileSync(path.join(__dirname, '../src/app/settings.tsx'), 'utf8');
  assert.match(settingsSource, /router\.push\('\/comments'\)[\s\S]*내가 쓴 댓글/, 'Settings keeps the 내가 쓴 댓글 entry (#757)');
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
  assert.equal(bioProps, undefined, 'The bio editor opens from 프로필 편집, not by default');
  assert.ok(presses.find((props) => props.accessibilityLabel === '프로필 편집'), 'Own profile offers 프로필 편집');
  assert.ok(presses.find((props) => props.accessibilityLabel === '내 프로필 공유하기'), 'Own profile offers 프로필 공유');
  assert.equal(historyUser, 'owner'); assert.equal(requestsUser, 'owner');
  assert.equal(refreshButton(), undefined, 'Healthy profile has no manual refresh');
  await pullToRefresh.props.onRefresh();
  assert.equal(refreshes, 1); assert.equal(requestRefreshes, 1); assert.equal(historyRefreshes, 1);
  profileQuery.isRefetchError = true;
  render(); await refreshButton().onPress();
  assert.equal(refreshes, 2);
  assert.equal(requestRefreshes, 2); assert.equal(historyRefreshes, 2, 'Pull refresh and error retry update all profile queries');
  assert.equal(commentsRefreshes, 0, 'The profile no longer loads 내가 쓴 댓글');

  profileQuery.isFetching = true; profileQuery.isRefetching = true;
  assert.match(render(), /확인 중…/);
  assert.equal(refreshButton().disabled, true);
  assert.equal(pullToRefresh.props.refreshing, true);
  profileQuery.isFetching = false; profileQuery.isRefetching = false;
  assert.match(render(), /마지막으로 확인한 내용을 표시/);
  profileQuery.isRefetchError = false;

  // The 기록 tab itself (#757): requests under review or rejected, then past Picks.
  const { ProfileRecords } = load('components/profile-records.tsx', {
    'react-native': native,
    '@/components/pick-photo': { PickPhoto: () => null },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } }),
    '@/components/profile-pick-card': {
      ProfilePickCard: (props) => React.createElement(
        native.Pressable,
        { accessibilityRole: 'button', accessibilityLabel: `${props.itemName} 원픽 상세 보기`, onPress: props.onPressPick },
        React.createElement(native.Text, null, `${props.itemName} ${props.statusText}`),
      ),
    },
    '@/lib/home/homeChannels': load('lib/home/homeChannels.ts'),
  });
  let openedPick;
  const renderRecords = () => { presses = []; return renderToStaticMarkup(React.createElement(ProfileRecords, { historyQuery, requestsQuery, onOpenPick: (id) => { openedPick = id; } })); };
  requestsQuery.data = [
    request('waiting', 'pending'), request('rejected', 'rejected'),
    request('merged', 'merged', { id: 'canonical', name: '정식 라면', status: 'active' }),
    request('approved', 'active'), request('hidden', 'hidden'), request('old', 'discontinued'),
  ];
  const records = renderRecords();
  assert.match(records, /waiting 제품/); assert.match(records, /검토 중/);
  assert.match(records, /rejected 제품/); assert.match(records, /반려/);
  for (const id of ['merged', 'approved', 'hidden', 'old']) assert.doesNotMatch(records, new RegExp(`${id} 제품`), `${id} requests leave 기록`);
  assert.equal(button('waiting 제품'), undefined, 'Request rows are informational, not buttons');
  assert.doesNotMatch(records, /·|›/, 'No middle dots or glyph chevrons in 기록 copy');

  // Each list retains its rows on errors and retries the appropriate operation.
  for (const [query, label] of [[requestsQuery, '등록 요청'], [historyQuery, '지난 원픽']]) {
    if (query === historyQuery) historyQuery.data = [{ pick: { id: 'kept', oneLineReview: '', status: 'replaced' }, item: { name: '남은 제품' }, category }];
    let nextCalls = 0, refetchCalls = 0, nextOptions;
    query.fetchNextPage = async (options) => { nextCalls++; nextOptions = options; };
    query.refetch = async () => { refetchCalls++; };
    query.hasNextPage = true;
    const control = () => presses.find((props) => props.accessibilityLabel?.startsWith(`${label} `));
    assert.match(renderRecords(), new RegExp(label));
    assert.match(control().accessibilityLabel, /더 보기/);
    await control().onPress();
    assert.equal(nextCalls, 1); assert.equal(nextOptions.cancelRefetch, false);
    query.isError = true; query.isFetchNextPageError = true;
    assert.match(renderRecords(), /다음 목록을 불러오지 못했어요/);
    await control().onPress(); assert.equal(nextCalls, 2); assert.equal(refetchCalls, 0);
    query.isFetching = true;
    renderRecords(); assert.equal(control().disabled, true);
    await control().onPress();
    assert.equal(nextCalls, 2); assert.equal(refetchCalls, 0, 'More actions must not interrupt a pending page');
    query.isFetching = false; query.isFetchNextPageError = false;
    assert.match(renderRecords(), /최신 목록을 확인하지 못했어요/);
    await control().onPress(); assert.equal(refetchCalls, 1); assert.equal(nextCalls, 2);
    const data = query.data; query.data = undefined; query.hasNextPage = false;
    assert.match(renderRecords(), new RegExp(`${label} 목록을 불러오지 못했어요`));
    await control().onPress(); assert.equal(refetchCalls, 2);
    query.isPending = true; query.isError = false;
    renderRecords(); assert.equal(control(), undefined, 'The pending list must not offer a misleading retry');
    query.isPending = false; query.data = data;
  }

  historyQuery.data = [{ pick: { id: 'old-pick', oneLineReview: 'Previous choice', status: 'replaced' }, item: { name: '이전 제품' }, category }];
  assert.match(renderRecords(), /다른 원픽으로 바꿨어요/);
  button('이전 제품').onPress();
  assert.equal(openedPick, 'old-pick');

  requestsQuery.data = [request('approved', 'active')]; historyQuery.data = [];
  assert.match(renderRecords(), /아직 기록이 없어요/, 'Confirmed-empty 기록 says so once');
  historyQuery.isPending = true; historyQuery.data = undefined;
  assert.doesNotMatch(renderRecords(), /아직 기록이 없어요/, 'Pending is not confirmed empty');
  historyQuery.isPending = false; historyQuery.data = [];
  requestsQuery.isError = true;
  assert.match(renderRecords(), /등록 요청/, 'A failed list still exposes its error and retry');
  requestsQuery.isError = false;

  const cached = profileQuery.data;
  profileQuery.data = undefined;
  assert.match(render(), /프로필을 불러오지 못했어요/);
  assert.equal(historyUser, undefined); assert.equal(requestsUser, undefined);
  profileQuery.data = cached;
  auth.user = null;
  const loggedOut = render();
  assert.equal(bioProps, undefined, 'Logging out hides the bio editor');
  assert.equal(socialProps, undefined, 'Logging out hides the SNS editor');
  assert.match(loggedOut, /로그인하기/);
  assert.equal(recordsProps, undefined, 'Logging out must hide private 기록');
  assert.equal(historyUser, undefined); assert.equal(requestsUser, undefined);
  auth.user = { id: 'owner' }; auth.isLoading = true;
  render(); assert.equal(recordsProps, undefined);
  assert.equal(historyUser, undefined); assert.equal(requestsUser, undefined);
  console.log('Request status checks passed: 기록 shows pending/rejected requests and past Picks, error-only refresh, confirmed-empty state, independent pagination/loading/errors/retries, history routes and logout privacy.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
