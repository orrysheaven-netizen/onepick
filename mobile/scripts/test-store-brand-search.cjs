// 매장 검색의 "○○ 전체 · 지점 선택 안 함" 행: 검색된 지점 → 장소 → 활성 지점 → 활성 브랜드.
// Also checks that a brand candidate looks up its brand-wide item (item_brand_scopes),
// never a branch item.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, require: (name) => {
    if (name in imports) return imports[name];
    assert.fail(`Unexpected dependency: ${name}`);
  } });
  return exports;
}
const { AppError } = load('errors/appError.ts');
const { StoreFirstService } = load('services/storeFirstService.ts', {
  '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
  '@/lib/supabase/client': { supabase: {} },
});

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tables = {
  place_catalog: [
    { id: id(1), place_provider: 'sbiz', provider_place_id: 'p-1' }, // 을밀대 마포 (brand A)
    { id: id(2), place_provider: 'sbiz', provider_place_id: 'p-2' }, // 개인 매장 (no brand)
    { id: id(3), place_provider: 'sbiz', provider_place_id: 'p-3' }, // 을밀대 강남 (brand A)
    { id: id(4), place_provider: 'sbiz', provider_place_id: 'p-4' }, // 다른 브랜드 B
    { id: id(5), place_provider: 'sbiz', provider_place_id: 'p-5' }, // 비활성 브랜드 C
  ],
  places: [
    { id: 'place-1', place_provider: 'sbiz', provider_place_id: 'p-1' },
    { id: 'place-2', place_provider: 'sbiz', provider_place_id: 'p-2' },
    { id: 'place-3', place_provider: 'sbiz', provider_place_id: 'p-3' },
    { id: 'place-4', place_provider: 'sbiz', provider_place_id: 'p-4' },
    { id: 'place-5', place_provider: 'sbiz', provider_place_id: 'p-5' },
    { id: 'place-x', place_provider: 'other', provider_place_id: 'p-1' }, // same id, other provider
  ],
  providers: [
    { place_id: 'place-1', brand_id: 'brand-a', kind: 'offline_branch', status: 'active' },
    { place_id: 'place-2', brand_id: null, kind: 'offline_branch', status: 'active' },
    { place_id: 'place-3', brand_id: 'brand-a', kind: 'offline_branch', status: 'active' },
    { place_id: 'place-4', brand_id: 'brand-b', kind: 'offline_branch', status: 'active' },
    { place_id: 'place-5', brand_id: 'brand-c', kind: 'offline_branch', status: 'active' },
    { place_id: 'place-x', brand_id: 'brand-x', kind: 'offline_branch', status: 'active' },
  ],
  brands: [
    { id: 'brand-a', name: '을밀대', logo_path: 'a.png', is_active: true },
    { id: 'brand-b', name: '우래옥', logo_path: null, is_active: true },
    { id: 'brand-c', name: '폐업브랜드', logo_path: null, is_active: false },
    { id: 'brand-x', name: '엉뚱한 브랜드', logo_path: null, is_active: true },
  ],
  item_brand_scopes: [{ item_id: 'brand-item', brand_id: 'brand-a', category_id: id(99) }],
  items: [{ id: 'brand-item', category_id: id(99), status: 'active', image_path: 'x.jpg', thumbnail_path: null, image_source_url: null }],
};
const reads = [];
function from(table) {
  const filters = [];
  const query = {
    select() { return query; },
    in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
    eq(column, value) { filters.push((row) => row[column] === value); return query; },
    not(column, op, value) { assert.equal(op, 'is'); assert.equal(value, null); filters.push((row) => row[column] !== null); return query; },
    abortSignal() { return query; },
    maybeSingle() { const rows = run(); return Promise.resolve({ data: rows[0] ?? null, error: null }); },
    then(resolve, reject) { return Promise.resolve({ data: run(), error: null }).then(resolve, reject); },
  };
  const run = () => { reads.push(table); return tables[table].filter((row) => filters.every((f) => f(row))); };
  return query;
}
const client = {
  from,
  rpc() { assert.fail('the brand lookup does not call any RPC'); },
  storage: { from: (bucket) => ({ getPublicUrl: (file) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${file}` } }) }) },
};
const service = new StoreFirstService(client);
// Results are built inside the module's own VM realm; compare plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

(async () => {
  const brands = await service.brandsForCatalog([id(2), id(1), id(4), id(3), id(5), 'not-a-uuid']);
  assert.deepEqual(plain(brands), [
    { kind: 'brand', brandId: 'brand-a', name: '을밀대', logoUrl: 'https://cdn.test/brand-logos/a.png' },
    { kind: 'brand', brandId: 'brand-b', name: '우래옥', logoUrl: null },
  ], 'one row per active brand, in the order its first branch appears; other providers and inactive brands are ignored');

  reads.length = 0;
  assert.deepEqual(plain(await service.brandsForCatalog([id(2)])), [], 'a store without a brand gets no brand row');
  assert.deepEqual(plain(await service.brandsForCatalog([])), []);

  const brandSelection = await service.selectItem(id(99), { kind: 'brand', brandId: 'brand-a', name: '을밀대', logoUrl: null });
  assert.deepEqual(plain(brandSelection), { itemId: 'brand-item', hasPhoto: true, pending: false, categoryId: id(99) });
  const missing = await service.selectItem(id(99), { kind: 'brand', brandId: 'brand-b', name: '우래옥', logoUrl: null });
  assert.equal(missing.itemId, null, 'a brand without a brand-wide product starts a new one at registration');

  console.log('Store brand search checks passed: brand rows per active brand, branch order kept, brand-wide item lookup.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
