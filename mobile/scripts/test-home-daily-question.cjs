const assert = require('node:assert/strict');
const { load } = require('./mvp-screen-harness.cjs');
const { queryKeys } = load('lib/query/queryKeys.ts');
let reads = 0;
const hooks = load('hooks/useHomeData.ts', {
  '@tanstack/react-query': { useQuery: (o) => o, useInfiniteQuery: (o) => o, keepPreviousData: (v) => v },
  '@/lib/query/queryKeys': { queryKeys },
  '@/services/homeServiceInstance': { homeService: { getDailyQuestionCategoryId: async () => { reads++; return 'db-menu'; } } },
});
async function main() {
  const { dailyQuestionRefreshDelay } = hooks;
  assert.equal(dailyQuestionRefreshDelay(Date.parse('2026-10-08T14:59:59.000Z')), 1100, 'Korean midnight is 15:00 UTC');
  assert.equal(dailyQuestionRefreshDelay(Date.parse('2026-10-08T15:00:00.000Z')), 86400100, 'Next Korean midnight after rollover');
  assert.equal(dailyQuestionRefreshDelay(Date.parse('2026-12-31T14:59:59.999Z')), 101, 'Year boundary');
  const query = hooks.useDailyQuestionCategory();
  assert.equal(await query.queryFn(), 'db-menu'); assert.equal(reads, 1);
  assert.equal(query.enabled, true);
  assert.equal(hooks.useDailyQuestionCategory(false).enabled, false, 'Session errors still gate requests');
  assert.equal(query.refetchOnWindowFocus, 'always', 'Returning across midnight rereads the server even with warm cache');
  assert.equal(query.refetchOnReconnect, 'always', 'An offline midnight refresh recovers on reconnection');
  assert.ok(query.refetchInterval() > 0 && query.refetchInterval() <= 86400100);
  console.log('Daily question checks passed: DB selection, Korean midnight scheduling, focus/reconnect and session gate.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
