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
    if (name === 'react/jsx-runtime') return require(name);
    throw new Error(name);
  } });
  return exports;
}
async function main() {
  const { queryKeys } = load('lib/query/queryKeys.ts');
  let request;
  const { useHomeData } = load('hooks/useHomeData.ts', {
    '@tanstack/react-query': { useInfiniteQuery: (options) => options },
    '@/lib/query/queryKeys': { queryKeys },
    '@/services': { homeService: { getHomeData: (user, cursor) => { request = { user, cursor }; } } },
  });
  const options = useHomeData('me');
  const cursor = { timestamp: '2026-09-17T12:00:00.123456+00:00', id: 'a1111111-1111-4111-8111-111111111111' };
  options.queryFn({ pageParam: cursor });
  assert.equal(request.user, 'me'); assert.equal(request.cursor, cursor);
  assert.equal(options.getNextPageParam({ nextCursor: cursor }), cursor);
  assert.equal(options.getNextPageParam({ nextCursor: null }), undefined);
  assert.equal(useHomeData('me', false).enabled, false);
  assert.notDeepEqual(options.queryKey, useHomeData().queryKey);
  assert.notDeepEqual(options.queryKey, useHomeData('other').queryKey);
  assert.equal(options.queryKey.at(-1), 'people-v1', 'Do not reuse aggregate-feed caches');
  const entry = (pickId, userId = 'friend') => ({ pickId, userId, itemId: 'same-product' });
  const result = options.select({ pages: [
    { currentPicks: ['current'], featuredPicks: [entry('a'), entry('b', 'second')] },
    { currentPicks: [], featuredPicks: [entry('b', 'second'), entry('c'), entry('mine', 'me')] },
  ] });
  assert.equal(result.featuredPicks.map((p) => p.pickId).join(','), 'a,b,c', 'Deduplicate Picks, not products or authors; never show self');
  assert.equal(result.currentPicks[0], 'current');

  const { AppError } = load('errors/appError.ts');
  const imports = { '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError: (e) => e } };
  for (const name of ['category', 'comment', 'pick', 'item', 'profile']) imports[`@/repositories/mappers/${name}Mapper`] = load(`repositories/mappers/${name}Mapper.ts`);
  const { SupabaseReadRepository } = load('repositories/supabase/supabaseReadRepository.ts', imports);
  const poster = 'https://image.tmdb.org/t/p/w342/example.jpg';
  let failure = null;
  let rows = Array.from({ length: 21 }, (_, i) => ({ pick_id: 'pick-'+i, item_id: 'same-product', user_id: 'u'+i,
    username: 'u'+i, category_id: 'cat', category_name: '영화', item_name: 'Movie', one_line_review: 'Reason '+i,
    started_at: cursor.timestamp, thumbnail_path: null, image_path: null, image_source_url: poster }));
  const storagePaths = [];
  const client = { rpc: async (name, params) => {
    assert.equal(name, 'home_pick_feed_page');
    assert.equal(params.p_before_time, cursor.timestamp); assert.equal(params.p_before_id, cursor.id);
    assert.equal(Object.keys(params).length, 2, 'Viewer identity is server-derived, never passed as an arbitrary RPC parameter');
    return { data: rows, error: failure };
  }, storage: { from: (bucket) => {
    assert.equal(bucket, 'item-photos');
    return { getPublicUrl: (file) => { storagePaths.push(file); return { data: { publicUrl: 'https://storage.test/'+file } }; } };
  } } };
  const repo = new SupabaseReadRepository(client, { rpc: () => assert.fail('Never use anonymous count client for people feed') });
  let page = await repo.getHomePicks(cursor);
  assert.equal(page.items.length, 20); assert.equal(page.nextCursor.id, 'pick-19');
  assert.equal(page.nextCursor.timestamp, cursor.timestamp, 'Preserve PostgreSQL microseconds');
  assert.equal(new Set(page.items.map((p) => p.userId)).size, 20);
  assert.ok(page.items.every((p) => p.thumbnailUrl === poster)); assert.equal(storagePaths.length, 0);
  rows[0] = { ...rows[0], thumbnail_path: 'u/thumb.jpg', image_path: 'u/full.jpg' };
  rows[1] = { ...rows[1], image_path: 'u/original.jpg' };
  rows[2] = { ...rows[2], image_source_url: null };
  page = await repo.getHomePicks(cursor);
  assert.equal(page.items[0].thumbnailUrl, 'https://storage.test/u/thumb.jpg');
  assert.equal(page.items[1].thumbnailUrl, 'https://storage.test/u/original.jpg');
  assert.equal(page.items[2].thumbnailUrl, null);
  assert.equal(page.items[0].oneLineReview, 'Reason 0'); assert.equal(page.items[0].pickId, 'pick-0');
  rows = rows.slice(0, 20); assert.equal((await repo.getHomePicks(cursor)).nextCursor, null);
  rows = []; assert.equal((await repo.getHomePicks(cursor)).items.length, 0);
  failure = new Error('offline'); await assert.rejects(() => repo.getHomePicks(cursor), /offline/); failure = null;
  await assert.rejects(() => repo.getHomePicks({ ...cursor, id: 'invalid' }), /INVALID_PAGINATION_CURSOR/);

  // Legacy aggregate compatibility is retained independently of the new Home.
  let legacyRows = Array.from({ length: 21 }, (_, i) => ({ item_id: 'item-'+i, last_picked_at: cursor.timestamp, pick_count: 3 }));
  const legacy = new SupabaseReadRepository({ storage: {} }, { rpc: (name, params) => {
    assert.equal(name, 'home_showcase_page'); assert.equal(params.p_before_time, cursor.timestamp); assert.equal(params.p_after_id, cursor.id);
    return { single: async () => ({ data: { minimum_pick_count: 3, items: legacyRows } }) };
  } });
  page = await legacy.getHomeShowcase(cursor);
  assert.equal(page.items.length, 20); assert.equal(page.nextCursor.id, 'item-19'); assert.equal(page.nextCursor.timestamp, cursor.timestamp);
  legacyRows = legacyRows.slice(0, 20); assert.equal((await legacy.getHomeShowcase(cursor)).nextCursor, null);

  let presses = [], destination;
  const native = ({ children }) => React.createElement('div', null, children);
  const categories = { data: [{ id: 'picked', name: '라면', label: '먹을것 › 라면' }, { id: 'new', name: '영화', label: '볼것 › 영화' }] };
  const { UnselectedCategories } = load('components/unselected-categories.tsx', {
    'expo-router': { useRouter: () => ({ push: (route) => { destination = route; } }) },
    'react-native': { View: native, Text: native, ActivityIndicator: () => null, StyleSheet: { create: (s) => s },
      Pressable: (props) => { presses.push(props); return native(props); } },
    '@/hooks/useRegisterPick': { useRegistrationCategories: () => categories },
  });
  const render = (selected) => { presses = []; return renderToStaticMarkup(React.createElement(UnselectedCategories, { selectedCategoryIds: selected })); };
  assert.doesNotMatch(render(['picked']), /먹을것/); assert.match(render(['picked']), /볼것.*영화/);
  presses[0].onPress(); assert.equal(destination.params.categoryId, 'new'); assert.equal(destination.pathname, '/pick/find');
  assert.match(render(['picked', 'new']), /추가로 고를 수 있는 카테고리가 없어요/);
  categories.isError = true;
  assert.match(render([]), /카테고리를 불러오지 못했어요/);
  assert.doesNotMatch(render(['picked', 'new']), /추가로 고를 수 있는 카테고리가 없어요/);
  console.log('Home pagination passed: people identity, account cache isolation, session RPC, photo fallbacks, cursor precision, legacy compatibility and profile-category recovery.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
