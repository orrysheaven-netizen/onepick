const assert = require('node:assert/strict');
const { load, screen, names } = require('./mvp-screen-harness.cjs');
// onepick.ts reads its platform font family; use the native/default variant like Metro's split.
const constants = load('constants/onepick.ts', { './font-family': load('constants/font-family.ts') });
const homeChannels = load('lib/home/homeChannels.ts');
const flags = constants.OnePickFeatures;
const initialFlags = { ...flags };
const thresholds = constants.OnePickThresholds;
const initialThresholds = { ...thresholds };
let passed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  finally { Object.assign(flags, initialFlags); Object.assign(thresholds, initialThresholds); }
}
const category = (id, parentId = null) => ({ id, parentId, slug: id, name: id, isPickable: Boolean(parentId) });
const catalog = [category('food'), category('culture'), category('ramen', 'food'), category('movie', 'culture')];
const groups = [{ id: 'food', name: 'food', categoryIds: ['ramen'] }, { id: 'culture', name: 'culture', categoryIds: ['movie'] }];
const tree = { categoryLabel: (c) => c.name, selectableCategories: (cs) => cs.filter((c) => c.isPickable), browseCategoryGroups: (cs) => cs.filter((c) => !c.parentId).map((c) => ({ category: c, children: cs.filter((x) => x.parentId === c.id), directlySelectable: false })) };
function query(data) {
  return { data, isSuccess: true, isPending: false, isError: false, isFetching: false, isRefetchError: false,
    isRefetching: false, hasNextPage: false, isFetchNextPageError: false, refetches: 0, nextPages: 0,
    refetch(options) { assert.equal(options.cancelRefetch, false); this.refetches++; return Promise.resolve(); },
    fetchNextPage(options) { assert.equal(options.cancelRefetch, false); this.nextPages++; return Promise.resolve(); } };
}
const picks = (count) => Array.from({ length: count }, (_, i) => ({ pickId: String(i), itemId: `item-${i}`, categoryId: i ? 'ramen' : 'movie' }));
function home(count = 20, followingCount = 0) {
  const auth = { user: { id: 'owner' }, isLoading: false, error: null };
  const q = query({ picks: picks(count), currentPicks: [] });
  const following = query({ items: [], nextCursor: null });
  const followCounts = query({ followingCount, followerCount: 0 });
  const calls = {};
  const view = screen('app/(tabs)/index.tsx', {
    'expo-router': { useRouter: () => ({ push: (route) => { calls.route = route; } }) },
    '@/constants/onepick': constants, '@/components/ui/dialog-labels': require('./dialog-labels.cjs'),
    '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/hooks/useHomeData': { useHomeData: (...args) => { calls.home = args; return q; }, useHomeItemRanking: () => query([]) },
    '@/hooks/useFollow': {
      useFollowCounts: () => followCounts,
      useFollowingFeed: (...args) => { calls.following = args; return following; },
    },
    '@/hooks/useExploreData': { useExploreCategories: () => ({ data: catalog }) },
    '@/lib/categories/categoryTree': tree,
    '@/lib/profile/profilePickGroups': { splitLabPicks: (picks) => ({ main: picks, lab: [] }), filterMainProfileByChannel: (picks) => picks, filterMvpProfilePicks: (picks) => picks, filterPublicMvpProfilePicks: (picks) => picks, publicProfileShareCount: (picks, categories) => (categories ? picks.length : null), isLabCategory: () => false }, '@/components/profile-lab-entry': { ProfileLabEntry: () => null }, '@/lib/home/homeChannels': homeChannels,
    '@/lib/home/homeCategoryFilters': { HOME_FEED_ROOT_SLUG: 'food', buildHomeCategoryFilters: () => groups, homeMenuRankingGroups: () => [], homeStarterCategories: () => [], filterHomeFeedByCategory: (items, group) => group ? items.filter((p) => group.categoryIds.includes(p.categoryId)) : items },
    '@/components/onepick-brand': names('OnePickBrand'), '@/components/notification-button': names('NotificationButton'),
    '@/components/home-pick-row': names('HomePickRow'), '@/components/home-header': names('HomeHeader'), '@/components/recent-item-card': names('RecentItemCard'), '@/components/pick-photo': names('PickPhoto'),
  });
  view.render(); return { view, q, following, followCounts, auth, calls };
}
const recentQuery = (items) => ({ ...query(items), isFetchingNextPage: false });
function explore({ chips = true } = {}) {
  flags.categoryChips = chips;
  const q = query([{ itemId: 'first', name: 'First', rank: 1, pickCount: 2, isTied: true, channels: [] }, { itemId: 'second', name: 'Second', rank: 1, pickCount: 2, isTied: true, channels: [] }]);
  const recent = recentQuery([{ itemId: 'recent', name: 'Recent place', categoryId: 'ramen', categoryName: 'ramen', thumbnailUrl: null, lastPickedAt: '2026-09-26T00:00:00Z', channels: ['offline'] }]);
  const calls = {};
  const view = screen('app/(tabs)/explore.tsx', {
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: null }) },
    'expo-router': { useRouter: () => ({ push: (r) => { calls.route = r; } }), useLocalSearchParams: () => ({ search: chips ? '1' : undefined }) },
    '@/constants/onepick': constants, '@/components/ui/dialog-labels': require('./dialog-labels.cjs'), '@/components/pick-photo': names('PickPhoto'), '@/components/item-search': names('ItemSearch'), '@/components/explore-search-results': names('ExploreSearchResults'),
    '@/hooks/useExploreData': { useExploreCategories: () => query(catalog), useCategoryTopItems: (id) => { calls.categoryId = id; return q; },
      useRecentPickedItems: (ids, enabled, storesOnly) => { calls.recent = { ids, enabled, storesOnly }; return recent; },
      useFoodMenuPickCounts: (channel, enabled) => { calls.menuCounts = { channel, enabled }; return query(new Map([['ramen', 5]])); } },
    '@/lib/categories/categoryTree': tree, '@/lib/profile/profilePickGroups': { splitLabPicks: (picks) => ({ main: picks, lab: [] }), filterMainProfileByChannel: (picks) => picks, filterMvpProfilePicks: (picks) => picks, filterPublicMvpProfilePicks: (picks) => picks, publicProfileShareCount: (picks, categories) => (categories ? picks.length : null), isLabCategory: () => false }, '@/components/profile-lab-entry': { ProfileLabEntry: () => null }, '@/lib/home/homeChannels': homeChannels,
    '@/lib/categories/browseScope': load('lib/categories/browseScope.ts', { '@/lib/categories/categoryTree': tree }),
  });
  view.render();
  if (chips) {
    view.find('Chip', (p) => p.label === 'food').onPress(); view.render();
    view.find('Chip', (p) => p.label === 'ramen').onPress(); view.render();
  }
  return { view, q, recent, calls };
}
function profile(isPublic = false) {
  const q = query({ profile: { id: 'owner', username: 'owner', bio: 'bio' }, currentPicks: [], isMine: false });
  const history = query([]), requests = query([]), calls = { history: 0, requests: 0, taste: 0, ai: 0, aiIds: [] };
  const auth = { user: { id: 'reader' }, isLoading: false };
  const mount = (key) => () => { calls[key]++; return null; };
  const view = screen(isPublic ? 'app/(tabs)/(profile)/u/[username].tsx' : 'app/(tabs)/(profile)/profile.tsx', { '@/lib/navigation/swipeBack': { useSwipeBackHandler() {} },
    'expo-router': {
      useRouter: () => ({ push() {}, back() {}, replace() {}, canGoBack: () => false, dismissTo() {} }),
      useNavigation: () => ({ addListener: () => () => {}, getState: () => ({ index: 0, routes: [] }), dispatch() {} }),
      useLocalSearchParams: () => ({ username: 'owner' }),
    },
    'expo-linking': { createURL: () => 'onepick://auth/callback' },
    '@/constants/onepick': constants, '@/components/ui/dialog-labels': require('./dialog-labels.cjs'), '@/errors/appError': { AppError: class AppError extends Error {} },
    '@/hooks/useAuthSession': { useAuthSession: () => auth }, '@/hooks/useAdmin': { useAdminAccess: () => ({ data: false }) },
    '@/hooks/useSocialSignIn': { useSocialSignIn: () => ({ isPending: false, isError: false, mutateAsync: async () => null }) },
    '@/hooks/useMyProfile': { useMyProfile: () => q }, '@/hooks/usePublicProfile': { usePublicProfile: () => q },
    '@/hooks/useMyProfileLists': { useMyPickHistory: () => { calls.history++; return history; }, useMyItemRequests: () => { calls.requests++; return requests; }, useMyComments: () => query(undefined) },
    '@/hooks/useExploreData': { useExploreCategories: () => ({ data: catalog }) },
    '@/hooks/useProfileAi': { useProfileAiComment: (id) => { calls.aiIds.push(id); return { data: { text: 'cached AI comment' } }; } },
    '@/hooks/useFollow': { usePublicFollowCounts: () => query({ followerCount: 0, followingCount: 0 }) },
    '@/lib/categories/categoryTree': tree, '@/lib/categories/registrationRoute': { registrationRoute: () => '/pick/find' },
    '@/lib/profile/profilePickGroups': { splitLabPicks: (picks) => ({ main: picks, lab: [] }), filterMainProfileByChannel: (picks) => picks, filterMvpProfilePicks: (picks) => picks, filterPublicMvpProfilePicks: (picks) => picks, publicProfileShareCount: (picks, categories) => (categories ? picks.length : null), isLabCategory: () => false }, '@/components/profile-lab-entry': { ProfileLabEntry: () => null }, '@/lib/home/homeChannels': homeChannels,
    '@/lib/seedProfiles': { isSeedProfileId: () => false },
    '@/lib/auth/authIntent': { getPostAuthRoute: () => '/u/owner' },
    '@/lib/auth/followProfileIntent': { armFollowProfileIntent: () => true, clearFollowProfileIntent() {}, consumeFollowProfileIntent: () => false },
    '@/lib/share/shareProfile': { shareProfile: async () => {} },
    '@/lib/profile/profileName': load('lib/profile/profileName.ts'),
    '@/lib/share/shareProfileCard': { shareProfileCardImage: async (payload) => { calls.share = payload; return 'shared'; } },
    '@/components/profile-taste-composition': { ProfileTasteComposition: mount('taste') },
    '@/components/profile-ai-panel': { ProfileAiPanel: mount('ai') }, '@/components/profile-ai-comment': { ProfileAiComment: mount('ai') },
    ...Object.fromEntries(Object.entries({ 'pick-photo': 'PickPhoto', 'profile-bio-editor': 'ProfileBioEditor', 'profile-pick-card': 'ProfilePickCard', 'profile-pick-groups': 'ProfilePickGroups', 'profile-social-links': 'ProfileSocialLinks', 'profile-my-comments': 'ProfileMyComments', 'sign-out-button': 'SignOutButton', 'profile-current-pick-row': 'ProfileCurrentPickRow', 'profile-identity': 'ProfileIdentity', 'profile-tabs': 'ProfileTabs', 'profile-records': 'ProfileRecords', 'block-user-button': 'BlockUserButton', 'follow-button': 'FollowButton', 'follow-connections-view': 'FollowConnectionsView', 'report-action': 'ReportAction' }).map(([file, name]) => [`@/components/${file}`, names(name)])),
  });
  view.render(); return { view, q, history, requests, calls, auth };
}
async function main() {
  await test('MVP flags and thresholds are centralized', () => {
    assert.equal(flags.tasteComposition, false); assert.equal(flags.profileAi, false); assert.equal(flags.exploreRankingDetail, true);
    assert.equal(flags.profileFollow, true, 'MVP exposes the approved public-profile follow CTA');
    assert.equal(flags.followingFeed, false, 'MVP keeps the following feed separately deferred');
    assert.equal(flags.followNotifications, false, 'MVP keeps follow-change notifications separately deferred');
    // #757: the owner-only 기록 tab shows past Picks and pending/rejected requests.
    assert.equal(flags.profilePickHistory, true); assert.equal(flags.profileSocialLinks, false); assert.equal(flags.profileItemRequests, true);
    assert.equal(flags.foodChannelPicker, false, 'Initial MVP keeps online/recipe food registration entries hidden');
    assert.equal(constants.OnePickMvp.publicPickChannel, 'offline'); assert.equal(constants.OnePickMvp.browseGroupSlug, 'food');
    assert.equal(thresholds.exploreRankingMinPicks, 3); assert.equal(thresholds.homeCategoryFilterMinPicks, 20);
  });
  const isChannelChip = (p) => /탭 원픽 보기$/.test(p.accessibilityLabel ?? '');
  const categoryChips = (view) => view.all('Chip').filter((p) => !isChannelChip(p));
  await test('MVP following-feed-off keeps Home public while the preserved rollout gate can restore Following', () => {
    const hidden = home(20, 2);
    assert.equal(hidden.calls.home[2], true, 'Existing follow rows do not change the visible MVP feed');
    assert.equal(hidden.calls.following[1], false);
    assert.equal(hidden.view.find('Pressable', (p) => p.accessibilityLabel === '전체 원픽 보기'), undefined);
    assert.equal(hidden.view.find('Pressable', (p) => p.accessibilityLabel === '팔로잉 원픽 보기'), undefined);

    flags.followingFeed = true;
    const existing = home(20, 2);
    assert.equal(existing.calls.home[2], false, 'A future follow rollout still supports Following-first behavior');
    assert.equal(existing.calls.following[1], true);
    assert.equal(existing.view.find('Pressable', (p) => p.accessibilityLabel === '팔로잉 원픽 보기').accessibilityState.selected, true);
    existing.view.find('Pressable', (p) => p.accessibilityLabel === '전체 원픽 보기').onPress(); existing.view.render();
    assert.equal(existing.calls.home[2], true); assert.equal(existing.calls.following[1], false);
  });
  await test('Home hides at 19 and shows at 20 unfiltered loaded Picks', () => {
    flags.categoryChips = true;
    const { view, q } = home(19); assert.equal(categoryChips(view).length, 0);
    q.data.picks = picks(20); view.render(); assert.equal(categoryChips(view).length, 3);
    view.find('Chip', (p) => p.label === 'culture').onPress(); view.render();
    assert.equal(view.find('FlatList').data.length, 1); assert.equal(categoryChips(view).length, 3);
    q.data.picks = picks(19); view.render();
    assert.equal(view.find('FlatList').data.length, 10, 'No invisible filtering before effects flush; Home caps at ten');
    assert.equal(categoryChips(view).length, 0); view.flushEffects();
    q.data.picks = picks(20); view.render(); assert.equal(view.find('FlatList').data.length, 10);
    assert.equal(view.find('Chip', (p) => p.accessibilityLabel === '전체 카테고리 보기').selected, true);
  });
  await test('MVP Home exposes food + offline only while future channels stay internal', () => {
    const { view, calls } = home(2);
    assert.equal(view.all('Chip').filter(isChannelChip).length, 0, 'No channel switcher is exposed in the initial MVP');
    assert.equal(calls.home[3], 'offline', 'Public Home is server-filtered to physical-store Picks');
    assert.equal(calls.home[4], 'food', 'Public Home stays inside the food root');
    assert.equal(calls.following[1], false, 'Following-feed-off MVP keeps the preserved following query disabled');
    assert.equal(calls.following[2], 'offline', 'Preserved following query keeps the same offline scope');
    assert.equal(calls.following[3], 'food', 'Preserved following query keeps the same food root');
  });
  await test('MVP hides Home category chips even above the Pick threshold', () => {
    flags.categoryChips = false; thresholds.homeCategoryFilterMinPicks = 0;
    const { view } = home(20); assert.equal(categoryChips(view).length, 0);
    assert.equal(view.find('FlatList').data.length, 10, 'Hidden chips never filter the feed; Home shows the newest ten');
    assert.equal(view.find('FlatList').onEndReached, undefined, 'Home never loads more on scroll');
  });
  await test('MVP Explore: no chips, search open, food menus are clickable entry points', () => {
    const { view, calls } = explore({ chips: false });
    assert.equal(view.all('Chip').length, 0);
    assert.match(view.text(), /탐색/); assert.doesNotMatch(view.text(), /상위 카테고리|최근 원픽된 맛집/);
    // Figma 43: the MVP box is the explore's own input (× clear, inline results), not the catalog ItemSearch.
    assert.ok(view.find('TextInput', (p) => p.placeholder === '메뉴나 매장 이름으로 검색'), 'Search starts open without a ?search=1 handoff');
    assert.equal(view.find('ItemSearch'), undefined, 'No external-catalog search (movie etc.) in the food MVP');
    assert.equal(view.find('ExploreSearchResults'), undefined, 'Results appear only after typing');
    assert.equal(JSON.stringify(calls.recent), JSON.stringify({ ids: ['ramen'], enabled: false, storesOnly: false }), 'MVP does not load an unused recent-provider feed');
    assert.equal(calls.categoryId, undefined, 'Product rankings stay idle without a chosen category');
    // Figma 31: menus by current Picks, "원픽 N" from the 3-person threshold, always-open search.
    assert.equal(JSON.stringify(calls.menuCounts), JSON.stringify({ channel: 'offline', enabled: true }), 'Menu counts use the public store channel');
    assert.match(view.text(), /메뉴 1/); assert.match(view.text(), /ramen/); assert.match(view.text(), /원픽 5/);
    assert.doesNotMatch(view.text(), /원픽 보기|전체 항목 검색|원픽에 등록된 항목을 검색해요/);
    assert.equal(view.all('Pressable').some((p) => p.accessibilityLabel === '검색 열기' || p.accessibilityLabel === '검색 닫기'), false, 'No search toggle in the MVP');
    view.find('Pressable', (p) => p.accessibilityLabel === 'ramen 메뉴 원픽 보기').onPress();
    assert.equal(calls.route.pathname, '/menu/[slug]'); assert.equal(calls.route.params.slug, 'ramen');
    assert.doesNotMatch(view.text(), /Recent place/, 'Menu discovery replaces the old recent-provider landing list');
  });
  await test('Home restoration threshold and signed-out header stay compatible with recent ranking', () => {
    flags.categoryChips = true;
    thresholds.homeCategoryFilterMinPicks = 0;
    const { view, auth } = home(2); assert.equal(categoryChips(view).length, 3);
    assert.equal(view.all('Avatar').length, 0); assert.equal(view.all('NotificationButton').length, 0); // header is logo only for members too
    auth.user = null; view.render();
    assert.equal(view.all('Avatar').length, 0); assert.equal(view.all('NotificationButton').length, 0);
    assert.equal(view.find('SectionHeader', (p) => p.title === '최근 7일 많이 고른 메뉴'), undefined); // Figma 30-1: no ranking title
    assert.equal(view.all('HomeHeader').length, 1);
    assert.equal(view.find('SectionHeader', (p) => p.title === '먼저 소개하는 원픽'), undefined);
  });
  await test('Home normal refresh hidden; pull, initial error, stale error and pagination retries survive', () => {
    const { view, q } = home(); assert.equal(view.find('Button', (p) => p.accessibilityLabel === '홈 원픽 새로고침'), undefined);
    view.find('RefreshControl').onRefresh(); assert.equal(q.refetches, 1);
    q.isError = true; view.render(); view.find('Button', (p) => p.accessibilityLabel === '홈 원픽 새로고침').onPress(); assert.equal(q.refetches, 2);
    q.isFetching = true; view.render(); const retry = view.find('Button', (p) => p.accessibilityLabel === '홈 원픽 새로고침'); assert.equal(retry.disabled, true); retry.onPress(); assert.equal(q.refetches, 2);
    q.isFetching = false; q.data = undefined; view.render(); view.find('StateCard', (p) => p.tone === 'danger').action.onPress(); assert.equal(q.refetches, 3);
    q.data = { picks: picks(2), currentPicks: [] }; q.isFetchNextPageError = true; view.render();
    assert.equal(view.find('StateCard', (p) => p.action?.label === '다음 원픽 다시 불러오기'), undefined, 'Home has no next page to retry');
    assert.equal(q.nextPages, 0);
  });
  await test('Explore hides tied counts, emphasis and accessible rank; keeps detail routes', () => {
    const { view, calls } = explore(); assert.equal(calls.categoryId, 'ramen');
    assert.doesNotMatch(view.text(), /TOP 3|공동|명이 선택|사람 수 기준/);
    assert.ok(view.find('SectionHeader', (p) => p.title === 'ramen의 원픽'));
    assert.equal(view.all('View').some((p) => Array.isArray(p.style) && p.style.some((s) => s?.backgroundColor === constants.OnePick.accentSoft)), false);
    const card = view.find('Pressable', (p) => p.accessibilityLabel === 'First, 상세 보기'); assert.ok(card); card.onPress(); assert.equal(calls.route.params.itemId, 'first');
  });
  await test('Explore shows at 3, hides with flag off and honors configurable threshold', () => {
    const { view, q } = explore(); q.data[0].pickCount = 3; q.data[0].isTied = false; q.data[1].rank = 2; q.data[1].isTied = false; view.render();
    assert.match(view.text(), /TOP 3/); assert.match(view.text(), /3\s*명이 선택/); assert.match(view.text(), /같은 선택 수/);
    assert.ok(view.find('Pressable', (p) => p.accessibilityLabel === '1위 First, 3명이 선택, 상세 보기'));
    flags.exploreRankingDetail = false; view.render(); assert.doesNotMatch(view.text(), /TOP 3|명이 선택|공동/);
    flags.exploreRankingDetail = true; thresholds.exploreRankingMinPicks = 4; view.render(); assert.doesNotMatch(view.text(), /TOP 3/);
    q.data = []; view.render(); assert.match(view.text(), /아직 선택된 원픽이 없어요/); assert.doesNotMatch(view.text(), /TOP 3/);
  });
  await test('Explore uses rank-1 count rather than first array entry or total', () => {
    const { view, q } = explore(); q.data = [{ ...q.data[0], rank: 2, pickCount: 2 }, { ...q.data[1], rank: 1, pickCount: 3 }]; view.render();
    assert.match(view.text(), /TOP 3/);
  });
  await test('Explore error retry works without header action and protects active requests', () => {
    const { view, q } = explore(); assert.equal(view.find('SectionHeader').action, undefined);
    q.isError = true; view.render(); let retry = view.find('StateCard', (p) => p.tone === 'danger');
    assert.match(retry.text, /마지막으로 불러온/); retry.action.onPress(); assert.equal(q.refetches, 1);
    assert.equal(view.all('PickPhoto').length, 2);
    q.data = undefined; view.render(); retry = view.find('StateCard', (p) => p.tone === 'danger'); retry.action.onPress(); assert.equal(q.refetches, 2);
    q.isFetching = true; view.render(); retry = view.find('StateCard', (p) => p.tone === 'danger'); assert.equal(retry.action.disabled, true); retry.action.onPress(); assert.equal(q.refetches, 2);
  });
  await test('Explore external hint matches available category callbacks', () => {
    const { view } = explore(); assert.match(view.text(), /원픽에 등록된 항목을 검색해요/); assert.equal(view.find('ItemSearch').onSearchMovie, undefined);
    view.find('Chip', (p) => p.label === 'culture').onPress(); view.render(); view.find('Chip', (p) => p.label === 'movie').onPress(); view.render();
    assert.match(view.text(), /외부 카탈로그/); assert.equal(typeof view.find('ItemSearch').onSearchMovie, 'function'); assert.doesNotMatch(view.text(), /외부 DB/);
  });
  await test('Owner profile opens on 원픽 and keeps both 기록 queries scoped to the owner', () => {
    const { view, calls } = profile(); assert.doesNotMatch(view.text(), /활동 기록|내 원픽 등록 요청|원픽 활동|PROFILE TOOLS|ACTIVITY|내 프로필 관리/);
    assert.equal(calls.history, 1); assert.equal(calls.requests, 1); assert.equal(calls.ai, 0); assert.equal(calls.taste, 0);
    assert.equal(view.find('ProfileTabs').value, 'picks'); assert.equal(view.all('ProfileRecords').length, 0);
    assert.equal(view.all('ProfileBioEditor').length, 0, 'The bio editor waits for 프로필 편집');
    assert.equal(view.all('SignOutButton').length, 0, 'Sign-out lives in Settings (#757)');
    view.find('Button', (p) => p.label === '프로필 편집').onPress(); view.render();
    assert.equal(view.all('ProfileBioEditor').length, 1); assert.equal(view.all('ProfileSocialLinks').length, 0);
    view.find('Button', (p) => p.label === '프로필 편집').onPress(); view.render();
    assert.equal(view.all('ProfileBioEditor').length, 1, 'Closing 프로필 편집 hides the editor without unmounting its draft');
    view.find('ProfileTabs').onChange('records'); view.render();
    assert.equal(view.all('ProfileRecords').length, 1);
  });
  await test('Owner header refresh retries the profile and both 기록 lists on refetch error', async () => {
    const { view, q, history, requests } = profile(); q.isRefetchError = true; view.render();
    await view.find('Button', (p) => p.accessibilityLabel === '프로필과 원픽 등록 요청 상태 새로고침').onPress();
    assert.equal(q.refetches, 1); assert.equal(history.refetches, 1); assert.equal(requests.refetches, 1);
    flags.profilePickHistory = false; flags.profileItemRequests = false; view.render();
    await view.find('Button', (p) => p.accessibilityLabel === '프로필 새로고침').onPress();
    assert.equal(q.refetches, 2); assert.equal(history.refetches, 1, 'A gated-off list is not refetched'); assert.equal(requests.refetches, 1);
  });
  await test('Social links stay hidden until restored', () => {
    const owner = profile();
    owner.view.find('Button', (p) => p.label === '프로필 편집').onPress(); owner.view.render();
    assert.equal(owner.view.all('ProfileSocialLinks').length, 0);
    flags.profileSocialLinks = true; owner.view.render(); assert.equal(owner.view.all('ProfileSocialLinks').length, 1);
    flags.profileSocialLinks = false; const visitor = profile(true); assert.equal(visitor.view.all('ProfileSocialLinks').length, 0);
    flags.profileSocialLinks = true; visitor.view.render(); assert.equal(visitor.view.all('ProfileSocialLinks').length, 1);
  });
  await test('Both profile features can be restored independently', () => {
    for (const isPublic of [false, true]) for (const taste of [false, true]) for (const ai of [false, true]) {
      flags.tasteComposition = taste; flags.profileAi = ai;
      const { calls } = profile(isPublic); assert.equal(calls.taste, Number(taste)); assert.equal(calls.ai, Number(ai));
      if (isPublic) assert.equal(calls.aiIds[0], ai ? 'owner' : undefined);
    }
  });
  await test('Public profile suppresses cached AI, keeps safety/share, and exposes approved follow CTA', async () => {
    const { view, calls, auth } = profile(true); assert.equal(calls.aiIds[0], undefined); assert.equal(calls.ai, 0); assert.equal(calls.taste, 0);
    assert.equal(view.all('FollowButton').length, 1); assert.equal(view.all('ReportAction').length, 1); assert.equal(view.all('BlockUserButton').length, 1);
    flags.profileFollow = false; view.render(); assert.equal(view.all('FollowButton').length, 0, 'Profile follow can still be independently disabled');
    flags.profileFollow = true; view.render(); assert.equal(view.all('FollowButton').length, 1);
    view.find('Pressable', (p) => p.accessibilityLabel === '프로필 공유').onPress(); await new Promise(setImmediate); assert.equal(calls.share.aiComment, null);
    auth.user = null; view.render(); assert.doesNotMatch(view.text(), /AI 취향평가도/); assert.match(view.text(), /내 원픽 만들기/);
    flags.profileAi = true; view.render(); assert.match(view.text(), /AI 취향평가도/);
    view.find('Pressable', (p) => p.accessibilityLabel === '프로필 공유').onPress(); await new Promise(setImmediate); assert.equal(calls.share.aiComment.text, 'cached AI comment');
  });
  await test('Actual AI comment hook disables automatic requests without a profile ID', () => {
    let calls = 0;
    const { useProfileAiComment } = load('hooks/useProfileAi.ts', {
      '@tanstack/react-query': { useQuery: (options) => options },
      '@/services/profileAiService': { profileAiService: { getComment: (id) => { calls++; return id; } } },
    });
    const disabled = useProfileAiComment(undefined);
    assert.equal(disabled.enabled, false); assert.equal(calls, 0);
    const enabled = useProfileAiComment('owner');
    assert.equal(enabled.enabled, true); assert.equal(enabled.queryFn(), 'owner'); assert.equal(calls, 1);
  });
  console.log(`MVP prelaunch runtime cases passed: ${passed}/${passed}. Host/hook harness; no live network or browser.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
