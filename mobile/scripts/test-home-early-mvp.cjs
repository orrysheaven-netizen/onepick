// Figma 30E early-MVP Home (#758 / #762): boundary rules and the rendered Home states.
// Uses mock query results only; this proves the screen logic, not live database wiring.
const assert = require('node:assert/strict');
const { load, screen, names } = require('./mvp-screen-harness.cjs');

const constants = load('constants/onepick.ts', { './font-family': load('constants/font-family.ts') });
const tree = load('lib/categories/categoryTree.ts');
const early = load('lib/home/earlyHome.ts');
const queryKeysModule = load('lib/query/queryKeys.ts');
const notice = load('lib/home/firstPickNotice.ts');
let passed = 0;
// Values built inside the vm context carry another realm's prototypes; compare plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));
const deepEq = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);
const asyncTests = [];
function test(name, run) {
  const result = run();
  if (result && typeof result.then === 'function') {
    asyncTests.push(result.then(() => { passed++; console.log(`PASS ${name}`); }));
    return;
  }
  passed++; console.log(`PASS ${name}`);
}

// ---- Catalog: food › 면류 › {라면, 냉면, 칼국수}, food › 내장류 › {곱창, 막창, 대창}, culture › 영화 --
const cat = (id, parentId, name, sortOrder, isPickable = true) =>
  ({ id, parentId, name, slug: id, status: 'open', isVisible: true, isPickable, rankingMinSample: 3, sortOrder, imageUrl: null });
const catalog = [
  cat('food', null, '먹을것', 1, false), cat('culture', null, '문화', 2, false),
  cat('noodles', 'food', '면류', 1, false), cat('offal', 'food', '내장류', 2, false),
  cat('ramen', 'noodles', '라면', 1), cat('naengmyeon', 'noodles', '냉면', 2), cat('kalguksu', 'noodles', '칼국수', 3),
  cat('gopchang', 'offal', '곱창', 1), cat('makchang', 'offal', '막창', 2), cat('daechang', 'offal', '대창', 3),
  cat('movie', 'culture', '영화', 1),
];
const menuOrder = ['ramen', 'naengmyeon', 'kalguksu', 'gopchang', 'makchang', 'daechang'];
const menus = menuOrder.map((id) => catalog.find((c) => c.id === id));
const countsOf = (entries) => new Map(Object.entries(entries));

let seq = 0;
const row = (userId, categoryId, startedAt, extra = {}) => ({
  pick: { id: extra.id ?? `p${++seq}`, userId, categoryId, itemId: `item-${categoryId}-${userId}`, channel: extra.channel === undefined ? 'offline' : extra.channel,
    oneLineReview: '이유', status: extra.status ?? 'active', startedAt },
  profile: extra.noProfile ? null : { id: userId, username: userId, nickname: extra.nickname ?? null, profileImageUrl: null },
  item: { name: `${categoryId} 가게` }, category: { name: categoryId },
});
const group = (id, kind, unread, latest, pickId = `pick-${id}`) => ({
  group_id: id, kind, latest_at: latest, snapshot: latest, unread_count: unread, total_count: Math.max(unread, 1), actor_count: 1,
  actor: null, target: { pick_id: pickId, item_id: null, item_name: null, category_id: null, category_name: null, channel: null, comment_id: null, root_comment_id: null, user_id: null },
});

// ---------------------------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------------------------
test('Total Pick count: 0·29 → unpicked chips, 30·31 → 많이 고른 메뉴, unknown → neither', () => {
  assert.equal(early.EARLY_HOME_POPULAR_MIN_TOTAL_PICKS, 30);
  for (const [total, expected] of [[0, 'unpicked'], [29, 'unpicked'], [30, 'popular'], [31, 'popular']]) {
    assert.equal(early.earlyHomeDiscovery(early.totalPickCount(countsOf({ ramen: total }))), expected, `total ${total}`);
  }
  assert.equal(early.earlyHomeDiscovery(early.totalPickCount(undefined)), null, 'Unknown total never guesses a section');
  assert.equal(early.totalPickCount(countsOf({ ramen: 20, gopchang: 9, bad: -4, nan: NaN })), 29, 'Sums every menu; ignores invalid rows');
  assert.equal(early.earlyHomeDiscovery(early.totalPickCount(countsOf({ ramen: 20, gopchang: 10 }))), 'popular', 'Counts add up across menus');
});

test('Unpicked menus: catalog order, exclude today’s question, cap five, fewer when fewer exist', () => {
  const none = countsOf({});
  deepEq(early.unpickedCategories(menus, none, null).map((c) => c.id), ['ramen', 'naengmyeon', 'kalguksu', 'gopchang', 'makchang']);
  deepEq(early.unpickedCategories(menus, none, 'naengmyeon').map((c) => c.id), ['ramen', 'kalguksu', 'gopchang', 'makchang', 'daechang'],
    'Question category is skipped and the next candidate fills the slot');
  const mostPicked = countsOf({ ramen: 1, naengmyeon: 2, kalguksu: 1, gopchang: 4 });
  deepEq(early.unpickedCategories(menus, mostPicked, 'makchang').map((c) => c.id), ['daechang'], 'Only one candidate left');
  deepEq(early.unpickedCategories(menus, countsOf({ ramen: 1, naengmyeon: 1, kalguksu: 1, gopchang: 1, makchang: 1, daechang: 1 }), null), []);
});

test('Participants: ≥1 eligible Pick, newest activity first; 2 hidden, 3 shown', () => {
  const eligible = new Set(menuOrder);
  const rows = [
    row('amy', 'ramen', '2026-10-05T10:00:00Z'), row('amy', 'gopchang', '2026-10-01T10:00:00Z'),
    row('ben', 'naengmyeon', '2026-10-04T10:00:00Z'),
    row('ben', 'movie', '2026-10-06T10:00:00Z'), // not a food menu
    row('cat', 'kalguksu', '2026-10-06T09:00:00Z', { channel: 'online' }), // hidden channel
    row('dan', 'makchang', '2026-10-06T08:00:00Z', { status: 'needs_review' }),
    row('eve', 'ramen', '2026-10-06T07:00:00Z', { noProfile: true }),
  ];
  const two = early.homeParticipants(rows, eligible, 'offline');
  deepEq(two.map((p) => [p.username, p.pickCount]), [['amy', 2], ['ben', 1]], 'Only eligible public Picks count; newest activity first');
  assert.equal(early.showParticipants(two), false, 'Two participants keep the section hidden');
  const three = early.homeParticipants([...rows, row('fay', 'daechang', '2026-10-03T00:00:00Z', { channel: null })], eligible, 'offline');
  deepEq(three.map((p) => p.username), ['amy', 'ben', 'fay']);
  assert.equal(early.showParticipants(three), true, 'Three participants show the section');
  const dup = row('gus', 'ramen', '2026-10-02T00:00:00Z', { id: 'same' });
  assert.equal(early.homeParticipants([dup, dup], eligible, 'offline')[0].pickCount, 1, 'A Pick is counted once even if read twice');
});

test('Question card states: unanswered/answered, 0 Picks, N Picks, first-Pick completion once', () => {
  const ids = new Set(menuOrder);
  const mine = [row('me', 'ramen', '2026-10-05T00:00:00Z', { id: 'r1' }), row('me', 'movie', '2026-10-05T00:00:00Z', { id: 'm1' }),
    row('me', 'kalguksu', '2026-10-05T00:00:00Z', { id: 'k1', status: 'needs_review' })];
  const scoped = early.myScopedPicks(mine, ids, 'offline');
  deepEq(scoped.map((r) => r.pick.id), ['r1', 'k1'], 'Own current food Picks (incl. awaiting review), outside menus excluded');
  assert.equal(early.myQuestionAnswer(scoped, 'ramen').pick.id, 'r1', 'Answered → 내 답 보기 target');
  assert.equal(early.myQuestionAnswer(scoped, 'naengmyeon'), null, 'Unanswered → 답하기');
  assert.equal(early.myQuestionAnswer(scoped, null), null);
  deepEq(early.questionFooter([], null), { kind: 'none-yet' });
  deepEq(early.questionFooter(scoped, null), { kind: 'has-picks', count: 2 });
  const only = scoped.slice(0, 1);
  assert.equal(early.questionFooter(only, 'r1').kind, 'first-pick-done', 'Just-saved first Pick shows the completion line');
  assert.equal(early.questionFooter(scoped, 'r1').kind, 'has-picks', 'Not the first Pick → normal line');
  assert.equal(early.questionFooter(only, 'other').kind, 'has-picks', 'A different saved Pick never claims completion');
});

test('Unread replies: 0, 1, many; latest destination; other kinds untouched', () => {
  assert.equal(early.replyBanner([]), null);
  assert.equal(early.replyBanner([group('c1', 'comment', 0, '2026-10-05T00:00:00Z')]), null, 'Read groups do not count');
  const one = early.replyBanner([group('c1', 'comment', 1, '2026-10-05T00:00:00Z', 'pick-a')]);
  deepEq(one, { count: 1, target: { groupId: 'c1', snapshot: '2026-10-05T00:00:00Z', pickId: 'pick-a' } });
  const many = early.replyBanner([
    group('c1', 'comment', 2, '2026-10-04T00:00:00Z', 'pick-a'),
    group('c2', 'comment', 1, '2026-10-06T00:00:00Z', 'pick-b'),
    group('c2', 'comment', 1, '2026-10-06T00:00:00Z', 'pick-b'), // repeated page row
    group('r1', 'reply', 5, '2026-10-07T00:00:00Z'), group('v1', 'pick_review', 3, '2026-10-07T00:00:00Z'),
    group('f1', 'fix_needed', 1, '2026-10-07T00:00:00Z'),
  ]);
  assert.equal(many.count, 3, 'Only unread comment groups on the viewer’s Picks count, each group once');
  assert.equal(many.target.pickId, 'pick-b', 'Several → the Pick with the most recent reply');
  assert.equal(many.target.groupId, 'c2', 'Only that group is handed to the read contract');
});

test('First-Pick handoff: one viewer, one Pick, consumed once; unknown pre-save state never arms', () => {
  assert.equal(notice.peekFirstPickNotice('me'), null);
  notice.armFirstPickNotice('me', 'p1', []);
  assert.equal(notice.peekFirstPickNotice('someone'), null, 'Another account never sees it');
  deepEq(notice.peekFirstPickNotice('me'), { pickId: 'p1', priorPicks: [] });
  assert.equal(notice.consumeFirstPickNotice('me', 'other'), false);
  assert.equal(notice.consumeFirstPickNotice('me', 'p1'), true);
  assert.equal(notice.peekFirstPickNotice('me'), null, 'Consumed: never replayed');
  for (const unknown of [undefined, null]) {
    notice.armFirstPickNotice('me', 'p2', unknown);
    assert.equal(notice.peekFirstPickNotice('me'), null, 'Pre-save count unknown → not armed (never assumed 0)');
  }
  notice.armFirstPickNotice('me', 'p3', []);
  notice.armFirstPickNotice('me', 'p4', undefined);
  assert.equal(notice.peekFirstPickNotice('me'), null, 'A later save with unknown state clears an older handoff');
});

test('R1 · first Pick is only a 0 → 1 transition (replace 1→1, add 1→2, repeat save, unknown → no)', () => {
  const old = row('me', 'ramen', '2026-10-01T00:00:00Z', { id: 'old' });
  const fresh = row('me', 'ramen', '2026-10-06T00:00:00Z', { id: 'fresh' });
  const second = row('me', 'gopchang', '2026-10-06T00:00:00Z', { id: 'second' });
  assert.equal(early.firstPickTransition([], [fresh], 'fresh'), true, '0 → 1 first save');
  assert.equal(early.firstPickTransition([old], [fresh], 'fresh'), false, '1 → 1 replacement in the same menu');
  assert.equal(early.firstPickTransition([old], [old, second], 'second'), false, '1 → 2 addition');
  assert.equal(early.firstPickTransition([fresh], [fresh], 'fresh'), false, 'Repeated save of the current Pick');
  assert.equal(early.firstPickTransition(null, [fresh], 'fresh'), false, 'Unknown pre-save state');
  assert.equal(early.firstPickTransition(undefined, [fresh], 'fresh'), false);
  assert.equal(early.firstPickTransition([], [fresh], 'other'), false, 'A different saved Pick');
  assert.equal(early.firstPickTransition([], [], 'fresh'), false, 'Refreshed list not in yet');
});

test('R1 · pre-save Picks come only from a settled, valid Home context cache', () => {
  const picks = [row('me', 'ramen', '2026-10-01T00:00:00Z', { id: 'old' })];
  const q = (queryKey, state) => ({ queryKey, state: { status: 'success', isInvalidated: false, fetchStatus: 'idle', data: { currentPicks: picks }, ...state } });
  const cache = (queries) => ({ getQueryCache: () => ({ findAll: ({ queryKey }) => queries.filter((x) => x.queryKey[0] === queryKey[0]) }) });
  const ok = notice.captureTrustedCurrentPicks(cache([q(['home', 'me', 'context', 'offline', 'food'])]));
  deepEq(ok.get('me').map((r) => r.pick.id), ['old']);
  for (const [label, state] of [['invalidated', { isInvalidated: true }], ['refetching', { fetchStatus: 'fetching' }],
    ['error', { status: 'error' }], ['pending', { status: 'pending', data: undefined }]]) {
    assert.equal(notice.captureTrustedCurrentPicks(cache([q(['home', 'me', 'context', 'all', 'x'], state)])).has('me'), false, `${label} cache is not trusted`);
  }
  const others = notice.captureTrustedCurrentPicks(cache([
    q(['home', 'public', 'context', 'all', 'x']), q(['home', 'me', 'participants']), q(['home', 'menu-ranking', 'all', 'all']),
  ]));
  assert.equal(others.size, 0, 'Only signed-in Home context entries count');
  deepEq([...queryKeysModule.queryKeys.home.data('me'), notice.HOME_CONTEXT_KEY.segment], [notice.HOME_CONTEXT_KEY.root, 'me', 'context'],
    'Key shape matches queryKeys.home.data');
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/hooks/useHomeData.ts'), 'utf8'),
    /queryKey: \[\.\.\.queryKeys\.home\.data\(userId\), 'context'/, 'useHomeData still caches currentPicks under that key');
  const empty = notice.captureTrustedCurrentPicks(cache([q(['home', 'me', 'context', 'all', 'x'], { data: { currentPicks: [] } })]));
  deepEq(empty.get('me'), [], 'A settled empty list is a known zero');
});

test('Only successful saves arm the handoff, with the pre-save list captured before the save', () => {
  const armed = [];
  let cacheState = new Map([['me', ['before']]]);
  const imports = {
    '@tanstack/react-query': { useMutation: (options) => options, useQuery: () => ({}), useQueryClient: () => ({}) },
    '@/lib/query/invalidatePickData': { invalidatePickData: () => { cacheState = new Map(); } },
    '@/lib/home/firstPickNotice': {
      captureTrustedCurrentPicks: () => cacheState,
      armFirstPickNotice: (userId, pickId, prior) => armed.push(`${userId}:${pickId}:${prior === undefined || prior === null ? 'unknown' : prior.join('|') || 'none'}`),
    },
    '@/services': { pickService: {}, registrationService: {}, observabilityService: { captureProductEvent: async () => {} } },
  };
  const register = load('hooks/useRegisterPick.ts', imports);
  const choose = load('hooks/useChoosePick.ts', imports);
  const storeInput = { userId: 'me', categoryId: 'ramen' };
  const storeCtx = register.useRegisterItemPick().onMutate(storeInput);
  register.useRegisterItemPick().onSuccess({ pickId: 'p-store', itemId: 'i' }, storeInput, storeCtx);
  cacheState = new Map([['me', []]]);
  const regCtx = register.useRegisterPick().onMutate({ userId: 'me' });
  register.useRegisterPick().onSuccess({ type: 'pick', pick: { id: 'p-reg', userId: 'me', itemId: 'i', categoryId: 'ramen' } }, { userId: 'me' }, regCtx);
  register.useRegisterPick().onSuccess({ type: 'pending_item', item: { id: 'pending' } }, { userId: 'me' }, regCtx);
  cacheState = new Map([['me', []]]);
  const chooseCtx = choose.useChoosePick().onMutate({ categoryId: 'ramen', itemId: 'i', oneLineReview: 'x' });
  choose.useChoosePick().onSuccess({ id: 'p-choose', userId: 'me', itemId: 'i', categoryId: 'ramen' }, {}, chooseCtx);
  cacheState = new Map();
  const unknownCtx = choose.useChoosePick().onMutate({});
  choose.useChoosePick().onSuccess({ id: 'p-unknown', userId: 'me', itemId: 'i', categoryId: 'ramen' }, {}, unknownCtx);
  deepEq(armed, ['me:p-store:before', 'me:p-reg:none', 'me:p-choose:none', 'me:p-unknown:unknown'],
    'Pre-save state is passed through (captured before invalidation); pending items and errors never arm');
  assert.equal(typeof register.useRegisterItemPick().onError, 'undefined', 'No failure path arms it');
});

test('R2 · reply count is complete beyond the first 20 groups and never partial', async () => {
  const filler = (n, kind = 'reply', unread = 0) => Array.from({ length: n }, (_, i) => group(`${kind}-${i}`, kind, unread, `2026-10-0${(i % 5) + 1}T00:00:00Z`));
  const pager = (pages, total, failAt = -1) => {
    const calls = { pages: 0 };
    return { calls, source: {
      unreadCount: async () => total,
      page: async (cursor) => {
        const index = cursor ?? 0;
        calls.pages++;
        if (index === failAt) throw new Error('page failed');
        return { items: pages[index], nextCursor: index + 1 < pages.length ? index + 1 : null };
      },
    } };
  };
  // First 20 groups read or other kinds; the 21st is an unread comment with 2.
  const deep = pager([filler(20, 'reply'), [group('c-21', 'comment', 2, '2026-09-01T00:00:00Z', 'pick-deep')]], 2);
  const deepResult = await early.collectReplyBanner(deep.source);
  assert.equal(deepResult.banner.count, 2, '21st group is counted');
  assert.equal(deepResult.banner.target.pickId, 'pick-deep');
  assert.equal(deep.calls.pages, 2);
  // Other kinds unread up front: still reaches the comment group.
  const mixed = pager([[...filler(19, 'pick_review', 1), group('f', 'fix_needed', 1, '2026-10-01T00:00:00Z')], [group('c', 'comment', 3, '2026-09-01T00:00:00Z')]], 23);
  assert.equal((await early.collectReplyBanner(mixed.source)).banner.count, 3);
  // Every unread event already accounted for on page 1 → no further pages.
  const early1 = pager([[group('c', 'comment', 1, '2026-10-05T00:00:00Z'), ...filler(19)], filler(20)], 1);
  assert.equal((await early.collectReplyBanner(early1.source)).banner.count, 1);
  assert.equal(early1.calls.pages, 1, 'Stops as soon as the badge total is accounted for');
  // Badge 0: no page read, exact zero from the server.
  const zero = pager([filler(20)], 0);
  deepEq(await early.collectReplyBanner(zero.source), { banner: null, unreadTotal: 0 });
  assert.equal(zero.calls.pages, 0);
  // Extra page fails: an error, never a partial "0".
  await assert.rejects(() => early.collectReplyBanner(pager([filler(20), filler(1, 'comment', 1)], 1, 1).source), /page failed/);
  // Bounded: more than maxPages without accounting for everything → incomplete error, not unlimited paging.
  const endless = pager(Array.from({ length: 10 }, () => filler(20)), 5);
  await assert.rejects(() => early.collectReplyBanner(endless.source), (error) => error.name === 'ReplyBannerIncompleteError');
  assert.equal(endless.calls.pages, early.REPLY_BANNER_MAX_PAGES, 'Never pages past the bound');
  // List ends before the (newer) badge total is reached: the whole list was read → complete.
  const ended = pager([[group('c', 'comment', 1, '2026-10-05T00:00:00Z')]], 4);
  assert.equal((await early.collectReplyBanner(ended.source)).banner.count, 1);
});

// Repository: the DB owns the daily draw; no administrator setting is read.
async function repositoryChecks() {
  const { AppError } = load('errors/appError.ts');
  const { mapSupabaseError } = load('errors/mapSupabaseError.ts', { './appError': { AppError } });
  const imports = {
    '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError },
    '@/repositories/supabase/itemChannels': { fetchItemChannels: async () => new Map() },
    '@/repositories/supabase/itemProviders': { fetchItemProviderIds: async () => new Map() },
  };
  for (const name of ['category', 'comment', 'pick', 'item', 'profile']) imports[`@/repositories/mappers/${name}Mapper`] = load(`repositories/mappers/${name}Mapper.ts`);
  imports['@/lib/home/channelFeedMerge'] = load('lib/home/channelFeedMerge.ts');
  const { SupabaseReadRepository } = load('repositories/supabase/supabaseReadRepository.ts', imports);
  const daily = (result) => {
    const client = { rpc: (name, args) => { assert.equal(name, 'home_daily_question'); assert.equal(args, undefined); return result; },
      from: () => assert.fail('No administrator settings read') };
    return new SupabaseReadRepository({}, client);
  };
  assert.equal(await daily({ data: null, error: null }).getDailyQuestionCategoryId(), null, 'Empty eligible catalog → no question');
  assert.equal(await daily({ data: 'naengmyeon', error: null }).getDailyQuestionCategoryId(), 'naengmyeon');
  await assert.rejects(() => daily({ data: null, error: { code: 'PGRST202', message: 'RPC missing' } }).getDailyQuestionCategoryId(), 'Missing migration is an error, never an admin-setting fallback');
  await assert.rejects(() => daily({ data: null, error: { code: '500', message: 'boom' } }).getDailyQuestionCategoryId());
  passed++; console.log('PASS Daily question uses the public DB draw and surfaces failures');
}

// ---------------------------------------------------------------------------------------------
// Rendered Home
// ---------------------------------------------------------------------------------------------
function query(data, extra = {}) {
  return { data, isSuccess: data !== undefined, isPending: data === undefined && !extra.isError, isError: false, isFetching: false,
    isRefetching: false, hasNextPage: false, isFetchNextPageError: false, refetch: () => Promise.resolve(), ...extra };
}
const native = { ...names('Text View Pressable ScrollView FlatList RefreshControl ActivityIndicator Image Modal TextInput'),
  Platform: { OS: 'ios' }, StyleSheet: { create: (value) => value, absoluteFill: {} } };
const ui = names('Avatar BrandMark Button Chip SectionHeader StateCard');
// Same element shape the screen harness renders.
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const jsxRuntime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
const profileName = load('lib/profile/profileName.ts');
const sections = load('components/home-early-sections.tsx', {
  'react/jsx-runtime': jsxRuntime, 'react-native': native, '@/components/ui': ui, '@/components/ui/touch': load('components/ui/touch.ts'), '@/constants/onepick': constants,
  '@/lib/home/questionTitle': load('lib/home/questionTitle.ts'), '@/lib/profile/profileName': profileName,
});

function home(options = {}) {
  const {
    user = { id: 'me' }, counts = countsOf({ ramen: 3 }), question = 'naengmyeon', currentPicks = [], participants = [],
    groups = [], countsQuery, questionQuery, participantsComplete = true, replyQuery, badge,
    // Feed pages and the viewer's context are separate reads (useHomeData); each can be pending/failed alone.
    feed = { picks: [] }, feedError = false, contextPending = false, contextError = false,
    profile = { nickname: null }, feedbackEmail = null, feedbackError = false,
  } = options;
  const calls = { routes: [], shares: [], opened: [] };
  const contextData = contextPending || contextError ? undefined : { currentPicks };
  const feedData = feed && !feedError ? feed : undefined;
  const view = screen('app/(tabs)/index.tsx', {
    'expo-router': { useRouter: () => ({ push: (route) => calls.routes.push(route) }), useFocusEffect: (fn) => { calls.focus = fn; } },
    '@/constants/onepick': constants,
    '@/components/ui': ui,
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user, isLoading: false, error: null, retry: () => {} }) },
    '@/hooks/useHomeData': {
      useHomeData: () => ({
        ...query(contextData && feedData ? { ...contextData, ...feedData } : undefined, { isError: contextError || feedError, isPending: !contextError && !feedError && (!contextData || !feedData) }),
        contextData, isContextError: contextError,
      }),
      useHomeItemRanking: (...args) => {
        calls.itemRanking = args;
        return query([{ itemId: 'jin', itemName: '라면집', categoryId: 'ramen', categoryName: '라면', pickCount: 7, rank: 1, isTied: false, thumbnailUrl: 'https://x/ramen.jpg' }], { refetch: () => { calls.rankingRefetch = (calls.rankingRefetch ?? 0) + 1; } });
      },
      useHomeFoodMenuPickCounts: () => countsQuery ?? query(counts),
      useDailyQuestionCategory: () => questionQuery ?? query(question),
      useHomeParticipantPicks: () => query({ rows: participants, complete: participantsComplete }),
    },
    '@/hooks/useFollow': { useFollowCounts: () => query({ followingCount: 0, followerCount: 0 }), useFollowingFeed: () => query({ items: [], nextCursor: null }) },
    '@/hooks/useExploreData': { useExploreCategories: (enabled) => { calls.categoriesEnabled = enabled; return query(catalog); }, useFoodMenuPickCounts: () => countsQuery ?? query(counts) },
    '@/hooks/useMyProfile': { useMyProfile: (userId) => { calls.profileUserId = userId; return query(userId && profile ? { profile: { id: userId, username: userId, ...profile }, currentPicks } : undefined); } },
    '@/lib/profile/profileName': profileName,
    '@/components/home-feedback-button': load('components/home-feedback-button.tsx', {
      react: { useState: (initial) => [initial, () => {}] },
      'react/jsx-runtime': jsxRuntime,
      'react-native': { ...native, Linking: { openURL: async (url) => { calls.opened.push(url); } } },
      '@/components/ui': ui, '@/constants/onepick': constants,
      '@/hooks/useFeedbackEmail': { useFeedbackEmail: () => query(feedbackError ? undefined : feedbackEmail, { isError: feedbackError, isPending: false }) },
      '@/lib/feedback/email': load('lib/feedback/email.ts'),
    }),
    '@/hooks/useNotifications': {
      useHomeReplyBanner: (userId, enabled) => {
        calls.replies = { userId, enabled };
        const unreadTotal = groups.reduce((sum, g) => sum + g.unread_count, 0);
        const result = replyQuery ?? query(enabled ? { banner: early.replyBanner(groups), unreadTotal } : undefined);
        return { ...result, refetch: () => { calls.replyRefetch = (calls.replyRefetch ?? 0) + 1; return Promise.resolve(); } };
      },
      useNotificationCount: (userId, enabled) => { calls.badge = { userId, enabled }; return query(enabled ? badge : undefined); },
    },
    '@/lib/categories/categoryTree': tree,
    '@/lib/categories/browseScope': load('lib/categories/browseScope.ts', { '@/lib/categories/categoryTree': tree }),
    '@/lib/home/homeCategoryFilters': { HOME_FEED_ROOT_SLUG: 'food', buildHomeCategoryFilters: () => [], filterHomeFeedByCategory: (items) => items },
    '@/lib/home/earlyHome': early,
    '@/lib/home/firstPickNotice': notice,
    '@/lib/share/sharePick': { sharePick: async (input) => { calls.shares.push(input); return 'shared'; } },
    '@/components/home-early-sections': sections,
    '@/components/home-pick-row': names('HomePickRow'), '@/components/home-header': names('HomeHeader'), '@/components/recent-item-card': names('RecentItemCard'),
  });
  view.render();
  const press = (label) => {
    const target = view.find('Pressable', (p) => p.accessibilityLabel === label) ?? view.find('Button', (p) => p.accessibilityLabel === label || p.label === label)
      ?? view.find('Chip', (p) => p.accessibilityLabel === label);
    assert.ok(target, `pressable ${label}`);
    target.onPress();
    return calls.routes.at(-1);
  };
  return { view, calls, press, text: () => view.text() };
}

test('Section switch renders at 0·29 (chips) and 30·31 (많이 고른 메뉴)', () => {
  for (const total of [0, 29]) {
    const { text, calls, view } = home({ counts: countsOf(total ? { ramen: total } : {}) });
    assert.ok(view.all('Chip').some((chip) => /첫 원픽 남기기$/.test(chip.accessibilityLabel)), `total ${total} retains menu actions`);
    assert.match(text(), /아직 정하지 않은 원픽/, `total ${total} shows the one-line title`);
    assert.doesNotMatch(text(), /오늘의 질문|아직 아무도 안 골랐어요|내 원픽 \d+개/, 'Legacy labels are removed');
    assert.doesNotMatch(text(), /최근 7일 원픽 많은 순/, `total ${total} hides 많이 고른 메뉴`);
    assert.equal(calls.itemRanking[2], false, `total ${total} does not fetch the hidden ranking`);
  }
  for (const total of [30, 31]) {
    const { text, calls, view } = home({ counts: countsOf({ ramen: total }) });
    assert.equal(view.all('Chip').filter((chip) => /첫 원픽 남기기$/.test(chip.accessibilityLabel)).length, 0, `total ${total}`);
    assert.doesNotMatch(text(), /아직 정하지 않은 원픽/, `total ${total} hides the title with the chips`);
    assert.match(text(), /최근 7일 원픽 많은 순/, `total ${total} restores 많이 고른 메뉴`);
    assert.equal(calls.itemRanking[2], true, `total ${total} enables the visible ranking`);
  }
  const chips = home({ counts: countsOf({ ramen: 2 }) });
  deepEq(chips.view.all('Chip').map((c) => c.label), ['칼국수', '곱창', '막창', '대창'],
    'Unpicked menus skip picked 라면 and today’s 냉면; only four remain');
  const route = chips.press('곱창 첫 원픽 남기기');
  deepEq(route, { pathname: '/pick/new', params: { categoryId: 'gopchang', menuName: '곱창' } }, 'Chip opens the existing registration flow');
  assert.ok(chips.view.all('ScrollView').some((p) => p.horizontal && p.contentContainerStyle?.gap === 6),
    '2026-10-11 두 줄 구성: chips sit on one sideways-scrolling line under the one-line title');
  assert.doesNotMatch(chips.text(), /다른 메뉴 찾아보기|메뉴를 고르면/, 'No description line and no secondary action');
});

test('Refresh requests ranking only while the popular section is visible', () => {
  for (const total of [0, 29, 30, 31, undefined]) {
    const current = total === undefined ? home({ countsQuery: query(undefined) }) : home({ counts: countsOf({ ramen: total }) });
    current.view.find('RefreshControl').onRefresh();
    assert.equal(current.calls.rankingRefetch ?? 0, total >= 30 ? 1 : 0, `total ${total}`);
  }
});

test('Category tree is deferred unless a visible Home feature needs it', () => {
  assert.equal(home({ question: null, counts: countsOf({ ramen: 30 }) }).calls.categoriesEnabled, false);
  assert.equal(home({ question: null, countsQuery: query(undefined) }).calls.categoriesEnabled, false);
  assert.equal(home({ question: null, counts: countsOf({}) }).calls.categoriesEnabled, true, 'Unpicked menus need names');
  assert.equal(home({ counts: countsOf({ ramen: 30 }) }).calls.categoriesEnabled, true, 'DB-selected daily question needs its menu');
  const participants = ['amy', 'ben', 'cat'].map((id) => row(id, 'ramen', '2026-10-05T00:00:00Z'));
  assert.equal(home({ question: null, counts: countsOf({ ramen: 30 }), participants }).calls.categoriesEnabled, true, 'People need scoped categories');
});

test('Loading and error keep the discovery slot honest', () => {
  const loading = home({ countsQuery: query(undefined) });
  assert.doesNotMatch(loading.text(), /아직 아무도 안 골랐어요|최근 7일 원픽 많은 순/, 'Unknown total shows neither section');
  assert.equal(loading.calls.itemRanking[2], false, 'Unknown total does not speculate by fetching the ranking');
  assert.doesNotMatch(loading.text(), /명이 .* 원픽을 남겼어요/, 'Answer count waits for the shared counts');
  const failed = home({ countsQuery: query(undefined, { isError: true, isPending: false }) });
  assert.match(failed.text(), /메뉴별 원픽 수를 불러오지 못했어요/);
  const questionFailed = home({ questionQuery: query(undefined, { isError: true, isPending: false }) });
  assert.match(questionFailed.text(), /오늘의 질문을 불러오지 못했어요/);
  assert.doesNotMatch(questionFailed.text(), /먹으러 어디 가요/);
});

test('Today’s question: DB daily menu only, answer count, 등록 / 다른 원픽 구경', () => {
  const none = home({ question: null });
  assert.doesNotMatch(none.text(), /오늘의 원픽|먹으러 어디 가요/, 'No eligible daily menu → no question card');
  const closed = home({ question: 'movie' });
  assert.doesNotMatch(closed.text(), /먹으러 어디 가요/, 'A category outside the open food menus is not asked');
  const open = home({ counts: countsOf({ naengmyeon: 4 }) });
  assert.match(open.text(), /냉면 먹으러 어디 가요\?/);
  const titleModule = load('lib/home/questionTitle.ts');
  assert.match(open.text(), new RegExp(titleModule.homeQuestionTitle().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'Fixed title sits on the question card');
  assert.match(open.text(), /4명이 냉면 원픽을 남겼어요\./);
  assert.doesNotMatch(open.text(), /다른 원픽을 남겨요|다른 메뉴 찾아보기/, '0 Picks: the secondary action was removed (2026-10-11 두 줄 구성)');
  deepEq(open.press('냉면 원픽 답하기'), { pathname: '/pick/new', params: { categoryId: 'naengmyeon', menuName: '냉면' } });
  const answered = home({ currentPicks: [row('me', 'naengmyeon', '2026-10-05T00:00:00Z', { id: 'n1' }), row('me', 'ramen', '2026-10-04T00:00:00Z', { id: 'r1' })] });
  assert.doesNotMatch(answered.text(), /다른 원픽을 남겨요/, '1+ Picks');
  deepEq(answered.press('다른 냉면 원픽도 구경해요'), { pathname: '/menu/[slug]', params: { slug: 'naengmyeon' } }, 'Answered → same-menu people Picks, not own detail');
  const zeroAnswers = home({ counts: countsOf({ ramen: 1 }) });
  assert.match(zeroAnswers.text(), /0명이 냉면 원픽을 남겼어요\./, 'A menu nobody answered shows 0, not a made-up number');
});

test('Question image and count stay tied to the selected daily menu', () => {
  const category = catalog.find((c) => c.id === 'naengmyeon');
  category.imageUrl = 'https://example.test/naengmyeon.jpg';
  try {
    const selected = home({ counts: countsOf({ naengmyeon: 12 }) });
    assert.equal(selected.view.find('Image', (p) => p.accessibilityLabel === '냉면 사진').source.uri, category.imageUrl);
    assert.match(selected.text(), /12명이 냉면 원픽을 남겼어요\./);
    const other = home({ question: 'gopchang' });
    assert.equal(other.view.find('Image', (p) => p.source?.uri === category.imageUrl), undefined);
  } finally { category.imageUrl = null; }
});

// #762 (2026-10-11): the question photo and a feed card's menu name open that menu's people Picks.
test('Question photo opens the same menu list before and after answering; registration paths unchanged', () => {
  const gopchang = catalog.find((c) => c.id === 'gopchang');
  gopchang.imageUrl = 'https://example.test/gopchang.jpg';
  try {
    const target = { pathname: '/menu/[slug]', params: { slug: 'gopchang' } };
    const before = home({ question: 'gopchang' });
    const photo = before.view.find('Pressable', (p) => p.accessibilityLabel === '곱창 원픽 목록 보기');
    assert.ok(photo, 'Photo is a labelled button');
    assert.equal(photo.accessibilityRole, 'button');
    assert.ok(before.view.find('Image', (p) => p.accessibilityLabel === '곱창 사진'), 'Same photo is still drawn inside');
    deepEq(before.press('곱창 원픽 목록 보기'), target, 'Not answered → menu list');
    deepEq(before.press('곱창 원픽 답하기'), { pathname: '/pick/new', params: { categoryId: 'gopchang', menuName: '곱창' } }, 'Answer button keeps registration');
    assert.doesNotMatch(before.text(), /다른 원픽을 남겨요/, 'Secondary CTA was removed (2026-10-11 두 줄 구성)');
    const after = home({ question: 'gopchang', currentPicks: [row('me', 'gopchang', '2026-10-05T00:00:00Z', { id: 'g1' })] });
    deepEq(after.press('곱창 원픽 목록 보기'), target, 'Answered → the same destination');
    deepEq(after.press('다른 곱창 원픽도 구경해요'), target, 'Photo and browse button agree');
    // No photo → nothing extra to press.
    const plain = home({ question: 'naengmyeon' });
    assert.equal(plain.view.find('Pressable', (p) => p.accessibilityLabel === '냉면 원픽 목록 보기'), undefined);
  } finally { gopchang.imageUrl = null; }
});

test('Feed card menu name links to its public menu; others keep the old target', () => {
  const feedPick = (id, categoryId, channels) => ({ pickId: id, userId: 'u', username: 'u', itemId: 'item-' + id, name: '가게',
    categoryId, categoryName: 'x', oneLineReview: '', thumbnailUrl: null, startedAt: '2026-10-05T00:00:00Z', channels });
  const view = home({ feed: { picks: [feedPick('a', 'ramen', ['offline']), feedPick('b', 'movie', ['offline']), feedPick('c', 'nope', [])] } });
  const rows = view.view.all('HomePickRow');
  assert.equal(rows.length, 3);
  rows[0].onOpenMenu();
  deepEq(view.calls.routes.at(-1), { pathname: '/menu/[slug]', params: { slug: 'ramen' } }, 'Real menu → its own list, no other menu');
  assert.equal(rows[1].onOpenMenu, undefined, 'A category outside the public food menus never links');
  assert.equal(rows[2].onOpenMenu, undefined, 'Unknown category never links');
  rows[0].onOpenItem();
  deepEq(view.calls.routes.at(-1), { pathname: '/item/[itemId]', params: { itemId: 'item-a' } }, 'Photo/review keep item detail');
  rows[0].onOpenProfile();
  assert.equal(view.calls.routes.at(-1).pathname, '/u/[username]', 'Profile target unchanged');
});

test('First Pick: success shows the completion line once; cancel/failure never do', () => {
  const first = [row('me', 'ramen', '2026-10-06T00:00:00Z', { id: 'new-1' })];
  const cancelled = home({ currentPicks: [] });
  assert.doesNotMatch(cancelled.text(), /원픽 완료/, 'Cancelled registration (no save) shows no completion line');
  notice.armFirstPickNotice('me', 'new-1', []);
  const shown = home({ currentPicks: first });
  shown.view.flushEffects(); shown.view.render();
  assert.match(shown.text(), /원픽 완료 · 친구에게 공유해요/, 'Just after the first successful save');
  shown.press('원픽 완료 · 친구에게 공유해요');
  assert.equal(shown.calls.shares[0].pickId, 'new-1', 'Shares the new Pick through the existing share path');
  assert.equal(notice.peekFirstPickNotice('me'), null, 'Handoff consumed');
  const leave = shown.calls.focus(); leave(); shown.view.render();
  assert.doesNotMatch(shown.text(), /원픽 완료/, 'Leaving Home ends the one-time line');
  assert.doesNotMatch(shown.text(), /다른 원픽을 남겨요/);
  const again = home({ currentPicks: first }); again.view.flushEffects(); again.view.render();
  assert.doesNotMatch(again.text(), /원픽 완료/, 'Never shown a second time');
  notice.armFirstPickNotice('me', 'new-2', first);
  const notFirst = home({ currentPicks: [...first, row('me', 'gopchang', '2026-10-06T01:00:00Z', { id: 'new-2' })] });
  notFirst.view.flushEffects(); notFirst.view.render();
  assert.doesNotMatch(notFirst.text(), /원픽 완료/, 'A second Pick is not a first Pick');
  assert.equal(notice.peekFirstPickNotice('me'), null);
});

test('R1 · replacing the only Pick (1→1) or an unknown pre-save state never shows completion', () => {
  const old = row('me', 'ramen', '2026-10-01T00:00:00Z', { id: 'old' });
  const replacement = [row('me', 'ramen', '2026-10-06T00:00:00Z', { id: 'replacement' })];
  notice.armFirstPickNotice('me', 'replacement', [old]);
  const replaced = home({ currentPicks: replacement }); replaced.view.flushEffects(); replaced.view.render();
  assert.doesNotMatch(replaced.text(), /원픽 완료/, '1 → 1 replacement');
  assert.doesNotMatch(replaced.text(), /다른 원픽을 남겨요/);
  assert.equal(notice.peekFirstPickNotice('me'), null, 'Handoff consumed (ruled out)');
  // An old out-of-scope Pick (another menu set) does not make a new in-scope Pick "not first".
  notice.armFirstPickNotice('me', 'replacement', [row('me', 'movie', '2026-10-01T00:00:00Z', { id: 'film' })]);
  const outside = home({ currentPicks: replacement }); outside.view.flushEffects(); outside.view.render();
  assert.match(outside.text(), /원픽 완료/, 'Only Home’s scope counts toward 0 → 1');
  notice.armFirstPickNotice('me', 'replacement', undefined);
  const unknown = home({ currentPicks: replacement }); unknown.view.flushEffects(); unknown.view.render();
  assert.doesNotMatch(unknown.text(), /원픽 완료/, 'Unknown pre-save state');
});

test('People row: 2 hidden, 3 shown, opens the existing profile', () => {
  const people = (n) => Array.from({ length: n }, (_, i) => row(`user${i}`, 'ramen', `2026-10-0${i + 1}T00:00:00Z`));
  assert.doesNotMatch(home({ participants: people(2) }).text(), /함께하는 사람들/);
  const three = home({ participants: people(3) });
  assert.match(three.text(), /함께하는 사람들/);
  assert.match(three.text(), /3명/);
  assert.ok(three.text().indexOf('모두의 원픽') < three.text().indexOf('함께하는 사람들'), 'People follow the feed');
  deepEq(three.press('user2 프로필 보기, 원픽 1개'), { pathname: '/u/[username]', params: { username: 'user2', returnTo: '/' } });
  assert.doesNotMatch(home({ participants: people(3), participantsComplete: false }).text(), /함께하는 사람들/,
    'Partial reads never show undercounted people');
});

test('Reply banner: 0 hidden, 1 and many route to the latest group with read params only', () => {
  assert.doesNotMatch(home().text(), /새 답글/);
  const one = home({ groups: [group('c1', 'comment', 1, '2026-10-05T00:00:00Z', 'pick-a')] });
  assert.match(one.text(), /내 원픽에 새 답글 1개/);
  const many = home({ groups: [group('c1', 'comment', 2, '2026-10-04T00:00:00Z', 'pick-a'), group('c2', 'comment', 1, '2026-10-06T00:00:00Z', 'pick-b'), group('r1', 'reply', 4, '2026-10-07T00:00:00Z')] });
  assert.match(many.text(), /내 원픽에 새 답글 3개/);
  deepEq(many.press('내 원픽에 새 답글 3개 보기'), { pathname: '/pick/[pickId]', params: {
    pickId: 'pick-b', notificationGroupId: 'c2', notificationSnapshot: '2026-10-06T00:00:00Z', notificationKind: 'comment',
  } }, 'Same destination + per-group snapshot the notifications tab uses; nothing else is marked read');
});

test('R2 · unknown or incomplete reply count hides the banner instead of claiming 0', () => {
  const failed = home({ replyQuery: query(undefined, { isError: true, isPending: false }) });
  assert.doesNotMatch(failed.text(), /새 답글/);
  const deep = home({ replyQuery: query({ banner: { count: 2, target: { groupId: 'c-21', snapshot: 's', pickId: 'pick-deep' } }, unreadTotal: 2 }) });
  assert.match(deep.text(), /내 원픽에 새 답글 2개/, 'Banner comes from the complete count, not the inbox tab cache');
});

test('R3 · refresh and a moved badge refetch the reply banner (signed in)', () => {
  const member = home({ groups: [group('c1', 'comment', 1, '2026-10-05T00:00:00Z')], badge: 1 });
  member.view.flushEffects();
  assert.equal(member.calls.replyRefetch, undefined, 'Badge unchanged → no extra request');
  member.view.find('RefreshControl').onRefresh();
  assert.equal(member.calls.replyRefetch, 1, 'Explicit Home refresh includes the reply banner');
  const moved = home({ groups: [group('c1', 'comment', 1, '2026-10-05T00:00:00Z')], badge: 3 });
  moved.view.flushEffects();
  assert.equal(moved.calls.replyRefetch, 1, 'New unread events on the polled badge refresh the banner');
  const readElsewhere = home({ groups: [group('c1', 'comment', 1, '2026-10-05T00:00:00Z')], badge: 0 });
  readElsewhere.view.flushEffects();
  assert.equal(readElsewhere.calls.replyRefetch, 1, 'Read on another device (badge dropped) refreshes it too');
});

test('Signed-out Home: no reply/invite, question still asks, login handled by registration', () => {
  const guest = home({ user: null });
  assert.equal(guest.calls.replies.enabled, false, 'Replies are never queried signed out');
  assert.equal(guest.calls.badge.enabled, false);
  guest.view.find('RefreshControl').onRefresh();
  assert.equal(guest.calls.replyRefetch, undefined, 'Signed-out refresh never requests notifications');
  assert.doesNotMatch(guest.text(), /새 답글|친구 초대 링크/);
  assert.match(guest.text(), /냉면 먹으러 어디 가요\?/);
  assert.doesNotMatch(guest.text(), /다른 원픽을 남겨요/);
  const member = home();
  assert.ok(member.view.find('HomeInviteRow') === undefined, 'Invite row is the real component, not a stub');
  assert.match(member.text(), /친구 초대 링크/);
  assert.equal(member.press('친구 초대 링크 공유하러 가기'), '/profile', 'Invite reuses the existing profile share path');
  assert.doesNotMatch(member.text(), /의견을 보내요/, 'No public feedback address → no feedback action (never a made-up mailbox)');
});

test('#762 · question, reply banner, people and invite do not wait on the feed pages', () => {
  const participants = Array.from({ length: 3 }, (_, i) => row(`user${i}`, 'ramen', `2026-10-0${i + 1}T00:00:00Z`));
  const groups = [group('g1', 'comment', 2, '2026-10-05T00:00:00Z')];
  const pending = home({ feed: null, participants, groups });
  assert.match(pending.text(), /원픽을 불러오고 있어요/, 'Feed loading card still shows');
  assert.match(pending.text(), /냉면 먹으러 어디 가요\?/, 'Question is asked while the feed loads');
  assert.match(pending.text(), /내 원픽에 새 답글 2개/, 'Reply banner does not wait for the feed');
  assert.match(pending.text(), /함께하는 사람들/, 'People row does not wait for the feed');
  assert.match(pending.text(), /친구 초대 링크/, 'Invite does not wait for the feed');
  const failed = home({ feedError: true, participants, groups });
  assert.match(failed.text(), /원픽을 불러오지 못했어요/, 'Feed failure is reported where the feed goes');
  assert.match(failed.text(), /냉면 먹으러 어디 가요\?/, 'A failed feed never hides today’s question');
  assert.match(failed.text(), /내 원픽에 새 답글 2개|함께하는 사람들|친구 초대 링크/);
  assert.match(failed.text(), /함께하는 사람들/); assert.match(failed.text(), /친구 초대 링크/);
  deepEq(failed.press('냉면 원픽 답하기'), { pathname: '/pick/new', params: { categoryId: 'naengmyeon', menuName: '냉면' } }, 'Registration CTA stays usable');
  // The viewer's own Picks decide 답하기 vs 구경해요; without them nothing is pretended.
  const contextPending = home({ contextPending: true, participants, groups });
  assert.doesNotMatch(contextPending.text(), /먹으러 어디 가요|함께하는 사람들|친구 초대 링크|새 답글/, 'Unknown viewer context shows neither state');
  const contextFailed = home({ contextError: true, participants });
  assert.match(contextFailed.text(), /원픽을 불러오지 못했어요/);
  assert.doesNotMatch(contextFailed.text(), /먹으러 어디 가요/, 'A failed context is an error, not an unanswered question');
  const answeredOffline = home({ feedError: true, currentPicks: [row('me', 'naengmyeon', '2026-10-05T00:00:00Z', { id: 'n1' })] });
  assert.match(answeredOffline.text(), /다른 냉면 원픽도 구경해요/, 'Answered state comes from the context read alone');
});

test('#804 · question names the viewer by nickname, 원픽 사용자 without one, nobody signed out', () => {
  const named = home({ profile: { nickname: '오리' } });
  assert.match(named.text(), /오리님, 냉면 먹으러 어디 가요\?/);
  assert.equal(named.calls.profileUserId, 'me', 'Reads the same cached profile as the Profile tab');
  const unnamed = home({ profile: { nickname: null } });
  assert.match(unnamed.text(), /원픽 사용자님, 냉면 먹으러 어디 가요\?/, 'Mention fallback is the user-confirmed 원픽 사용자, never the username');
  assert.doesNotMatch(unnamed.text(), /me님/);
  const blank = home({ profile: { nickname: '   ' } });
  assert.match(blank.text(), /원픽 사용자님, 냉면/);
  const loading = home({ profile: null });
  assert.match(loading.text(), /^(?:(?!님, 냉면).)*냉면 먹으러 어디 가요\?/m, 'No name while the profile is unknown');
  const guest = home({ user: null });
  assert.equal(guest.calls.profileUserId, undefined, 'Signed-out viewers never query a profile');
  assert.match(guest.text(), /냉면 먹으러 어디 가요\?/);
  assert.doesNotMatch(guest.text(), /원픽 사용자님/);
});

test('#804 · people row shows nickname when set, username otherwise; route keeps the username', () => {
  const participants = [row('ann', 'ramen', '2026-10-03T00:00:00Z', { nickname: '앤' }), row('bob', 'ramen', '2026-10-02T00:00:00Z'), row('cy', 'ramen', '2026-10-01T00:00:00Z', { nickname: ' ' })];
  const view = home({ participants });
  assert.match(view.text(), /앤/); assert.doesNotMatch(view.text(), /\bann\b/, 'Nickname replaces the username label');
  assert.match(view.text(), /bob/); assert.match(view.text(), /cy/, 'Blank nickname falls back to the username');
  deepEq(view.press('앤 프로필 보기, 원픽 1개'), { pathname: '/u/[username]', params: { username: 'ann', returnTo: '/' } }, 'Profile route stays on the username');
  assert.equal(view.view.find('Avatar', (p) => p.name === '앤')?.size, 64);
});

test('#831 · 의견 보내기 sits beside the invite: stored address opens mailto, NULL/read error hide it', () => {
  const configured = home({ feedbackEmail: 'hello@onepick.test' });
  assert.match(configured.text(), /친구 초대 링크[\s\S]*의견을 보내요/, 'Feedback follows the invite in the same row');
  assert.equal(configured.view.find('HomeInviteRow'), undefined, 'Rendered through the real invite row');
  configured.press('의견을 보내요');
  assert.equal(configured.calls.opened.at(-1), 'mailto:hello%40onepick.test?subject=' + encodeURIComponent('원픽 의견'));
  assert.doesNotMatch(configured.text(), /hello@onepick.test/, 'Address is not printed until the mail app fails');
  assert.doesNotMatch(home({ feedbackEmail: null }).text(), /의견을 보내요/, 'NULL setting → hidden');
  assert.doesNotMatch(home({ feedbackError: true }).text(), /의견을 보내요/, 'Read error → hidden');
  assert.doesNotMatch(home({ user: null, feedbackEmail: 'hello@onepick.test' }).text(), /의견을 보내요/, 'Signed out → no invite row, no feedback');
  assert.doesNotMatch(home({ feedbackEmail: 'hello@onepick.test', feed: null }).text(), /sent|자동/, 'Nothing is auto-sent');
});

test('Hidden early-MVP entries stay hidden; feed is the single 모두의 원픽', () => {
  const { text, view } = home();
  assert.match(text(), /모두의 원픽/);
  assert.equal(view.find('Pressable', (p) => p.accessibilityLabel === '팔로잉 원픽 보기'), undefined, 'No following scope');
  assert.equal(view.find('Chip', (p) => / 카테고리 보기$/.test(p.accessibilityLabel ?? '')), undefined, 'No category filter');
  assert.doesNotMatch(text(), /랭킹|단골|AI/, 'No ranking/단골모임/AI entry on early Home');
});

// Feed Card v3 (#810): preserve the current main implementation without legacy badges.
test('Feed card v3 keeps content and omits legacy channel badges', () => {
  const row = load('components/home-pick-row.tsx', {
    'react/jsx-runtime': jsxRuntime, 'react-native': native, '@/components/ui': ui, '@/components/pick-photo': names('PickPhoto'),
    '@/components/current-pick-flag': names('CurrentPickFlag'), '@/components/store-badge': names('StoreBadge'),
    '@/constants/onepick': constants, '@/components/ui/touch': load('components/ui/touch.ts'),
  });
  const visitTree = (channels) => {
    const nodes = [];
    const visit = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(visit);
      if (typeof n.type === 'function') return visit(n.type(n.props)); nodes.push(n); visit(n.props?.children); };
    visit(row.HomePickRow({ pick: { pickId: 'x', userId: 'u', username: 'u', itemId: 'i', name: '가게', categoryId: 'ramen', categoryName: '라면', oneLineReview: '이유', thumbnailUrl: 'https://x', channels }, mine: false, onOpenItem: () => {}, onOpenProfile: () => {} }));
    return nodes;
  };
  // #762: the menu line of a provider-backed row opens the menu list (44px+ target); legacy rows keep detail.
  const pressables = (pick, extra) => {
    const nodes = [];
    const visit = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(visit);
      if (typeof n.type === 'function') return visit(n.type(n.props)); nodes.push(n); visit(n.props?.children); };
    visit(row.HomePickRow({ pick, mine: false, onOpenItem: () => 'item', onOpenProfile: () => 'profile', onOpenProvider: () => 'provider', ...extra }));
    return nodes.filter((n) => n.type === 'Pressable').map((n) => n.props);
  };
  const base = { pickId: 'x', userId: 'u', username: 'u', itemId: 'i', name: '가게', categoryId: 'miyeokguk', categoryName: '미역국', oneLineReview: '이유', thumbnailUrl: 'https://x' };
  const linked = pressables({ ...base, channels: ['offline'] }, { onOpenMenu: () => 'menu' });
  const menuLink = linked.find((p) => p.accessibilityLabel === '미역국 원픽 목록 보기');
  assert.ok(menuLink, 'Menu name is a labelled link');
  assert.equal(menuLink.onPress(), 'menu');
  const flat = (style) => Object.assign({}, ...[].concat(style({ pressed: false })).filter(Boolean));
  const hit = flat(menuLink.style);
  assert.ok(constants.OnePickType.title.lineHeight + 2 * hit.paddingVertical >= 44, '44px minimum touch area');
  assert.equal(hit.marginVertical, -hit.paddingVertical, 'Visual layout unchanged');
  assert.equal(linked.find((p) => p.accessibilityLabel === '가게 매장 보기').onPress(), 'provider', 'Store link unchanged');
  assert.equal(linked.find((p) => p.accessibilityLabel === 'u 프로필 보기').onPress(), 'profile', 'Profile link unchanged');
  assert.ok(linked.filter((p) => p.accessibilityLabel?.endsWith('상세 보기')).every((p) => p.onPress() === 'item'), 'Photo/review keep detail');
  const legacy = pressables({ ...base, channels: [] }, { onOpenMenu: () => 'menu' });
  assert.equal(legacy.some((p) => p.accessibilityLabel === '미역국 원픽 목록 보기'), false, 'Legacy row title is the item name, not a menu');
  const noMenu = pressables({ ...base, channels: ['online'] }, {});
  assert.equal(noMenu.find((p) => p.accessibilityLabel === '가게 상세 보기' && JSON.stringify(p.children).includes('미역국')).onPress(), 'item', 'Without a menu link the line keeps item detail');
  const offline = visitTree(['offline']);
  assert.equal(offline.some((n) => n.type === 'StoreBadge'), false, 'v3 omits the legacy store badge');
  assert.ok(JSON.stringify(offline).includes('이유'), 'Review content remains visible');
  const online = visitTree(['online']);
  assert.equal(online.some((n) => n.type === 'StoreBadge'), false, 'Online card never shows the store badge');
  assert.ok(JSON.stringify(online).includes('가게'), 'Provider name remains visible');
});

Promise.all(asyncTests).then(repositoryChecks).then(() => {
  console.log(`Early-MVP Home (30E) checks passed: ${passed}. Mock data only; live DB wiring is verified separately.`);
}).catch((error) => { console.error(error); process.exitCode = 1; });


