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
  const historyQuery = listQuery(), requestsQuery = listQuery();
  requestsQuery.data = [request('waiting', 'pending')];
  requestsQuery.refetch = async () => { requestRefreshes++; requestsQuery.data = [request('waiting', 'active')]; };
  historyQuery.refetch = async () => { historyRefreshes++; };
  let historyUser, requestsUser, socialProps, bioProps;
  const { default: Profile } = load('app/(tabs)/profile.tsx', {
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
    '@/lib/profile/profilePickGroups': { splitLabPicks: (picks) => ({ main: picks, lab: [] }), isLabCategory: () => false }, '@/components/profile-lab-entry': { ProfileLabEntry: () => null }, '@/lib/home/homeChannels': load('lib/home/homeChannels.ts'),
    '@/lib/share/shareProfile': { shareProfile: async () => {} },
    '@/hooks/useMyProfileLists': {
      useMyPickHistory: (userId) => { historyUser = userId; return historyQuery; },
      useMyItemRequests: (userId) => { requestsUser = userId; return requestsQuery; },
    },
  });
  const render = () => { presses = []; socialProps = undefined; bioProps = undefined; return renderToStaticMarkup(React.createElement(Profile)); };
  const button = (label) => presses.find((props) => textOf(props.children).includes(label));
  const refreshButton = () => presses.find((props) => props.accessibilityLabel === '프로필 새로고침');

  assert.doesNotMatch(render(), /승인 대기|등록 요청|원픽 활동/);
  button('프로필 편집').onPress(); assert.equal(destination, '/profile/edit');
  button('설정').onPress(); assert.equal(destination, '/settings');
  button('댓글 ›').onPress(); assert.equal(destination, '/comments');
  assert.doesNotMatch(render(), /내 댓글/, 'My comments moved to their own bottom tab');

  // The 댓글 bottom tab: signed-out visitors get a login that returns here; members see their list.
  let commentsUser, commentsScope, commentsProps, loginRoute;
  const commentsQuery = listQuery();
  const { default: MyComments } = load('app/comments.tsx', {
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
  const myCommentsScreen = renderMyComments();
  assert.match(myCommentsScreen, /MY_COMMENTS_LIST/); assert.match(myCommentsScreen, /내 댓글/);
  assert.equal(commentsUser, 'owner'); assert.equal(commentsProps.query, commentsQuery);
  assert.equal(presses.filter(props => props.accessibilityRole === 'tab').length, 0);
  assert.equal(commentsScope, undefined, 'All comments are requested without a theme filter');
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
  presses[0].onPress(); assert.equal(destination.pathname, '/item/[itemId]');
  assert.deepEqual({ ...destination.params }, { itemId: 'i1', pickId: 'p1' }, 'Rows open the focused review without the /pick redirect');
  let nextPages = 0;
  Object.assign(myComments, { hasNextPage: true, fetchNextPage: async (options) => { assert.equal(options.cancelRefetch, false); nextPages++; } });
  renderComments(); presses.find((props) => props.accessibilityLabel === '댓글 더 보기').onPress(); assert.equal(nextPages, 1);
  Object.assign(myComments, { data: undefined, isError: true });
  assert.match(renderComments(), /댓글을 불러오지 못했어요/);
  render();
  assert.equal(bioProps, undefined, 'Editing has its own route');
  assert.equal(socialProps.editable, undefined, 'Profile is read-only');
  assert.equal(historyUser, undefined); assert.equal(requestsUser, undefined);
  assert.equal(refreshButton(), undefined);
  await pullToRefresh.props.onRefresh(); assert.equal(refreshes, 1);
  assert.equal(requestRefreshes, 0); assert.equal(historyRefreshes, 0);
  profileQuery.isRefetchError = true;
  assert.match(render(), /마지막으로 확인한 내용을 표시/);
  await refreshButton().onPress(); assert.equal(refreshes, 2);
  profileQuery.isFetching = true; render(); assert.equal(refreshButton().disabled, true);
  profileQuery.isFetching = false; profileQuery.isRefetchError = false;
  requestsQuery.isError = true; historyQuery.isPending = true;
  assert.doesNotMatch(render(), /등록 요청|승인 대기|원픽 활동/);
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
  assert.doesNotMatch(loggedOut, /내 원픽 등록 요청|merged 제품/, 'Logging out must hide cached private requests');
  assert.equal(historyUser, undefined); assert.equal(requestsUser, undefined);
  auth.user = { id: 'owner' }; auth.isLoading = true;
  assert.doesNotMatch(render(), /merged 제품|이전 제품/);
  assert.equal(historyUser, undefined); assert.equal(requestsUser, undefined);
  console.log('Profile privacy and comments passed: no operational/history queries, edit/settings/comments navigation, unfiltered comments pagination, retry and logout privacy.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
