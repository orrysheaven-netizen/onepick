// 매장 검색의 브랜드 전체 행("{브랜드명}"만 표시): 검색어로 활성 브랜드를 직접 읽는다(지점 페이지와 무관).
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
  brands: [
    { id: 'brand-a', name: '카페인중독', logo_path: 'a.png', is_active: true },
    { id: 'brand-b', name: '카페인중독 로스터스', logo_path: null, is_active: true },
    { id: 'brand-c', name: '카페인중독 폐업', logo_path: null, is_active: false },
    { id: 'brand-d', name: '을밀대', logo_path: null, is_active: true },
    { id: 'brand-p', name: '100%_커피', logo_path: null, is_active: true },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `brand-z${i}`, name: `원픽커피 ${i}`, logo_path: null, is_active: true })),
  ],
  item_brand_scopes: [{ item_id: 'brand-item', brand_id: 'brand-a', category_id: id(99) }],
  items: [{ id: 'brand-item', category_id: id(99), status: 'active', image_path: 'x.jpg', thumbnail_path: null, image_source_url: null }],
};
// PostgREST ilike with backslash escapes, enough for these checks.
const literal = (char) => /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
const likeToRegExp = (pattern) => new RegExp(`^${pattern.replace(/\\(.)|([%_])|(.)/g, (m, escaped, wild, plain) =>
  escaped ? literal(escaped) : wild ? (wild === '%' ? '.*' : '.') : literal(plain))}$`, 'i');
const reads = [];
function from(table) {
  const filters = [];
  let order = null;
  let limit = Infinity;
  const query = {
    select() { return query; },
    in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
    eq(column, value) { filters.push((row) => row[column] === value); return query; },
    ilike(column, pattern) { reads.push({ table, pattern }); const re = likeToRegExp(pattern); filters.push((row) => re.test(row[column])); return query; },
    order(column) { order = column; return query; },
    limit(count) { limit = count; return query; },
    abortSignal() { return query; },
    maybeSingle() { const rows = run(); return Promise.resolve({ data: rows[0] ?? null, error: null }); },
    then(resolve, reject) { return Promise.resolve({ data: run(), error: null }).then(resolve, reject); },
  };
  const run = () => {
    const rows = tables[table].filter((row) => filters.every((f) => f(row)));
    if (order) rows.sort((a, b) => a[order].localeCompare(b[order]));
    return rows.slice(0, limit);
  };
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
  assert.deepEqual(plain(await service.searchBrands('  카페인중독 ')), [
    { kind: 'brand', brandId: 'brand-a', name: '카페인중독', logoUrl: 'https://cdn.test/brand-logos/a.png' },
    { kind: 'brand', brandId: 'brand-b', name: '카페인중독 로스터스', logoUrl: null },
  ], 'active brands matching the search, by name; inactive brands are not listed');
  assert.deepEqual(reads.at(-1), { table: 'brands', pattern: '%카페인중독%' }, 'the brand read uses the search text, not loaded branch ids');

  assert.deepEqual(plain(await service.searchBrands('100%_')).map((row) => row.brandId), ['brand-p']);
  assert.equal(reads.at(-1).pattern, '%100\\%\\_%', 'LIKE wildcards in the search text are escaped');
  assert.deepEqual(plain(await service.searchBrands('%')), [], 'a bare % does not list every brand');

  const many = plain(await service.searchBrands('원픽커피'));
  assert.equal(many.length, 5, 'at most five brand rows above the branches');
  assert.deepEqual(many.map((row) => row.name), ['원픽커피 0', '원픽커피 1', '원픽커피 2', '원픽커피 3', '원픽커피 4']);

  reads.length = 0;
  assert.deepEqual(plain(await service.searchBrands('카')), [], 'one character is not searched, like the branch search');
  assert.equal(reads.length, 0);
  assert.deepEqual(plain(await service.searchBrands('없는브랜드')), []);

  const brandSelection = await service.selectItem(id(99), { kind: 'brand', brandId: 'brand-a', name: '을밀대', logoUrl: null });
  assert.deepEqual(plain(brandSelection), { itemId: 'brand-item', hasPhoto: true, pending: false, categoryId: id(99) });
  const missing = await service.selectItem(id(99), { kind: 'brand', brandId: 'brand-b', name: '우래옥', logoUrl: null });
  assert.equal(missing.itemId, null, 'a brand without a brand-wide product starts a new one at registration');

  console.log('Store brand search checks passed: page-independent brand rows by name, escaped LIKE, row limit, brand-wide item lookup.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
