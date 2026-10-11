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
let presses = [], destination, sessionRetries = 0, queryRetries = 0, width = 1200, pullToRefresh, endReached, dragBegin, dragEnd, pageCalls = 0, homeHeaderProps, homeDataArgs, followingFeedArgs, itemRankingArgs, categoriesEnabled;
const component = (tag) => ({ children }) => React.createElement(tag, null, children);
const auth = { user: { id: 'owner' }, isLoading: false, error: null, retry: () => sessionRetries++ };
const own = { pick: { id: 'mine', userId: 'owner', itemId: 'ramen', channel: 'offline', oneLineReview: '내 실제 선택 이유', status: 'active' }, item: { name: '신라면' }, category: { name: '라면' }, profile: { username: 'owner' } };
const other = { ...own, pick: { ...own.pick, id: 'other', userId: 'friend', itemId: 'jin', oneLineReview: '다른 사람의 이유' }, item: { name: '진라면' }, profile: { username: 'friend' } };
const privatePick = { ...own, pick: { ...own.pick, id: 'private', status: 'needs_review', oneLineReview: '비공개 확인 대기 원픽' } };
const query = { isPending: false, isError: false, isFetching: false, isRefetching: false,
  hasNextPage: true, isFetchNextPageError: false, fetchNextPage: (options) => { assert.equal(options.cancelRefetch, false); pageCalls++; },
  refetch: (options) => { assert.equal(options.cancelRefetch, false); queryRetries++; }, data: {
  currentPicks: [own, privatePick], picks: [
    // Newest first; the server already excluded the viewer's own Picks.
    { pickId: 'other', userId: 'friend', username: 'friend', profileImageUrl: null, itemId: 'jin', name: '진라면', categoryId: 'ramen', categoryName: '라면', oneLineReview: '다른 사람의 이유', thumbnailUrl: null, startedAt: '2026-09-21T09:00:00.000000+00:00', channels: ['offline'], providerId: '11111111-1111-4111-8111-111111111111' },
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
    FlatList: (props) => { pullToRefresh = props.refreshControl; endReached = props.onEndReached; dragBegin = props.onScrollBeginDrag; dragEnd = props.onScrollEndDrag; return React.createElement('main', null, props.ListHeaderComponent, props.data.map((item, index) => React.createElement('div', { key: item.itemId }, props.renderItem({ item, index }))), props.ListFooterComponent); },
    Pressable: (props) => { presses.push(props); return React.createElement('button', null, props.children); },
    StyleSheet: { create: (styles) => styles }, Platform: { OS: 'web' }, useWindowDimensions: () => ({ width }),
};
const pickPhoto = { PickPhoto: () => null };
const ui = require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': pickPhoto });
const onepickConstants = load('constants/onepick.ts', {
  './font-family': load('constants/font-family.web.ts'),
});
const followCountsQuery = { data: { followingCount: 0, followerCount: 0 }, isPending: false, isError: false };
// Store×menu 7-day ranking (food_item_recent_ranking).
const rankingQuery = {
  data: [
    { itemId: 'jin', itemName: '라면집', categoryId: 'ramen', categoryName: '라면', pickCount: 7, rank: 1, isTied: false, thumbnailUrl: 'https://onepick.test/ramen.jpg' },
    { itemId: 'legacy', itemName: '사진없는집', categoryId: 'x', categoryName: '사진없는메뉴', pickCount: 6, rank: 2, isTied: false, thumbnailUrl: null },
    { itemId: 'snack', itemName: '과자가게', categoryId: 'snacks', categoryName: '과자', pickCount: 2, rank: 3, isTied: false, thumbnailUrl: 'https://onepick.test/snack.jpg' },
    { itemId: 'soup-a', itemName: '서울집', categoryId: 'soup-a', categoryName: '미역국', pickCount: 5, rank: 4, isTied: false, thumbnailUrl: 'https://onepick.test/soup-a.jpg' },
    { itemId: 'soup-b', itemName: '곰탕집', categoryId: 'soup-b', categoryName: '곰탕', pickCount: 4, rank: 5, isTied: false, thumbnailUrl: 'https://onepick.test/soup-b.jpg' },
    { itemId: 'soup-c', itemName: '두부집', categoryId: 'soup-c', categoryName: '순두부', pickCount: 3, rank: 6, isTied: false, thumbnailUrl: 'https://onepick.test/soup-c.jpg' },
    { itemId: 'noodle-b', itemName: '냉면집', categoryId: 'noodle-b', categoryName: '냉면', pickCount: 3, rank: 7, isTied: false, thumbnailUrl: 'https://onepick.test/noodle-b.jpg' },
    { itemId: 'overflow', itemName: '초과집', categoryId: 'overflow', categoryName: '초과메뉴', pickCount: 3, rank: 8, isTied: false, thumbnailUrl: 'https://onepick.test/overflow.jpg' },
  ],
  isPending: false, isError: false, isFetching: false,
  refetch: async () => {},
};
const followingQuery = {
  data: { items: [query.data.picks[0]], nextCursor: null },
  isPending: false, isError: false, isFetching: false, isRefetching: false,
  hasNextPage: false, isFetchingNextPage: false, isFetchNextPageError: false,
  refetch: async () => {}, fetchNextPage: async () => {},
};
// Figma 30E (#762): this suite covers the 30+ total-Pick Home, where "많이 고른 메뉴" is back.
// Below-30 states live in test-home-early-mvp.cjs.
const menuCountsQuery = { data: new Map([['ramen', 30]]), isPending: false, isError: false, isFetching: false, refetch: async () => {} };
const emptyQuery = (data) => ({ data, isPending: false, isError: false, isFetching: false, refetch: async () => {} });
const { default: Home } = load('app/(tabs)/index.tsx', {
  'expo-image': { Image: component('img') },
  'expo-router': { useRouter: () => ({ push: (route) => { destination = route; } }), useFocusEffect: () => {} },
  '@/components/home-early-sections': load('components/home-early-sections.tsx', {
    'react-native': native, '@/components/ui': ui, '@/components/ui/touch': load('components/ui/touch.ts'), '@/constants/onepick': onepickConstants,
    '@/lib/home/questionTitle': load('lib/home/questionTitle.ts'), '@/lib/profile/profileAvatar': { profileAvatarUrl: (path) => (path ? `https://x/${path}` : null) }, '@/lib/profile/profileName': load('lib/profile/profileName.ts'),
  }),
  '@/components/home-feedback-button': { HomeFeedbackButton: () => null },
  '@/hooks/useMyProfile': { useMyProfile: () => emptyQuery(undefined) }, '@/lib/profile/profileAvatar': { profileAvatarUrl: (path) => (path ? `https://x/${path}` : null) }, '@/lib/profile/profileName': load('lib/profile/profileName.ts'),
  '@/hooks/useNotifications': { useHomeReplyBanner: () => emptyQuery(undefined), useNotificationCount: () => emptyQuery(undefined) },
  '@/lib/categories/browseScope': load('lib/categories/browseScope.ts', { '@/lib/categories/categoryTree': load('lib/categories/categoryTree.ts') }),
  '@/lib/home/earlyHome': load('lib/home/earlyHome.ts'),
  '@/lib/home/firstPickNotice': load('lib/home/firstPickNotice.ts'),
  '@/lib/share/sharePick': { sharePick: async () => 'shared' },
  'react-native': native,
  'react-native-safe-area-context': { SafeAreaView: component('section') },
  '@/components/notification-button': { NotificationButton: ({ userId }) => React.createElement('span', { 'data-notification-user': userId }, '알림') },
  '@/components/pick-photo': pickPhoto,
  '@/components/ui': ui,
  '@/components/recent-item-card': load('components/recent-item-card.tsx', {
    react: React,
    'expo-image': { Image: component('img') },
    'react-native': native,
    '@/constants/onepick': onepickConstants,
  }),
  '@/components/home-pick-row': load('components/home-pick-row.tsx', {
    'react-native': native,
    '@/lib/profile/profileAvatar': { profileAvatarUrl: (path) => (path ? `https://x/${path}` : null) }, '@/lib/profile/profileName': load('lib/profile/profileName.ts'),
    '@/components/ui': ui,
    '@/components/pick-photo': pickPhoto,
    '@/components/ui/touch': { MIN_TOUCH_TARGET: 44 },
    '@/components/current-pick-flag': load('components/current-pick-flag.tsx', { 'react-native': native, 'expo-image': { Image: component('img') },
      '../../public/icons/flag-mine.svg': 'flag-mine.svg', '../../public/icons/flag-other.svg': 'flag-other.svg' }),
    '@/components/store-badge': { StoreBadge: () => React.createElement('b', null, '매장') },
    '@/constants/onepick': onepickConstants,
    '@/lib/items/pickChannel': load('lib/items/pickChannel.ts'),
  }),
  '@/hooks/useFollow': {
    useFollowCounts: () => followCountsQuery,
    useFollowingFeed: (...args) => { followingFeedArgs = args; return followingQuery; },
  },
  '@/components/item-pick-count': { ItemPickCount: () => null },
  '@/components/home-header': { HomeHeader: (props) => { homeHeaderProps = props; return null; } },
  '@/constants/onepick': onepickConstants,
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useExploreData': { useFoodMenuPickCounts: () => menuCountsQuery, useExploreCategories: (enabled) => { categoriesEnabled = enabled; return { data: [
    { id: 'food', parentId: null, name: '먹을것', slug: 'food', status: 'open', isVisible: true, isPickable: false, sortOrder: 10 },
    { id: 'noodles', parentId: 'food', name: '면류', slug: 'noodles', status: 'open', isVisible: true, isPickable: false, sortOrder: 1 },
    { id: 'culture', parentId: null, name: '문화', slug: 'culture', status: 'open', isVisible: true, isPickable: false, sortOrder: 20 },
    { id: 'ramen', parentId: 'noodles', name: '라면', slug: 'ramen', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
    { id: 'snacks', parentId: 'food', name: '과자', slug: 'snacks', status: 'open', isVisible: true, isPickable: true, sortOrder: 2 },
    { id: 'movie', parentId: 'culture', name: '영화', slug: 'movie', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
    { id: 'book', parentId: 'culture', name: '책', slug: 'book', status: 'open', isVisible: true, isPickable: true, sortOrder: 5 },
    { id: 'youtube', parentId: 'culture', name: '유튜브', slug: 'youtube', status: 'open', isVisible: true, isPickable: true, sortOrder: 6 },
  ] }; } },
  '@/hooks/useHomeData': { useHomeData: (...args) => { homeDataArgs = args; return query; }, useHomeItemRanking: (...args) => { itemRankingArgs = args; return rankingQuery; },
    useHomeFoodMenuPickCounts: () => menuCountsQuery,
    useDailyQuestionCategory: () => emptyQuery(null), useHomeParticipantPicks: () => emptyQuery({ rows: [], complete: true }) },
  '@/lib/categories/categoryTree': load('lib/categories/categoryTree.ts'),
  '@/lib/home/homeChannels': load('lib/home/homeChannels.ts'),
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

// Initial MVP keeps the following feed hidden even though profile follow is enabled.
const allFirstPage = render();
assert.equal(categoriesEnabled, false, 'Hidden category chips do not load the tree on Home; search loads it when opened');
assert.doesNotMatch(allFirstPage, /팔로잉/, 'Initial MVP hides the Following scope');
assert.doesNotMatch(allFirstPage, /data-notification-user=/, 'Home header is logo only: notifications live in the bottom tab');
assert.equal(presses.find((p) => p.accessibilityLabel === '내 프로필'), undefined, 'Home header is logo only: the profile lives in the bottom tab');
assert.match(allFirstPage, />friend</);
assert.match(allFirstPage, />neighbor</, 'Member Home stays on the public feed while follow is hidden');
assert.doesNotMatch(allFirstPage, /원픽 더 둘러보기|모아보기/, 'Figma 30-1: no explore/my-picks links under the feed');
assert.equal(homeDataArgs[2], true, 'Hidden following-feed mode enables the public feed');
assert.equal(JSON.stringify(homeDataArgs[3]), JSON.stringify(['offline', 'online']), 'Home reads offline restaurants + online food, never recipe (#762)');
assert.equal(homeDataArgs[4], 'food', 'MVP Home asks the server for food Picks only');
assert.equal(followingFeedArgs[1], false, 'Hidden following-feed mode never enables the following query');
assert.equal(JSON.stringify(followingFeedArgs[2]), JSON.stringify(['offline', 'online']), 'Preserved following query keeps the same channel scope');
assert.equal(followingFeedArgs[3], 'food', 'Preserved following query keeps the same food root');
assert.equal(presses.find((p) => p.accessibilityLabel === '전체 원픽 보기'), undefined);
assert.equal(presses.find((p) => p.accessibilityLabel === '팔로잉 원픽 보기'), undefined);
assert.ok(refreshButton(), 'Successful web Home retains a manual refresh button');
const storeAction = presses.find((p) => p.accessibilityLabel === '진라면 매장 보기');
assert.ok(storeAction, 'Provider-backed Home card keeps store-profile navigation');
assert.equal(storeAction.style({ pressed: false })[0].minHeight, 44, 'Store/provider action has a real 44px target');
assert.equal(storeAction.style({ pressed: false })[0].minWidth, 44, 'Store/provider action has a real 44px target');
const profileAction = presses.find((p) => p.accessibilityLabel === 'friend 프로필 보기');
assert.ok(profileAction, 'Home card keeps nickname profile navigation');
assert.equal(profileAction.style({ pressed: false })[0].minHeight, 44, 'Nickname action has a real 44px target');
assert.equal(profileAction.style({ pressed: false })[0].minWidth, 44, 'Nickname action has a real 44px target');
assert.equal(presses.find((p) => p.accessibilityLabel === '라면 상세 보기'), undefined,
  'Legacy no-channel Home row keeps item name as its menu/title instead of promoting the category name');
assert.doesNotMatch(allFirstPage, /최근 7일 많이 고른 메뉴/, 'Figma 30-1 drops the ranking title');
assert.match(allFirstPage, /최근 7일 원픽 많은 순/, 'The sort line under the tabs names the 7-day window');
assert.match(allFirstPage, /원픽 7/);
assert.doesNotMatch(allFirstPage, /사진없는메뉴/, 'Legacy ranking rows without a cover are never rendered as photo-less cards');
const rankingButtons = presses.filter((p) => /^\S+ \S+ 보기$/.test(p.accessibilityLabel ?? '') && !/상세 보기|프로필 보기|매장 보기/.test(p.accessibilityLabel));
assert.equal(rankingButtons.length, 6, 'Photo-less legacy rows are backfilled so Home still shows six ranking cards (2×3)');
assert.doesNotMatch(allFirstPage, /초과메뉴/, 'Home caps the visible recent ranking at six cards');
const rankingCardStyle = rankingButtons[0].style({ pressed: false })[0];
assert.equal(rankingCardStyle.width, '48%', 'Two columns');
assert.equal(rankingCardStyle.flexGrow, undefined, 'An odd last row keeps the two-column card width');
const lowSampleMenu = presses.find((p) => p.accessibilityLabel === '과자가게 과자 보기');
assert.ok(lowSampleMenu, 'Low-sample menu stays browsable');
assert.doesNotMatch(textOf(lowSampleMenu.children), /원픽 2/, 'A menu below the 3-person exposure threshold hides its recent count');
assert.doesNotMatch(allFirstPage, /메뉴별 원픽 보기|먼저 소개하는 원픽/);
assert.match(allFirstPage, /서울집<\/span> 미역국/, 'Cards show the store (bold) then the menu (10-05)');
assert.equal(presses.find((p) => p.accessibilityLabel === '인기 메뉴 더보기'), undefined, 'Unapproved /popular destination stays hidden');
assert.equal(presses.find((p) => p.accessibilityLabel === '면류 인기 메뉴 보기'), undefined, 'Figma 30-1 (10-04): no ranking group chips');
assert.equal(itemRankingArgs[0], 'offline', 'Home ranking stays offline until a multi-channel ranking contract exists (#762)');

// The following-feed implementation remains available behind its separate rollout gate.
onepickConstants.OnePickFeatures.followingFeed = true;
followCountsQuery.data.followingCount = 2;
const followingFirstPage = render();
assert.match(followingFirstPage, />friend</);
assert.doesNotMatch(followingFirstPage, />neighbor</, 'Following can still become the default after a future rollout');
assert.equal(homeDataArgs[2], false, 'Following rollout does not prefetch the public feed');
assert.equal(followingFeedArgs[1], true, 'Following rollout enables the viewer-bound feed');
assert.equal(presses.find((p) => p.accessibilityLabel === '전체 원픽 보기').accessibilityState.selected, false);
assert.equal(presses.find((p) => p.accessibilityLabel === '팔로잉 원픽 보기').accessibilityState.selected, true);
followCountsQuery.data.followingCount = 0;
onepickConstants.OnePickFeatures.followingFeed = false;
render();

for (width of [390, 800, 1200]) {
  const page = render();
  assert.match(page, />friend</); assert.match(page, />다른 사람의 이유</, 'Each card quotes that person’s own reason');
  assert.match(page, />neighbor</); assert.match(page, /이웃도 신라면/);
  assert.doesNotMatch(page, /✓ 내 원픽/, 'Figma 30 (10-04): no "✓ 내 원픽" text on feed rows');
  assert.doesNotMatch(page, /이미 내 원픽이에요|나도 이게 원픽|♡/, 'Home drops follow-the-Pick CTAs and likes');
  assert.equal(presses.find((p) => / (댓글 보기|공유)$/.test(p.accessibilityLabel ?? '')), undefined, 'Home rows drop comments/share (10-04)');
  assert.doesNotMatch(page, /새로 고름|9\/21|2시간/, 'Home keeps Pick ordering but never renders time/status text');
  assert.doesNotMatch(page, /명이 추천|추천 이유|MY PICK/, 'PR 1A does not invent aggregate counts before the feed contract provides them');
  const storePos = page.indexOf('>진라면</span>');
  const menuPos = page.indexOf('>라면</span>');
  const nicknamePos = page.indexOf('>friend</span>');
  assert.ok(nicknamePos >= 0 && storePos > nicknamePos && menuPos > storePos, 'Home feed (2026-10-11): author row first, then store and menu as separate text blocks');
  assert.equal(page.split('>friend</span>').length - 1, 1, 'The author row is shown once, not duplicated below');
  assert.doesNotMatch(page, />매장<\//, 'Feed Card v3 has no legacy channel badge');
  assert.doesNotMatch(page, /탭 원픽 보기/, 'Initial MVP exposes no channel switcher');
  assert.ok(page.indexOf('진라면') < page.indexOf('신라면'), 'Home preserves newest-first service order instead of prioritizing the viewer’s picks');
  assert.doesNotMatch(page, /아직 선택하지 않은 카테고리/, 'Signed-in Home no longer lists unselected categories');
  assert.equal(presses.find((p) => p.accessibilityLabel === '전체 원픽 보기'), undefined, 'Following-feed-off MVP has no feed scope switcher');
  assert.equal(presses.find((p) => p.accessibilityLabel === '팔로잉 원픽 보기'), undefined);
  assert.equal(presses.find((p) => p.accessibilityLabel === '먹을것 카테고리 보기'), undefined, 'Two loaded Picks do not show category filters');
  assert.equal(presses.find((p) => p.accessibilityLabel === '문화 카테고리 보기'), undefined);
  assert.deepEqual(Object.keys(homeHeaderProps), ['onOpenItem'], 'Home header search only opens existing items');
  assert.doesNotMatch(page, /원픽 더 둘러보기|내 원픽 \d+개 모아보기/, 'Signed-in Home has no footer links either');
  assert.doesNotMatch(page, /비공개 확인 대기 원픽/);
  press('신라면 상세 보기'); assert.equal(destination.params.itemId, 'ramen');
  press('진라면 상세 보기'); assert.equal(destination.params.itemId, 'jin');
  press('friend 프로필 보기'); assert.equal(destination.pathname, '/u/[username]'); assert.equal(destination.params.username, 'friend');
  assert.equal(destination.params.returnTo, '/', 'Home profile links preserve Home as their back target');
  press('새로 올라온 원픽 더보기'); assert.equal(destination, '/feed', 'Feed 더보기 opens the full feed');
  assert.match(page, /새로 올라온 원픽/, '2026-10-11: the newest-first Home feed is titled 새로 올라온 원픽 (formerly 이웃 제안)'); assert.doesNotMatch(page, />이웃 제안</);
  assert.doesNotMatch(page, /모두의 원픽/, 'The old section title is gone');
  assert.doesNotMatch(page, /아직 아무도 안 골랐어요/, 'At 30+ total Picks the unpicked chips give way to 많이 고른 메뉴');
  assert.ok(presses.find((p) => p.accessibilityLabel === '라면집 라면 보기'), 'Signed-in Home keeps the recent-menu ranking grid');
  homeHeaderProps.onOpenItem('jin');
  assert.equal(destination.pathname, '/item/[itemId]', 'A header search result opens the existing item detail');
  assert.equal(destination.params.itemId, 'jin');
}

// Test the actual boundary using unique loaded records, without changing thresholds.
const smallFeed = query.data.picks;
query.data.picks = Array.from({ length: 19 }, (_, i) => ({ ...smallFeed[0], pickId: `pick-${i}`, itemId: `item-${i}` }));
query.data.picks.push({ ...smallFeed[1], pickId: 'pick-mvp', itemId: 'item-mvp' });
render(); assert.equal(presses.find((p) => p.accessibilityLabel === '먹을것 카테고리 보기'), undefined, 'MVP hides category chips at any feed size');
query.data.picks.pop();
onepickConstants.OnePickFeatures.categoryChips = true;
render(); assert.equal(presses.find((p) => p.accessibilityLabel === '먹을것 카테고리 보기'), undefined);
assert.equal(categoriesEnabled, true, 'A future category-chip rollout still loads its tree');
query.data.picks.push({ ...smallFeed[1], pickId: 'pick-19', itemId: 'item-19' });
render(); assert.equal(presses.find((p) => p.accessibilityLabel === '먹을것 카테고리 보기'), undefined, 'A single food group needs no filter chips');
assert.equal(presses.find((p) => p.accessibilityLabel === '문화 카테고리 보기'), undefined, 'MVP Home hides non-food category filters');
query.data.picks = smallFeed;

// Home 이웃 제안 (2026-10-11 13:28 KST user decision): the newest ten first, then 함께하는 사람들/초대,
// and the next ten only when the viewer swipes up again at the bottom (or presses the hint button).
query.data.picks = Array.from({ length: 20 }, (_, i) => ({ ...smallFeed[0], pickId: `ten-${i}`, itemId: `ten-item-${i}`, username: `user${i}` }));
const capped = render();
assert.match(capped, />user9</); assert.doesNotMatch(capped, />user10</, 'Home starts with ten Picks');
assert.equal(endReached, undefined, 'Reaching the bottom never loads by itself');
const at = (y) => ({ nativeEvent: { contentOffset: { y }, layoutMeasurement: { height: 600 }, contentSize: { height: 2000 } } });
const swipeUpAtEnd = () => { dragBegin(at(1400)); dragEnd(at(1400)); };
assert.equal(typeof dragBegin, 'function'); assert.equal(typeof dragEnd, 'function');
dragBegin(at(800)); dragEnd(at(1400)); assert.doesNotMatch(render(), />user10</, 'A drag that only reaches the end does not load');
dragBegin(at(1400)); dragEnd(at(900)); assert.doesNotMatch(render(), />user10</, 'Scrolling back up from the end does not load');
assert.match(capped, /위로 밀면 다음 원픽이 나와요/, 'The bottom says how to see more');
swipeUpAtEnd(); assert.equal(pageCalls, 0, 'Already loaded rows are revealed before another server page');
query.data.picks = query.data.picks.slice(0, 10);
render(); swipeUpAtEnd(); assert.equal(pageCalls, 1, 'Once loaded rows are all shown, the next keyset page is requested');
query.isFetching = true; render(); swipeUpAtEnd(); assert.equal(pageCalls, 1, 'No duplicate request while one is in flight');
query.isFetching = false;
render(); press('새로 올라온 원픽 다음 원픽 불러오기'); assert.equal(pageCalls, 2, 'The hint button is the same load for web and assistive tech');
query.isFetchNextPageError = true;
const pageFailed = render();
assert.match(pageFailed, /다음 원픽을 불러오지 못했어요/, 'A failed next page shows the existing retry card');
swipeUpAtEnd(); assert.equal(pageCalls, 2, 'A failed page waits for the explicit retry');
press('다음 원픽 다시 불러오기'); assert.equal(pageCalls, 3, 'Retry asks for the same next page');
query.isFetchNextPageError = false; query.hasNextPage = false;
const ended = render();
assert.match(ended, /지금 볼 수 있는 원픽을 모두 확인했어요/, 'The end of the feed is stated once everything is shown');
assert.doesNotMatch(ended, /위로 밀면 다음 원픽이 나와요/, 'No more hint at the end');
swipeUpAtEnd(); assert.equal(pageCalls, 3, 'Stops when the server has no more');
pageCalls = 0;
query.isFetchNextPageError = false; query.hasNextPage = false;
query.data.picks = smallFeed;
auth.user = null;
const publicPage = render();
assert.match(publicPage, /진라면/); assert.match(publicPage, /신라면/);
assert.doesNotMatch(publicPage, /data-notification-user=/, 'Signed-out Home does not render a user notification entry');
assert.equal(presses.find((p) => p.accessibilityLabel === '내 프로필'), undefined, 'Signed-out Home hides the own-profile avatar');
assert.match(publicPage, /최근 7일 원픽 많은 순/);
assert.doesNotMatch(publicPage, /먹을것 › 면류 › 라면/, 'Home ranking cards show only the leaf name');
assert.doesNotMatch(publicPage, /영화|>책<|>유튜브</, 'MVP Home ranking is food only');
press('라면집 라면 보기'); assert.equal(destination.pathname, '/item/[itemId]');
assert.equal(destination.params.itemId, 'jin', 'A Home store×menu card opens that item');
const rankingData = rankingQuery.data;
rankingQuery.data = [];
const fallbackPage = render();
assert.match(fallbackPage, /최근 7일 원픽이 아직 없어요/);
assert.ok(presses.find((p) => p.children?.props?.children === '전체 메뉴 보기' || textOf(p.children) === '전체 메뉴 보기'), 'Empty ranking keeps an Explore fallback');
rankingQuery.data = rankingData;
assert.doesNotMatch(publicPage, /비공개 확인 대기 원픽|✓ 내 원픽|이미 내 원픽이에요/, 'Visitors see only the public feed, never the cached private collection');
assert.doesNotMatch(publicPage, /나도 이게 원픽/, 'Home no longer promotes copying someone else’s Pick');
assert.doesNotMatch(publicPage, />댓글<|>공유</, 'Visitors also get rows without comments/share');
press('진라면 상세 보기'); assert.equal(destination.params.itemId, 'jin');
query.data.mode = 'single_category'; query.data.singleCategoryItems = [{ id: 'public', name: '공개 제품' }];
assert.doesNotMatch(render(), /공개 제품/, 'The legacy single-category catalog must not bypass the threshold');

auth.user = { id: 'owner' }; auth.error = new Error('offline');
assert.doesNotMatch(render(), /신라면|진라면/);
assert.doesNotMatch(render(), /라면집|최근 7일 원픽 많은 순/);
assert.equal(categoriesEnabled, false, 'Session errors disable the category query even with chips enabled');
assert.equal(pullToRefresh, undefined, 'Session errors must not refresh data for an unverified user');
press('다시 불러오기'); assert.equal(sessionRetries, 1);
auth.error = null; query.isError = true;
const stalePage = render();
assert.match(stalePage, /신라면/); assert.match(stalePage, /진라면/);
assert.match(stalePage, /마지막으로 불러온 내용/);
assert.doesNotMatch(stalePage, /원픽을 불러오지 못했어요/);
press('신라면 상세 보기'); assert.equal(destination.params.itemId, 'ramen');
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
assert.match(render(), /라면집/, 'A failed feed does not hide successful popular menus');
assert.equal(refreshButton(), undefined);
press('다시 불러오기'); assert.equal(queryRetries, 4);
query.data = cached;
auth.isLoading = true;
assert.doesNotMatch(render(), /신라면|진라면/);
assert.doesNotMatch(render(), /라면집|최근 7일 원픽 많은 순/, 'Session verification still gates public ranking display');
assert.equal(pullToRefresh, undefined);
auth.isLoading = false; auth.user = null;
assert.match(render(), /진라면/);
assert.doesNotMatch(render(), /비공개 확인 대기 원픽|내 원픽/);
refreshButton().onPress(); assert.equal(queryRetries, 5, 'Public Home supports error refresh too');
query.data = { ...cached, picks: [], currentPicks: [] }; query.isError = false;
assert.match(render(), /아직 공개된 매장 원픽이 없어요/, 'Signed-out Home empty state describes the state without a CTA');
assert.doesNotMatch(render(), /명 이상/, 'No minimum pick count on the people feed');
query.isError = false; query.isPending = true;
query.data = undefined;
const pendingFeed = render();
assert.match(pendingFeed, /원픽을 불러오고 있어요/);
assert.match(pendingFeed, /라면집/, 'Popular menus render before the feed and its enrichment finish');
rankingQuery.isPending = true; rankingQuery.data = undefined;
assert.match(render(), /인기 메뉴를 불러오고 있어요/, 'Ranking has an independent loading state');
rankingQuery.isPending = false; rankingQuery.isError = true;
assert.match(render(), /인기 메뉴를 불러오지 못했어요/, 'Ranking errors do not wait for the feed');
rankingQuery.isError = false; rankingQuery.data = [];
assert.match(render(), /최근 7일 원픽이 아직 없어요/, 'An empty ranking is visible even while the feed loads');
query.data = cached; query.isPending = false; rankingQuery.isPending = true;
assert.match(render(), /진라면/, 'The feed also renders independently of pending ranking');
console.log('Home screen checks passed: all-first member entry, filter boundary, public-feed cards/actions, routes, empty states, refresh recovery and session privacy.');


