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
  const { useProductSearch } = loadSource('hooks/useProductSearch.ts', {
    react: { useState: () => [settled, (value) => { settled = value; }], useEffect: (effect) => { cleanup?.(); cleanup = effect(); } },
    '@tanstack/react-query': { useQuery: (options) => options },
    '@/lib/query/queryKeys': { queryKeys },
    '@/services': { productService: { search: async (...args) => { calls.push(args); return []; } } },
  }, {
    setTimeout: (callback, delay) => { assert.equal(delay, 300); timer = callback; return 1; },
    clearTimeout: () => { timer = undefined; },
  });
  assert.equal(useProductSearch('   ').enabled, false);
  let query = useProductSearch('  라면  ', 'ramen');
  assert.equal(query.enabled, false);
  assert.equal(query.isWaiting, true);
  timer();
  query = useProductSearch('라면', 'ramen');
  assert.equal(query.enabled, true);
  await query.queryFn();
  assert.equal(calls[0].join(','), '라면,ramen');
  const firstKey = JSON.stringify(query.queryKey);
  assert.notEqual(JSON.stringify(useProductSearch('라면', 'other').queryKey), firstKey);
  assert.equal(useProductSearch('다른 제품').isWaiting, true);
  assert.equal(useProductSearch('').hasSearchText, false);
  assert.equal(useProductSearch('').enabled, false);

  const rpcCalls = [];
  const { SupabaseProductRepository } = loadSource('repositories/supabase/supabaseProductRepository.ts', {
    '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
    '@/errors/appError': { AppError: Error },
    '@/repositories/mappers/productMapper': { mapProductRow: (row) => ({ ...row, categoryId: row.category_id }) },
  });
  const repository = new SupabaseProductRepository({
    rpc: async (fn, args) => {
      rpcCalls.push([fn, args]);
      return { data: [{ id: 'product-1', name: '라면', category_id: 'ramen', image_path: null, thumbnail_path: null }], error: null };
    },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  });
  assert.equal((await repository.search({ query: ' ' })).length, 0);
  assert.equal(rpcCalls.length, 0);
  const repoResult = await repository.search({ query: ' 별칭 검색 ', categoryId: 'ramen', limit: 20 });
  assert.equal(repoResult[0].id, 'product-1');
  assert.equal(rpcCalls[0][0], 'search_products');
  assert.equal(rpcCalls[0][1].p_query, '별칭 검색');
  assert.equal(JSON.stringify(rpcCalls[0][1].p_category_ids), JSON.stringify(['ramen']));
  assert.equal(rpcCalls[0][1].p_limit, 20);

  const { ProductService } = loadSource('services/productService.ts', { '@/errors/appError': { AppError: Error } });
  let categoryStatus = 'open';
  const productRepository = {
    search: async () => [{ id: 'product-1', name: '라면', categoryId: 'ramen', status: 'active' }],
  };
  const categoryRepository = {
    getById: async () => ({ id: 'ramen', status: categoryStatus, isVisible: true, isPickable: true }),
    getOpenCategories: async () => categoryStatus === 'open' ? [{ id: 'ramen' }] : [],
  };
  const service = new ProductService(productRepository, {}, categoryRepository, { getPicks: async () => [] });
  assert.equal((await service.search(' 라면 ', 'ramen'))[0].id, 'product-1');
  categoryStatus = 'closed';
  assert.equal((await service.search('라면', 'ramen')).length, 0, 'Closed categories are hidden from OnePick product search');

  let state = { hasSearchText: false, isPending: true };
  let selected, retried = false;
  const presses = [];
  const nativeComponent = (tag) => ({ children }) => React.createElement(tag, null, children);
  const { ProductSearch } = loadSource('components/product-search.tsx', {
    '@/hooks/useProductSearch': { useProductSearch: () => state },
    'react-native': {
      ActivityIndicator: () => null,
      Pressable: ({ children, onPress }) => { presses.push(onPress); return React.createElement('button', null, children); },
      Text: nativeComponent('span'), View: nativeComponent('section'), TextInput: () => null,
      StyleSheet: { create: (styles) => styles },
    },
  });
  const render = () => { presses.length = 0; return renderToStaticMarkup(React.createElement(ProductSearch, { onSelect: (id) => { selected = id; } })); };
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
  state = { hasSearchText: true, data: [{ id: 'product-1', name: '찾은 제품' }] };
  assert.match(render(), /찾은 제품/);
  presses[0]();
  assert.equal(selected, 'product-1');
  console.log('Product search checks passed: debounce, alias-aware RPC, category isolation and search states/actions.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
