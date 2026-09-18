const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadSource(relativePath, imports = {}, globals = {}) {
  const result = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports, ...globals,
    require: (name) => {
      if (name in imports) return imports[name];
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      throw new Error('Unexpected runtime dependency: ' + name);
    },
  });
  return exports;
}

async function main() {
  const { queryKeys } = loadSource('lib/query/queryKeys.ts');
  let settled = '', timer, cleanup;
  const calls = [];
  const { useItemSearch } = loadSource('hooks/useItemSearch.ts', {
    react: { useState: () => [settled, (value) => { settled = value; }], useEffect: (effect) => { cleanup?.(); cleanup = effect(); } },
    '@tanstack/react-query': { useQuery: (options) => options, useQueryClient: () => ({ getQueryState: () => undefined }) },
    '@/lib/query/queryKeys': { queryKeys },
    '@/services': { itemService: { search: async (...args) => { calls.push(args); return []; } } },
  }, {
    setTimeout: (callback, delay) => { assert.equal(delay, 150); timer = callback; return 1; },
    clearTimeout: () => { timer = undefined; },
  });
  assert.equal(useItemSearch('   ').enabled, false);
  let query = useItemSearch('  라면  ', 'ramen');
  assert.equal(query.enabled, false);
  assert.equal(query.isWaiting, true);
  timer();
  query = useItemSearch('라면', 'ramen');
  assert.equal(query.enabled, true);
  const controller = new AbortController();
  await query.queryFn({ signal: controller.signal });
  assert.equal(calls[0].slice(0, 2).join(','), '라면,ramen');
  assert.equal(calls[0][2], controller.signal, 'The query cancellation signal reaches the service');
  const firstKey = JSON.stringify(query.queryKey);
  assert.notEqual(JSON.stringify(useItemSearch('라면', 'other').queryKey), firstKey);
  assert.equal(useItemSearch('다른 제품').isWaiting, true);
  assert.equal(useItemSearch('').hasSearchText, false);
  assert.equal(useItemSearch('').enabled, false);

  const rpcCalls = [];
  const { SupabaseItemRepository } = loadSource('repositories/supabase/supabaseItemRepository.ts', {
    '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
    '@/errors/appError': { AppError: Error },
    '@/repositories/mappers/itemMapper': { mapItemRow: (row) => ({ ...row, categoryId: row.category_id }) },
  });
  const repository = new SupabaseItemRepository({
    rpc: async (fn, args) => {
      rpcCalls.push([fn, args]);
      return { data: [{ id: 'item-1', name: '라면', category_id: 'ramen', image_path: null, thumbnail_path: null }], error: null };
    },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  });
  assert.equal((await repository.search({ query: ' ' })).length, 0);
  assert.equal(rpcCalls.length, 0);
  const repoResult = await repository.search({ query: ' 별칭 검색 ', categoryId: 'ramen', limit: 20 });
  assert.equal(repoResult[0].id, 'item-1');
  assert.equal(rpcCalls[0][0], 'search_items');
  assert.equal(rpcCalls[0][1].p_query, '별칭 검색');
  assert.equal(JSON.stringify(rpcCalls[0][1].p_category_ids), JSON.stringify(['ramen']));
  assert.equal(rpcCalls[0][1].p_limit, 20);

  const { ItemService } = loadSource('services/itemService.ts', { '@/errors/appError': { AppError: Error } });
  let categoryStatus = 'open';
  // Match the existing search_items contract: the server filters categories
  // before limit. The real SQL contract is also tested in 025_search_visibility.
  const itemRepository = {
    search: async () => categoryStatus === 'open' ? [{ id: 'item-1', name: '라면', categoryId: 'ramen', status: 'active' }] : [],
  };
  const categoryRepository = {
    getById: () => assert.fail('Search must not issue a category preflight'),
    getOpenCategories: () => assert.fail('Search must not issue a category preflight'),
  };
  const service = new ItemService(itemRepository, {}, categoryRepository, { getPicks: async () => [] });
  assert.equal((await service.search(' 라면 ', 'ramen'))[0].id, 'item-1');
  categoryStatus = 'closed';
  assert.equal((await service.search('라면', 'ramen')).length, 0, 'Closed categories are hidden from OnePick item search');

  let state = { hasSearchText: false, isPending: true };
  let selected, retried = false, photoProps;
  const presses = [];
  const nativeComponent = (tag) => ({ children }) => React.createElement(tag, null, children);
  const { ItemSearch } = loadSource('components/item-search.tsx', {
    '@/components/pick-photo': { PickPhoto: (props) => { photoProps = props; return null; } },
    '@/components/drama-search-link': { DramaSearchLink: () => null },
    '@/components/music-search-link': { MusicSearchLink: () => null },
    '@/hooks/useItemSearch': { useItemSearch: () => state },
    'react-native': {
      ActivityIndicator: () => null,
      Pressable: ({ children, onPress }) => { presses.push(onPress); return React.createElement('button', null, children); },
      Text: nativeComponent('span'), View: nativeComponent('section'), TextInput: () => null,
      StyleSheet: { create: (styles) => styles },
    },
  });
  const render = () => { presses.length = 0; return renderToStaticMarkup(React.createElement(ItemSearch, { onSelect: (id) => { selected = id; } })); };
  assert.doesNotMatch(render(), /제품을 찾고 있어요|검색 결과/);
  state = { hasSearchText: true, isWaiting: true, data: [{ id: 'stale', name: '이전 결과' }] };
  assert.match(render(), /제품을 찾고 있어요/);
  assert.doesNotMatch(render(), /이전 결과/);
  state = { hasSearchText: true, data: [] };
  assert.match(render(), /일치하는 제품이 없어요/);
  state = { hasSearchText: true, isError: true, refetch: () => { retried = true; } };
  assert.match(render(), /다시 검색하기/);
  presses[0]();
  assert.equal(retried, true);
  state = { hasSearchText: true, data: [{ id: 'item-1', name: '찾은 제품', status: 'active' }] };
  assert.match(render(), /찾은 제품/);
  assert.equal(photoProps.itemId, 'item-1');
  assert.equal(photoProps.itemStatus, 'active');
  presses[0]();
  assert.equal(selected, 'item-1');
  console.log('Item search checks passed: 150ms debounce, alias-aware single RPC, category isolation and search states/actions.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
