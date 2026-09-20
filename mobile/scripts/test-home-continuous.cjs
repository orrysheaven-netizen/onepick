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
  const cursor = { timestamp: '2026-09-17T12:00:00.123456+00:00', id: 'page-one-last' };
  options.queryFn({ pageParam: cursor });
  assert.equal(request.user, 'me'); assert.equal(request.cursor, cursor);
  assert.equal(options.getNextPageParam({ nextCursor: cursor }), cursor);
  assert.equal(options.getNextPageParam({ nextCursor: null }), undefined);
  assert.equal(useHomeData('me', false).enabled, false);
  assert.notDeepEqual(options.queryKey, useHomeData().queryKey);
  const result = options.select({ pages: [
    { minimumPickCount: 3, currentPicks: ['current'], featuredItems: [{ itemId: 'a' }, { itemId: 'b' }] },
    { minimumPickCount: 3, currentPicks: [], featuredItems: [{ itemId: 'b' }, { itemId: 'c' }] },
  ] });
  assert.equal(result.featuredItems.map((p) => p.itemId).join(','), 'a,b,c', 'Product movement does not repeat cards');
  assert.equal(result.currentPicks[0], 'current');

  const { AppError } = load('errors/appError.ts');
  const imports = { '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError: (e) => e } };
  for (const name of ['category', 'comment', 'pick', 'item', 'profile']) imports[`@/repositories/mappers/${name}Mapper`] = load(`repositories/mappers/${name}Mapper.ts`);
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

  console.log('Continuous home passed: cursor, lookahead, precision and deduplication.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
