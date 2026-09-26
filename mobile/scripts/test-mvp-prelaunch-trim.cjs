const assert = require('node:assert/strict');
const { load, screen, names } = require('./mvp-screen-harness.cjs');
// onepick.ts reads its platform font family; use the native/default variant like Metro's split.
const constants = load('constants/onepick.ts', { './font-family': load('constants/font-family.ts') });
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
function home(count = 20) {
  const auth = { user: { id: 'owner' }, isLoading: false, error: null };
  const q = query({ picks: picks(count), currentPicks: [], editorialItems: [] });
  const following = query({ items: [], nextCursor: null });
  const calls = {};
  const view = screen('app/(tabs)/index.tsx', {
    'expo-router': { useRouter: () => ({ push: (route) => { calls.route = route; } }) },
    '@/constants/onepick': constants,
    '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/hooks/useHomeData': { useHomeData: (...args) => { calls.home = args; return q; } },
    '@/hooks/useFollow': { useFollowingFeed: (...args) => { calls.following = args; return following; } },
    '@/hooks/useExploreData': { useExploreCategories: () => ({ data: catalog }) },
    '@/lib/categories/categoryTree': tree,
    '@/lib/home/homeChannels': { HOME_CHANNEL_TABS: [{ channel: null, label: '전체' }, { channel: 'offline', label: '매장' }, { channel: 'online', label: '온라인' }] },
    '@/lib/home/homeCategoryFilters': { buildHomeCategoryFilters: () => groups, homeStarterCategories: () => [], filterHomeFeedByCategory: (items, group) => group ? items.filter((p) => group.categoryIds.includes(p.categoryId)) : items },
    '@/components/onepick-brand': names('OnePickBrand'), '@/components/notification-button': names('NotificationButton'),
    '@/components/home-feed-card': names('HomeFeedCard'), '@/components/item-search': names('ItemSearch'), '@/components/pick-photo': names('PickPhoto'),
  });
  view.render(); return { view, q, following, auth, calls };
}
const recentQuery = (items) => ({ ...query(items), isFetchingNextPage: false });
function explore({ chips = true } = {}) {
  flags.categoryChips = chips;
  const q = query([{ itemId: 'first', name: 'First', rank: 1, pickCount: 2, isTied: true }, { itemId: 'second', name: 'Second', rank: 1, pickCount: 2, isTied: true }]);
  const recent = recentQuery([{ itemId: 'recent', name: 'Recent place', categoryId: 'ramen', categoryName: 'ramen', thumbnailUrl: null, lastPickedAt: '2026-09-26T00:00:00Z' }]);
  const calls = {};
  const view = screen('app/(tabs)/explore.tsx', {
    'expo-router': { useRouter: () => ({ push: (r) => { calls.route = r; } }), useLocalSearchParams: () => ({ search: chips ? '1' : undefined }) },
    '@/constants/onepick': constants, '@/components/pick-photo': names('PickPhoto'), '@/components/item-search': names('ItemSearch'),
    '@/hooks/useExploreData': { useExploreCategories: () => query(catalog), useCategoryTopItems: (id) => { calls.categoryId = id; return q; },
      useRecentPickedItems: (ids, enabled) => { calls.recent = { ids, enabled }; return recent; } },
    '@/lib/categories/categoryTree': tree,
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
  const view = screen(isPublic ? 'app/u/[username].tsx' : 'app/(tabs)/profile.tsx', {
    'expo-router': { useRouter: () => ({ push() {}, back() {}, replace() {} }), useLocalSearchParams: () => ({ username: 'owner' }) },
    '@/constants/onepick': constants, '@/errors/appError': { AppError: class AppError extends Error {} },
    '@/hooks/useAuthSession': { useAuthSession: () => auth }, '@/hooks/useAdmin': { useAdminAccess: () => ({ data: false }) },
    '@/hooks/useMyProfile': { useMyProfile: () => q }, '@/hooks/usePublicProfile': { usePublicProfile: () => q },
    '@/hooks/useMyProfileLists': { useMyPickHistory: () => { calls.history++; return history; }, useMyItemRequests: () => { calls.requests++; return requests; }, useMyComments: () => query(undefined) },
    '@/hooks/useExploreData': { useExploreCategories: () => ({ data: catalog }) },
    '@/hooks/useProfileAi': { useProfileAiComment: (id) => { calls.aiIds.push(id); return { data: { text: 'cached AI comment' } }; } },
    '@/lib/categories/categoryTree': tree, '@/lib/categories/registrationRoute': { registrationRoute: () => '/pick/find' },
    '@/lib/seedProfiles': { isSeedProfileId: () => false },
    '@/lib/share/shareProfile': { shareProfile: async () => {} },
    '@/lib/share/shareProfileCard': { shareProfileCardImage: async (payload) => { calls.share = payload; return 'shared'; } },
    '@/components/profile-taste-composition': { ProfileTasteComposition: mount('taste') },
    '@/components/profile-ai-panel': { ProfileAiPanel: mount('ai') }, '@/components/profile-ai-comment': { ProfileAiComment: mount('ai') },
    ...Object.fromEntries(Object.entries({ 'pick-photo': 'PickPhoto', 'profile-bio-editor': 'ProfileBioEditor', 'profile-pick-card': 'ProfilePickCard', 'profile-pick-groups': 'ProfilePickGroups', 'profile-social-links': 'ProfileSocialLinks', 'profile-follow-counts': 'ProfileFollowCounts', 'profile-my-comments': 'ProfileMyComments', 'sign-out-button': 'SignOutButton', 'block-user-button': 'BlockUserButton', 'follow-button': 'FollowButton', 'report-action': 'ReportAction' }).map(([file, name]) => [`@/components/${file}`, names(name)])),
  });
  view.render(); return { view, q, history, requests, calls, auth };
}
async function main() {
  await test('MVP flags and thresholds are centralized', () => {
    assert.equal(flags.tasteComposition, false); assert.equal(flags.profileAi, false); assert.equal(flags.exploreRankingDetail, true);
    assert.equal(flags.profilePickHistory, false); assert.equal(flags.profileSocialLinks, false); assert.equal(flags.profileItemRequests, false);
    assert.equal(thresholds.exploreRankingMinPicks, 3); assert.equal(thresholds.homeCategoryFilterMinPicks, 20);
  });
  const isChannelChip = (p) => /탭 원픽 보기$/.test(p.accessibilityLabel ?? '');
  const categoryChips = (view) => view.all('Chip').filter((p) => !isChannelChip(p));
  await test('Home starts at all; scope switching preserves exclusive query gating', () => {
    const { view, calls } = home(); assert.equal(calls.home[2], true); assert.equal(calls.following[1], false);
    view.find('Pressable', (p) => p.accessibilityLabel === '팔로잉 원픽 보기').onPress(); view.render();
    assert.equal(calls.home[2], false); assert.equal(calls.following[1], true);
    view.find('Pressable', (p) => p.accessibilityLabel === '전체 원픽 보기').onPress(); view.render();
    assert.equal(calls.home[2], true); assert.equal(calls.following[1], false);
  });
  await test('Home hides at 19 and shows at 20 unfiltered loaded Picks', () => {
    flags.categoryChips = true;
    const { view, q } = home(19); assert.equal(categoryChips(view).length, 0);
    q.data.picks = picks(20); view.render(); assert.equal(categoryChips(view).length, 3);
    view.find('Chip', (p) => p.label === 'culture').onPress(); view.render();
    assert.equal(view.find('FlatList').data.length, 1); assert.equal(categoryChips(view).length, 3);
    q.data.picks = picks(19); view.render();
    assert.equal(view.find('FlatList').data.length, 19, 'No invisible filtering before effects flush');
    assert.equal(categoryChips(view).length, 0); view.flushEffects();
    q.data.picks = picks(20); view.render(); assert.equal(view.find('FlatList').data.length, 20);
    assert.equal(view.find('Chip', (p) => p.accessibilityLabel === '전체 카테고리 보기').selected, true);
  });
  await test('Home 매장/온라인 tabs request a server-filtered feed and default to all', () => {
    const { view, calls } = home(2);
    assert.deepEqual(view.all('Chip').filter(isChannelChip).map((p) => p.label), ['전체', '매장', '온라인']);
    assert.equal(calls.home[3], null, 'Home starts on the unfiltered 전체 tab');
    view.find('Chip', (p) => p.accessibilityLabel === '매장 탭 원픽 보기').onPress(); view.render();
    assert.equal(calls.home[3], 'offline');
    assert.equal(view.find('Chip', (p) => p.accessibilityLabel === '매장 탭 원픽 보기').selected, true);
    view.find('Chip', (p) => p.accessibilityLabel === '온라인 탭 원픽 보기').onPress(); view.render();
    assert.equal(calls.home[3], 'online');
    view.find('Chip', (p) => p.accessibilityLabel === '전체 탭 원픽 보기').onPress(); view.render();
    assert.equal(calls.home[3], null);
  });
  await test('MVP hides Home category chips even above the Pick threshold', () => {
    flags.categoryChips = false; thresholds.homeCategoryFilterMinPicks = 0;
    const { view } = home(20); assert.equal(categoryChips(view).length, 0);
    assert.equal(view.find('FlatList').data.length, 20, 'Hidden chips never filter the feed');
  });
  await test('MVP Explore: no chips, search open, food-scoped recent places, no off-scope catalogs', () => {
    const { view, recent, calls } = explore({ chips: false });
    assert.equal(view.all('Chip').length, 0);
    assert.match(view.text(), /맛집 찾기/); assert.doesNotMatch(view.text(), /상위 카테고리/);
    assert.ok(view.find('ItemSearch'), 'Search starts open without a ?search=1 handoff');
    assert.equal(view.find('ItemSearch').onSearchMovie, undefined, 'Movie is outside the food group');
    assert.equal(JSON.stringify(calls.recent), JSON.stringify({ ids: ['ramen'], enabled: true }));
    assert.equal(calls.categoryId, undefined, 'Rankings stay idle without a chosen category');
    assert.match(view.text(), /최근 원픽된 맛집/);
    view.find('Pressable', (p) => p.accessibilityLabel === 'Recent place, ramen, 상세 보기').onPress();
    assert.equal(calls.route.pathname, '/item/[itemId]'); assert.equal(calls.route.params.itemId, 'recent');
    assert.equal(view.all('Button').filter((b) => b.accessibilityLabel === '최근 원픽 더 보기').length, 0);
    recent.hasNextPage = true; view.render();
    view.find('Button', (b) => b.accessibilityLabel === '최근 원픽 더 보기').onPress();
    assert.equal(recent.nextPages, 1);
    recent.data = []; recent.hasNextPage = false; view.render();
    assert.ok(view.find('StateCard', (s) => s.title === '아직 원픽된 곳이 없어요'));
  });
  await test('Home restoration threshold, signed-out avatar and editorial copy', () => {
    flags.categoryChips = true;
    thresholds.homeCategoryFilterMinPicks = 0;
    const { view, q, auth } = home(2); assert.equal(categoryChips(view).length, 3); assert.equal(view.all('Avatar').length, 1);
    auth.user = null; q.data.editorialItems = [{ itemId: 'editorial', name: 'Editorial', categoryPath: 'food', pickCount: 0 }]; view.render();
    assert.equal(view.all('Avatar').length, 0); assert.equal(view.all('NotificationButton').length, 0);
    assert.equal(view.find('SectionHeader', (p) => p.title === '먼저 소개하는 원픽').description, undefined);
  });
  await test('Home normal refresh hidden; pull, initial error, stale error and pagination retries survive', () => {
    const { view, q } = home(); assert.equal(view.find('Button', (p) => p.accessibilityLabel === '홈 원픽 새로고침'), undefined);
    view.find('RefreshControl').onRefresh(); assert.equal(q.refetches, 1);
    q.isError = true; view.render(); view.find('Button', (p) => p.accessibilityLabel === '홈 원픽 새로고침').onPress(); assert.equal(q.refetches, 2);
    q.isFetching = true; view.render(); const retry = view.find('Button', (p) => p.accessibilityLabel === '홈 원픽 새로고침'); assert.equal(retry.disabled, true); retry.onPress(); assert.equal(q.refetches, 2);
    q.isFetching = false; q.data = undefined; view.render(); view.find('StateCard', (p) => p.tone === 'danger').action.onPress(); assert.equal(q.refetches, 3);
    q.data = { picks: picks(2), currentPicks: [] }; q.isFetchNextPageError = true; view.render();
    view.find('StateCard', (p) => p.action?.label === '다음 원픽 다시 불러오기').action.onPress(); assert.equal(q.nextPages, 1);
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
  await test('Owner profile hides confirmed-empty activity but continues both queries', () => {
    const { view, calls } = profile(); assert.doesNotMatch(view.text(), /활동 기록|내 원픽 등록 요청|이전 원픽 기록|불러온 \d+개|PROFILE TOOLS|ACTIVITY/);
    assert.equal(calls.history, 1); assert.equal(calls.requests, 1); assert.equal(calls.ai, 0); assert.equal(calls.taste, 0);
    assert.equal(view.all('ProfileBioEditor').length, 1); assert.equal(view.all('ProfileSocialLinks').length, 0); assert.equal(view.all('SignOutButton').length, 1);
    assert.equal(view.find('Button', (p) => p.accessibilityLabel?.includes('새로고침')), undefined);
  });
  await test('Owner activity preserves loading, errors, next pages and later-arriving rows', () => {
    flags.profilePickHistory = true; flags.profileItemRequests = true;
    const { view, history, requests } = profile(); history.isSuccess = false; history.isPending = true; history.data = undefined; view.render();
    assert.match(view.text(), /활동 기록/); assert.equal(view.all('ActivityIndicator').length, 1); assert.doesNotMatch(view.text(), /내 원픽 등록 요청/);
    history.isPending = false; history.isError = true; view.render(); let button = view.find('Button', (p) => p.accessibilityLabel === '이전 기록 다시 불러오기'); assert.ok(button); button.onPress(); assert.equal(history.refetches, 1);
    history.isError = false; history.isSuccess = true; history.data = []; history.hasNextPage = true; view.render(); button = view.find('Button', (p) => p.label === '이전 기록 더 보기'); assert.ok(button); button.onPress(); assert.equal(history.nextPages, 1);
    history.hasNextPage = false; requests.data = [{ item: { id: 'request', status: 'pending', name: 'New request' }, category: catalog[2] }]; view.render();
    assert.match(view.text(), /New request/); assert.equal(view.all('Text').some((p) => p.children === '이전 원픽 기록'), false);
    requests.isError = true; requests.isSuccess = false; view.render(); assert.match(view.text(), /New request/); assert.match(view.text(), /최신 목록/);
  });
  await test('Owner header refresh appears only on profile refetch error', async () => {
    const { view, q, history, requests } = profile(); q.isRefetchError = true; view.render();
    await view.find('Button', (p) => p.accessibilityLabel === '프로필 새로고침').onPress();
    assert.equal(q.refetches, 1); assert.equal(history.refetches, 0); assert.equal(requests.refetches, 0);
  });
  await test('Activity, pick history and social links stay hidden until restored', () => {
    const owner = profile();
    owner.requests.data = [{ item: { id: 'request', status: 'pending', name: 'New request' }, category: catalog[2] }];
    owner.history.data = [{ pick: { id: 'old', itemId: 'item', status: 'replaced' }, item: { id: 'item', name: 'Old pick' }, category: catalog[2] }]; owner.view.render();
    assert.doesNotMatch(owner.view.text(), /활동 기록|등록 요청|New request|이전 원픽 기록|기록으로 남아요/); assert.equal(owner.view.all('ProfilePickCard').length, 0);
    flags.profileItemRequests = true; owner.view.render(); assert.match(owner.view.text(), /활동 기록/); assert.match(owner.view.text(), /New request/);
    flags.profilePickHistory = true; flags.profileSocialLinks = true; owner.view.render();
    assert.match(owner.view.text(), /이전 원픽 기록/); assert.equal(owner.view.all('ProfilePickCard').length, 1); assert.equal(owner.view.all('ProfileSocialLinks').length, 1);
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
  await test('Public profile suppresses cached AI in share/join and preserves safety/follow/share', async () => {
    const { view, calls, auth } = profile(true); assert.equal(calls.aiIds[0], undefined); assert.equal(calls.ai, 0); assert.equal(calls.taste, 0);
    assert.equal(view.all('FollowButton').length, 1); assert.equal(view.all('ReportAction').length, 1); assert.equal(view.all('BlockUserButton').length, 1);
    view.find('Button', (p) => p.label === '프로필 공유하기').onPress(); await new Promise(setImmediate); assert.equal(calls.share.aiComment, null);
    auth.user = null; view.render(); assert.doesNotMatch(view.text(), /AI 취향평가도/); assert.match(view.text(), /내 원픽 만들기/);
    flags.profileAi = true; view.render(); assert.match(view.text(), /AI 취향평가도/);
    view.find('Button', (p) => p.label === '프로필 공유하기').onPress(); await new Promise(setImmediate); assert.equal(calls.share.aiComment.text, 'cached AI comment');
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
