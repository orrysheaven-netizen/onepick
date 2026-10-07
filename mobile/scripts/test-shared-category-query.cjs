const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { QueryClient, QueryObserver } = require('@tanstack/react-query');
const { load } = require('./mvp-screen-harness.cjs');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', 'src', relative), 'utf8');
const home = read('app/(tabs)/index.tsx');
const service = read('services/homeService.ts');
const hooks = read('hooks/useExploreData.ts');

assert.doesNotMatch(service, /getOpenCategories\(/, 'Home context must not repeat the category tree query');
// Home's feature/session gates and the dialog mount are exercised by
// test-home-screen.cjs and test-home-search-loading.cjs.
assert.doesNotMatch(home, /useExploreCategories\(Boolean\(data\)\)/,
  'Category browsing must not wait for Home data');
assert.match(hooks, /staleTime: CATEGORY_BROWSE_STALE_TIME/);
assert.match(hooks, /CATEGORY_BROWSE_STALE_TIME = 5 \* 60_000/);

async function main() {
  let reads = 0;
  const categories = [{ id: 'ramen', name: '라면' }];
  const { useExploreCategories } = load('hooks/useExploreData.ts', {
    '@tanstack/react-query': { useQuery: (options) => options },
    '@/lib/query/queryKeys': { queryKeys: { categories: { browse: ['categories', 'browse'] } } },
    '@/services/exploreServiceInstance': { exploreService: { getCategories: async () => { reads++; return categories; } } },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const unsubscribe = [];
  try {
    const homeObserver = new QueryObserver(client, useExploreCategories(false));
    unsubscribe.push(homeObserver.subscribe(() => {}));
    await new Promise(setImmediate);
    assert.equal(reads, 0, 'Disabled Home category observer performs no request');
    const searchObserver = new QueryObserver(client, useExploreCategories());
    unsubscribe.push(searchObserver.subscribe(() => {}));
    await new Promise(setImmediate);
    assert.equal(reads, 1, 'Opening search starts the category request');
    assert.deepEqual(searchObserver.getCurrentResult().data, categories);
    assert.deepEqual(homeObserver.getCurrentResult().data, categories, 'Both surfaces share the same cache');
    const reopened = new QueryObserver(client, useExploreCategories());
    unsubscribe.push(reopened.subscribe(() => {}));
    await new Promise(setImmediate);
    assert.equal(reads, 1, 'Reopening within staleTime reuses the tree without another request');
  } finally {
    unsubscribe.forEach((stop) => stop());
    client.clear();
  }
  console.log('Shared category query passed: deferred Home request, search activation and shared warm cache.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

