const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name) => {
    if (name in imports) return imports[name];
    throw new Error(name);
  } });
  return exports;
}
async function main() {
  const { queryKeys } = load('lib/query/queryKeys.ts');
  let contextOptions, feedOptions, contextRequest, feedRequest;
  let contextRefetches = 0, feedRefetches = 0;
  const contextResult = {
    data: { openCategories: ['open'], currentPicks: ['current'] },
    error: null, isError: false, isPending: false, isFetching: false, isRefetching: false,
    refetch: async () => { contextRefetches++; return contextResult; },
  };
  const feedResult = {
    data: { picks: [{ pickId: 'a' }], nextCursor: null },
    error: null, isError: false, isPending: false, isFetching: false, isRefetching: false,
    hasNextPage: true, isFetchNextPageError: false,
    fetchNextPage: async () => {}, refetch: async () => { feedRefetches++; return feedResult; },
  };
  const { useHomeData } = load('hooks/useHomeData.ts', {
    '@tanstack/react-query': {
      useQuery: (options) => { contextOptions = options; return contextResult; },
      useInfiniteQuery: (options) => { feedOptions = options; return feedResult; },
    },
    '@/lib/query/queryKeys': { queryKeys },
    '@/services/homeServiceInstance': { homeService: {
      getHomeContext: (user) => { contextRequest = user; return contextResult.data; },
      getHomePicks: (cursor) => { feedRequest = cursor; return feedResult.data; },
    } },
  });

  const query = useHomeData('me');
  assert.equal(query.data.currentPicks[0], 'current');
  assert.equal(query.data.picks[0].pickId, 'a');
  assert.equal(contextOptions.staleTime, 5 * 60_000, 'Home context gets a long stale window');
  // 이웃 제안 (2026-10-11) reveals more rows while scrolling, like /feed: no maxPages window,
  // so rows already on screen are never dropped (each server page is still 20 rows).
  assert.equal(feedOptions.maxPages, undefined, 'Home keeps every loaded page while the user scrolls');

  const cursor = { timestamp: '2026-09-17T12:00:00.123456+00:00', id: 'page-one-last' };
  contextOptions.queryFn();
  feedOptions.queryFn({ pageParam: cursor });
  assert.equal(contextRequest, 'me');
  assert.equal(feedRequest, cursor);
  assert.equal(feedOptions.getNextPageParam({ nextCursor: cursor }), cursor);
  assert.equal(feedOptions.getNextPageParam({ nextCursor: null }), undefined);
  assert.equal(feedOptions.getPreviousPageParam(), undefined);

  const privateKey = JSON.stringify(feedOptions.queryKey);
  useHomeData();
  assert.notEqual(privateKey, JSON.stringify(feedOptions.queryKey), 'Public and private feed caches stay separate');
  useHomeData('me', false);
  assert.equal(contextOptions.enabled, false);
  assert.equal(feedOptions.enabled, false);

  const selected = feedOptions.select({ pages: [
    { picks: [{ pickId: 'a' }, { pickId: 'b' }], nextCursor: cursor },
    { picks: [{ pickId: 'b' }, { pickId: 'c' }], nextCursor: null },
  ], pageParams: [null, cursor] });
  assert.equal(selected.picks.map((p) => p.pickId).join(','), 'a,b,c', 'A Pick moving between pages is shown once');

  await query.refetch({ cancelRefetch: false });
  assert.equal(contextRefetches, 1, 'Manual refresh updates context once, not once per page');
  assert.equal(feedRefetches, 1);

  const contextOnly = useHomeData('me', true, false);
  assert.equal(contextOptions.enabled, true, 'Following Home still loads shared context');
  assert.equal(feedOptions.enabled, false, 'Following Home does not load the hidden public feed');
  assert.equal(contextOnly.data.currentPicks[0], 'current');
  assert.equal(contextOnly.data.picks.length, 0, 'Disabled public feed never leaks cached rows into following Home');
  await contextOnly.refetch({ cancelRefetch: false });
  assert.equal(contextRefetches, 2, 'Following refresh may refresh shared context');
  assert.equal(feedRefetches, 1, 'Following refresh does not refetch the hidden public feed');

  // Preserve the existing repository cursor/lookahead regression coverage.
  const { AppError } = load('errors/appError.ts');
  const imports = { '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError: (e) => e },
    '@/repositories/supabase/itemChannels': { fetchItemChannels: async () => new Map() },
    '@/repositories/supabase/itemProviders': { fetchItemProviderIds: async () => new Map() } };
  for (const name of ['category', 'comment', 'pick', 'item', 'profile']) {
    imports[`@/repositories/mappers/${name}Mapper`] = load(`repositories/mappers/${name}Mapper.ts`);
  }
  imports['@/lib/home/channelFeedMerge'] = load('lib/home/channelFeedMerge.ts');
  const { SupabaseReadRepository } = load('repositories/supabase/supabaseReadRepository.ts', imports);
  let rows = Array.from({ length: 21 }, (_, i) => ({
    item_id: 'item-'+i, last_picked_at: cursor.timestamp, pick_count: 3,
    latest_pick_id: i === 0 ? 'pick-0' : null,
    latest_picker_username: i === 0 ? 'friend' : null,
    latest_pick_review: i === 0 ? '친구의 선택 이유' : null,
  }));
  const repo = new SupabaseReadRepository({ storage: {} }, { rpc: (name, params) => {
    assert.equal(name, 'home_showcase_page');
    assert.equal(params.p_before_time, cursor.timestamp); assert.equal(params.p_after_id, cursor.id);
    return { single: async () => ({ data: { minimum_pick_count: 3, items: rows } }) };
  } });
  let page = await repo.getHomeShowcase(cursor);
  assert.equal(page.items.length, 20);
  assert.equal(page.nextCursor.id, 'item-19');
  assert.equal(page.nextCursor.timestamp, cursor.timestamp, 'Preserve microsecond cursor precision');
  assert.equal(page.items[0].latestPickId, 'pick-0');
  assert.equal(page.items[0].latestPickerUsername, 'friend');
  assert.equal(page.items[0].latestPickReview, '친구의 선택 이유');
  rows = rows.slice(0, 20); page = await repo.getHomeShowcase(cursor);
  assert.equal(page.nextCursor, null, 'Exact last page does not request another page');

  // Feed cards label when a Pick was made, relative to now, in short Korean.
  const { formatRelativeTime } = load('lib/format/relativeTime.ts');
  const now = new Date('2026-09-21T12:00:00+09:00');
  assert.equal(formatRelativeTime('2026-09-21T11:59:40+09:00', now), '방금');
  assert.equal(formatRelativeTime('2026-09-21T11:15:00+09:00', now), '45분 전');
  assert.equal(formatRelativeTime('2026-09-21T03:00:00+09:00', now), '9시간 전');
  assert.equal(formatRelativeTime('2026-09-18T12:00:00+09:00', now), '3일 전');
  assert.match(formatRelativeTime('2026-08-30T12:00:00+09:00', now), /^8월 30일$/);
  assert.equal(formatRelativeTime('2025-03-01T12:00:00+09:00', now), '2025.03.01');
  assert.equal(formatRelativeTime('not-a-date', now), '', 'Bad timestamps render nothing instead of NaN');
  assert.equal(formatRelativeTime('2026-09-21T12:05:00+09:00', now), '방금', 'Clock skew never shows a negative age');

  console.log('Continuous home passed: cached context, single-read pagination, kept pages, deduplication and relative time labels.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
