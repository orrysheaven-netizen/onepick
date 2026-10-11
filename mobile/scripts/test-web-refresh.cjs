// Synthetic hook/host tests of the real screens, not authenticated browser QA.
const assert = require('node:assert/strict');
const { load, screen, names } = require('./mvp-screen-harness.cjs');
// onepick.ts reads its platform font family; use the native/default variant like Metro's split.
const constants = load('constants/onepick.ts', { './font-family': load('constants/font-family.ts') });
constants.OnePickFeatures.categoryChips = true; // Explore fixtures below select a category chip.
const category = { id: 'ramen', slug: 'ramen', name: '라면', parentId: null, isPickable: true };
const homeLabel = '홈 원픽 새로고침';
const followingLabel = '팔로잉 원픽 새로고침';
const profileLabel = '프로필과 원픽 등록 요청 상태 새로고침';
const hiddenListsProfileLabel = '프로필 새로고침';
const button = (view, label) => view.find('Button', (p) => p.accessibilityLabel === label);
function query(data) {
  return {
    data, isSuccess: true, isPending: false, isError: false, isFetching: false,
    isRefetchError: false, isRefetching: false, hasNextPage: false, isFetchNextPageError: false,
    refetches: 0, nextPages: 0,
    refetch(options) { assert.equal(options.cancelRefetch, false); this.refetches++; return Promise.resolve(); },
    fetchNextPage(options) { assert.equal(options.cancelRefetch, false); this.nextPages++; return Promise.resolve(); },
  };
}
function fixture(kind, platform = 'web') {
  const auth = { user: { id: 'owner' }, isLoading: false, error: null, retry() {} };
  const home = query({ picks: [{ pickId: 'pick', itemId: 'item', categoryId: 'ramen' }], currentPicks: [] });
  const following = query({ items: [], nextCursor: null });
  const profile = query({ profile: { id: 'owner', username: 'owner', bio: '' }, currentPicks: [] });
  const history = query([]), requests = query([]), categories = query([category]);
  categories.refetch = function () { this.refetches++; return Promise.resolve(); };
  const top = query([{ itemId: 'item', name: '선택된 라면', rank: 1, pickCount: 2, isTied: false, channels: [] }]);
  const calls = {};
  const components = {
    'onepick-brand': 'OnePickBrand', 'notification-button': 'NotificationButton',
    'home-feed-card': 'HomeFeedCard', 'home-pick-row': 'HomePickRow', 'home-header': 'HomeHeader', 'recent-item-card': 'RecentItemCard', 'item-search': 'ItemSearch', 'explore-search-results': 'ExploreSearchResults', 'pick-photo': 'PickPhoto',
    'profile-bio-editor': 'ProfileBioEditor', 'profile-pick-card': 'ProfilePickCard',
    'profile-pick-groups': 'ProfilePickGroups', 'profile-ai-panel': 'ProfileAiPanel',
    'profile-social-links': 'ProfileSocialLinks', 'profile-follow-counts': 'ProfileFollowCounts', 'profile-my-comments': 'ProfileMyComments',
    'profile-taste-composition': 'ProfileTasteComposition', 'sign-out-button': 'SignOutButton',
  };
  const screenPath = kind === 'profile'
    ? 'app/(tabs)/(profile)/profile.tsx'
    : `app/(tabs)/${kind === 'home' ? 'index' : kind}.tsx`;
  const view = screen(screenPath, {
    'expo-router': { useRouter: () => ({ push() {} }), useLocalSearchParams: () => ({}) },
    '@/constants/onepick': constants,
    '@/errors/appError': { AppError: class AppError extends Error {} },
    '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/hooks/useHomeData': { useHomeData: (...args) => { calls.home = args; return home; }, useHomeItemRanking: () => query([]) },
    '@/hooks/useFollow': {
      useFollowCounts: () => query({ followingCount: 0, followerCount: 0 }),
      useFollowingFeed: (...args) => { calls.following = args; return following; },
    },
    '@/hooks/useExploreData': { useExploreCategories: () => categories, useCategoryTopItems: (id) => { calls.categoryId = id; return top; },
      useRecentPickedItems: () => ({ ...query([]), isFetchingNextPage: false }), useFoodMenuPickCounts: () => query(new Map()) },
    '@/lib/categories/browseScope': { browseScope: () => ({ showChips: true, leafIds: null }) },
    '@/hooks/useMyProfile': { useMyProfile: () => profile },
    '@/hooks/useMyProfileLists': { useMyPickHistory: (id) => { calls.historyId = id; return history; }, useMyItemRequests: (id) => { calls.requestsId = id; return requests; }, useMyComments: () => query(undefined) },
    '@/hooks/useAdmin': { useAdminAccess: () => ({ data: false }) },
    '@/lib/categories/categoryTree': { categoryLabel: (c) => c.name, selectableCategories: (cs) => cs,
      browseCategoryGroups: (cs) => cs.map((c) => ({ category: c, children: [], directlySelectable: true })) },
    '@/lib/categories/registrationRoute': { registrationRoute: () => '/pick/find' },
    '@/lib/profile/profileAvatar': { profileAvatarUrl: () => null }, '@/lib/profile/profilePickGroups': { splitLabPicks: (picks) => ({ main: picks, lab: [] }), filterMainProfileByChannel: (picks) => picks, isLabCategory: () => false }, '@/components/profile-lab-entry': { ProfileLabEntry: () => null }, '@/lib/home/homeChannels': load('lib/home/homeChannels.ts'),
    '@/lib/share/shareProfile': { shareProfile: async () => {} },
    '@/lib/home/homeCategoryFilters': { buildHomeCategoryFilters: () => [], homeMenuRankingGroups: () => [], homeStarterCategories: () => [], filterHomeFeedByCategory: (picks) => picks },
    ...Object.fromEntries(Object.entries(components).map(([file, name]) => [`@/components/${file}`, names(name)])),
  }, platform);
  view.render();
  if (kind === 'explore') { view.find('Chip', (p) => p.label === '라면').onPress(); view.render(); }
  return { view, auth, home, following, profile, history, requests, categories, top, calls };
}
let passed = 0;
const flags = constants.OnePickFeatures;
const initialFlags = { ...flags };
async function test(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); } finally { Object.assign(flags, initialFlags); }
}
async function main() {
  await test('Web Home refreshes public data for members and visitors, including empty results', () => {
    const { view, auth, home, following } = fixture('home');
    for (const user of [{ id: 'owner' }, null]) {
      auth.user = user;
      for (const picks of [home.data.picks, []]) {
        home.data.picks = picks; view.render();
        const refresh = button(view, homeLabel); assert.ok(refresh); assert.equal(refresh.label, '새로고침');
        assert.equal(view.all('Text').some((p) => p.accessibilityRole === 'alert'), false);
        const before = home.refetches; refresh.onPress(); assert.equal(home.refetches, before + 1);
        assert.equal(following.refetches, 0);
      }
    }
    home.isFetching = true; view.render();
    assert.equal(button(view, homeLabel).disabled, true);
    const before = home.refetches; button(view, homeLabel).onPress(); assert.equal(home.refetches, before);
    home.isFetching = false;
    auth.isLoading = true; view.render(); assert.equal(button(view, homeLabel), undefined);
    auth.isLoading = false; auth.error = new Error('offline'); view.render(); assert.equal(button(view, homeLabel), undefined);
  });
  await test('Preserved Web following refresh works when the future rollout gate is enabled', () => {
    flags.followingFeed = true;
    const { view, home, following, auth, calls } = fixture('home');
    view.find('Pressable', (p) => p.accessibilityLabel === '팔로잉 원픽 보기').onPress(); view.render();
    assert.equal(calls.home[2], false); assert.equal(calls.following[1], true);
    assert.equal(button(view, homeLabel), undefined); assert.ok(button(view, followingLabel));
    button(view, followingLabel).onPress(); assert.equal(following.refetches, 1); assert.equal(home.refetches, 0);
    following.isFetching = true; view.render(); assert.equal(button(view, followingLabel).disabled, true);
    button(view, followingLabel).onPress(); assert.equal(following.refetches, 1);
    following.isFetching = false; following.isError = true; view.render();
    assert.equal(button(view, followingLabel).label, '다시 불러오기');
    button(view, followingLabel).onPress(); assert.equal(following.refetches, 2);
    following.data = undefined; view.render(); assert.equal(button(view, followingLabel), undefined);
    view.find('StateCard', (p) => p.tone === 'danger').action.onPress(); assert.equal(following.refetches, 3);
    following.data = { items: [] }; auth.error = new Error('offline'); view.render();
    assert.equal(button(view, followingLabel), undefined);
    auth.error = null; auth.user = null; view.render();
    assert.equal(button(view, followingLabel), undefined); assert.ok(button(view, homeLabel));
  });
  await test('Web Home preserves stale-data retry and independent next-page retry', () => {
    const { view, home } = fixture('home');
    home.isError = true; view.render(); assert.equal(button(view, homeLabel).label, '다시 불러오기');
    assert.match(view.text(), /마지막으로 불러온 내용/); assert.equal(view.all('HomePickRow').length, 1);
    assert.equal(view.all('Button').filter((p) => p.accessibilityLabel === homeLabel).length, 1);
    button(view, homeLabel).onPress(); assert.equal(home.refetches, 1);
    home.isFetchNextPageError = true; view.render(); assert.equal(button(view, homeLabel).label, '새로고침');
    // Home shows ten Picks and never pages (10-04); the full feed owns pagination.
    assert.equal(view.find('StateCard', (p) => p.action?.label === '다음 원픽 다시 불러오기'), undefined);
    assert.equal(home.nextPages, 0); assert.equal(home.refetches, 1);
    home.isFetching = true; view.render(); button(view, homeLabel).onPress(); assert.equal(home.refetches, 1);
    home.isFetching = false; home.isError = false; home.isFetchNextPageError = false; view.render();
    assert.ok(button(view, homeLabel)); assert.doesNotMatch(view.text(), /마지막으로 불러온 내용/);
    home.data = undefined; home.isError = true; view.render(); assert.equal(button(view, homeLabel), undefined);
    view.find('StateCard', (p) => p.tone === 'danger').action.onPress(); assert.equal(home.refetches, 2);
  });
  await test('Web Explore has a neutral refresh action, including empty results, without duplicate error actions', () => {
    const { view, top, calls } = fixture('explore');
    const action = () => view.find('SectionHeader')?.action;
    assert.equal(calls.categoryId, 'ramen'); assert.equal(action().accessibilityLabel, '카테고리 원픽 새로고침');
    assert.doesNotMatch(action().accessibilityLabel, /순위|TOP/);
    action().onPress(); assert.equal(top.refetches, 1);
    top.isFetching = true; view.render(); assert.equal(action().disabled, true); action().onPress(); assert.equal(top.refetches, 1);
    top.isFetching = false; top.isError = true; view.render(); assert.equal(action(), undefined);
    assert.equal(view.all('PickPhoto').length, 1);
    const retry = () => view.find('StateCard', (p) => p.tone === 'danger').action;
    retry().onPress(); assert.equal(top.refetches, 2);
    top.isFetching = true; view.render(); assert.equal(retry().disabled, true); retry().onPress(); assert.equal(top.refetches, 2);
    top.isFetching = false; top.isError = false; top.data = []; view.render(); assert.ok(action());
    action().onPress(); assert.equal(top.refetches, 3); assert.match(view.text(), /아직 선택된 원픽이 없어요/);
    top.data = undefined; top.isPending = true; view.render(); assert.equal(action(), undefined);
    view.find('Chip', (p) => p.label === '전체').onPress(); view.render();
    assert.equal(view.find('SectionHeader').title, '최근 원픽된 항목', 'Clearing the category swaps rankings for the recent list');
  });
  await test('Web profile refresh updates all three queries and reveals newly arrived request status', async () => {
    flags.profilePickHistory = true; flags.profileItemRequests = true;
    const { view, profile, history, requests, calls } = fixture('profile');
    assert.doesNotMatch(view.text(), /활동 기록/); assert.ok(button(view, profileLabel));
    const originalRefetch = requests.refetch;
    requests.refetch = function (options) {
      this.data = [{ item: { id: 'request', name: '새 제품', status: 'pending' }, category }];
      return originalRefetch.call(this, options);
    };
    await button(view, profileLabel).onPress(); view.render(); assert.match(view.text(), /승인 대기/);
    requests.refetch = function (options) { this.data[0].item.status = 'active'; return originalRefetch.call(this, options); };
    await button(view, profileLabel).onPress(); view.render(); assert.match(view.text(), /승인됨/);
    assert.deepEqual([profile.refetches, history.refetches, requests.refetches], [2, 2, 2]);
    assert.equal(calls.historyId, 'owner'); assert.equal(calls.requestsId, 'owner');
    assert.equal(view.all('ProfileAiPanel').length, 0); assert.equal(view.all('ProfileTasteComposition').length, 0);
  });
  await test('Web profile refresh skips the hidden activity lists', async () => {
    const { view, profile, history, requests, calls } = fixture('profile');
    assert.equal(button(view, profileLabel), undefined);
    await button(view, hiddenListsProfileLabel).onPress(); assert.deepEqual([profile.refetches, history.refetches, requests.refetches], [1, 0, 0]);
    assert.equal(calls.historyId, undefined); assert.equal(calls.requestsId, undefined);
  });
  await test('Web profile refresh is disabled while any related query fetches', async () => {
    flags.profilePickHistory = true; flags.profileItemRequests = true;
    const { view, profile, history, requests } = fixture('profile');
    for (const busy of [profile, history, requests]) {
      busy.isFetching = true; view.render(); assert.equal(button(view, profileLabel).disabled, true);
      await button(view, profileLabel).onPress();
      assert.deepEqual([profile.refetches, history.refetches, requests.refetches], [0, 0, 0]);
      busy.isFetching = false;
    }
    profile.isRefetchError = true; view.render(); assert.equal(button(view, profileLabel).label, '다시 불러오기');
    assert.equal(view.all('Button').filter((p) => p.accessibilityLabel === profileLabel).length, 1);
    await button(view, profileLabel).onPress(); assert.deepEqual([profile.refetches, history.refetches, requests.refetches], [1, 1, 1]);
    profile.isRefetchError = false; view.render(); assert.equal(button(view, profileLabel).label, '새로고침');
  });
  await test('Web profile refresh never bypasses session, missing data or loading gates', () => {
    flags.profilePickHistory = true; flags.profileItemRequests = true;
    const { view, auth, profile, calls } = fixture('profile');
    auth.user = null; view.render(); assert.equal(button(view, profileLabel), undefined);
    assert.equal(calls.historyId, undefined); assert.equal(calls.requestsId, undefined);
    auth.user = { id: 'owner' }; auth.isLoading = true; view.render(); assert.equal(button(view, profileLabel), undefined);
    auth.isLoading = false; auth.error = new Error('offline'); view.render(); assert.equal(button(view, profileLabel), undefined);
    auth.error = null; profile.data = undefined; profile.isPending = true; view.render(); assert.equal(button(view, profileLabel), undefined);
    profile.isPending = false; profile.isError = true; view.render(); assert.equal(button(view, profileLabel), undefined);
    assert.match(view.text(), /프로필을 불러오지 못했어요/);
  });
  await test('Native iOS and Android keep pull refresh instead of normal manual controls', async () => {
    flags.profilePickHistory = true; flags.profileItemRequests = true; flags.followingFeed = true;
    for (const platform of ['ios', 'android']) {
      const h = fixture('home', platform); assert.equal(button(h.view, homeLabel), undefined);
      h.view.find('RefreshControl').onRefresh(); assert.equal(h.home.refetches, 1);
      h.view.find('Pressable', (p) => p.accessibilityLabel === '팔로잉 원픽 보기').onPress(); h.view.render();
      assert.equal(button(h.view, followingLabel), undefined); h.view.find('RefreshControl').onRefresh(); assert.equal(h.following.refetches, 1);
      const e = fixture('explore', platform); assert.equal(e.view.find('SectionHeader').action, undefined);
      e.view.find('RefreshControl').onRefresh(); assert.equal(e.top.refetches, 1); assert.equal(e.categories.refetches, 1);
      const p = fixture('profile', platform); assert.equal(button(p.view, profileLabel), undefined);
      await p.view.find('RefreshControl').onRefresh(); assert.deepEqual([p.profile.refetches, p.history.refetches, p.requests.refetches], [1, 1, 1]);
      p.profile.isRefetchError = true; p.view.render(); assert.ok(button(p.view, profileLabel));
    }
  });
  console.log(`Web refresh runtime cases passed: ${passed}/${passed}. Synthetic hooks/hosts only; no live account or browser.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
