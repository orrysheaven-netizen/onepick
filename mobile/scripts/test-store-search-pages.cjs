const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient, InfiniteQueryObserver } = require('@tanstack/react-query');

function load(file, imports, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, ...globals, require: (name) => {
    assert.ok(name in imports, `Unexpected import ${name}`); return imports[name];
  } });
  return exports;
}

async function main() {
  const { StoreFirstService } = load('services/storeFirstService.ts', {
    '@/errors/appError': { AppError: Error }, '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
    '@/lib/supabase/client': { supabase: {} },
  });
  const calls = [];
  let fail = false;
  const rows = Array.from({ length: 41 }, (_, i) => ({
    catalog_id: `store-${i}`, name: '카페인중독', branch_name: i === 0 ? '본점' : `지점${i}`,
    region_1: '서울특별시', region_2: '관악구', road_address: null, address: '상세 주소',
    provider_category: null, map_url: 'https://naver.me/example',
  }));
  const service = new StoreFirstService({ rpc: (name, args) => {
    calls.push({ name, args });
    const start = args.p_cursor === null ? 0 : Number(args.p_cursor.slice(7));
    const next = start + 20 < rows.length ? `opaque-${start + 20}` : null;
    const response = Promise.resolve(fail ? { error: new Error('offline') } : {
      data: rows.slice(start, start + 20).map((row) => ({ ...row, next_cursor: next })), error: null,
    });
    response.abortSignal = (signal) => { calls.at(-1).signal = signal; return response; };
    return response;
  } });
  let options, settled = '카페인중독';
  const hook = load('hooks/useStoreFirst.ts', {
    '@tanstack/react-query': { useInfiniteQuery: (value) => { options = value; return { data: { pages: [{ items: ['old'] }] } }; } },
    react: { useState: () => [settled, (value) => { settled = value; }], useEffect: (fn) => fn() },
    '@/services': {}, '@/services/storeFirstService': { storeFirstService: service },
  }, { setTimeout: () => 1, clearTimeout() {} });
  const use = (value, enabled = true) => hook.useStoreSearch('offline', value, enabled);
  assert.equal(use('다른 매장').data, undefined, 'old rows disappear during debounce');
  assert.equal(options.enabled, false);
  assert.equal(use('').data, undefined, 'clear hides old rows');
  assert.equal(use(settled, false).data, undefined, 'inactive screen does not expose results');
  use(settled);
  assert.equal(options.initialPageParam, null);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const observer = new InfiniteQueryObserver(client, options);
  await observer.refetch();
  let result = observer.getCurrentResult();
  assert.equal(result.data.pages[0].items.length, 20);
  assert.equal(result.hasNextPage, true);
  assert.equal(calls[0].name, 'search_store_catalog_page');
  assert.equal(calls[0].args.p_limit, 20);
  assert.equal(calls[0].args.p_cursor, null);
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.equal(result.data.pages[0].items[0].region, '서울특별시 관악구');
  assert.equal(result.data.pages[0].items[0].mapUrl, rows[0].map_url);
  fail = true;
  await observer.fetchNextPage({ cancelRefetch: false });
  result = observer.getCurrentResult();
  assert.equal(result.isFetchNextPageError, true);
  assert.equal(result.data.pages.length, 1, 'failed append preserves visible page');
  fail = false;
  await observer.fetchNextPage({ cancelRefetch: false });
  assert.equal(calls.at(-1).args.p_cursor, 'opaque-20', 'retry uses the same opaque cursor');
  await observer.fetchNextPage({ cancelRefetch: false });
  result = observer.getCurrentResult();
  assert.deepEqual(result.data.pages.map((page) => page.items.length), [20, 20, 1]);
  assert.deepEqual(result.data.pages.flatMap((page) => page.items.map((item) => item.catalogId)), rows.map((row) => row.catalog_id), 'retain server order without duplicates');
  assert.equal(result.hasNextPage, false);
  const count = calls.length;
  await observer.fetchNextPage({ cancelRefetch: false });
  assert.equal(calls.length, count, 'no request beyond terminal cursor');
  settled = '새 매장'; use(settled); observer.setOptions(options); await observer.refetch();
  assert.equal(calls.at(-1).args.p_cursor, null, 'changed search starts a fresh cursor');
  assert.equal(observer.getCurrentResult().data.pages.length, 1);
  observer.destroy(); client.clear();
  console.log('Store search pages passed: 20/20/1, server order, retry, terminal cursor, query reset and stale-row masking.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
