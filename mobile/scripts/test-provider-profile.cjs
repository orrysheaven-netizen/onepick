const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function load(relative, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    URL,
    require: (name) => {
      if (name in imports) return imports[name];
      assert.fail('Unexpected import: ' + name);
    },
  });
  return exports;
}

class Query {
  constructor(rows) { this.rows = rows; this.filters = []; this.start = 0; this.end = null; }
  select() { return this; }
  eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
  in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
  range(start, end) { this.start = start; this.end = end; return this; }
  result() {
    let rows = this.rows.filter((row) => this.filters.every((fn) => fn(row)));
    if (this.end !== null) rows = rows.slice(this.start, this.end + 1);
    return rows;
  }
  async maybeSingle() { return { data: this.result()[0] ?? null, error: null }; }
  then(resolve, reject) { return Promise.resolve({ data: this.result(), error: null }).then(resolve, reject); }
}

function client(tables, rpcData = {}) {
  return {
    from: (name) => new Query(tables[name] ?? []),
    rpc: async (name, args) => ({
      data: typeof rpcData[name] === 'function' ? rpcData[name](args) : (rpcData[name] ?? null),
      error: null,
    }),
    storage: { from: () => ({ getPublicUrl: (value) => ({ data: { publicUrl: 'https://storage.test/' + value } }) }) },
  };
}

async function main() {
  const { AppError } = load('errors/appError.ts');
  const links = load('lib/items/itemChannelLinks.ts');
  const { ProviderProfileService } = load('services/providerProfileService.ts', {
    '@/errors/appError': { AppError },
    '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
    '@/lib/items/itemChannelLinks': links,
    '@/lib/supabase/client': { supabase: {}, publicCountClient: {} },
  });

  const providerId = '11111111-1111-4111-8111-111111111111';
  const placeId = '22222222-2222-4222-8222-222222222222';
  const soup = '33333333-3333-4333-8333-333333333333';
  const rice = '44444444-4444-4444-8444-444444444444';
  const soupCat = '55555555-5555-4555-8555-555555555555';
  const riceCat = '66666666-6666-4666-8666-666666666666';
  const brandId = '99999999-9999-4999-8999-999999999999';

  const tables = {
    providers: [{ id: providerId, kind: 'offline_branch', name: '서울집', branch_name: '성수점', place_id: placeId, online_store_id: null, status: 'active', brand_id: brandId }],
    places: [{ id: placeId, road_address: '서울 성동구 성수로 1', address: null, region_1: '서울', region_2: '성동구', map_url: 'https://map.example/seoul-house' }],
    online_stores: [],
    item_providers: [
      { item_id: soup, category_id: soupCat, provider_id: providerId },
      { item_id: rice, category_id: riceCat, provider_id: providerId },
    ],
    items: [
      { id: soup, name: '서울집', category_id: soupCat, status: 'active', image_path: null, thumbnail_path: 'soup-thumb.jpg', image_source_url: null },
      { id: rice, name: '서울집', category_id: riceCat, status: 'active', image_path: null, thumbnail_path: null, image_source_url: 'https://images.example/rice.jpg' },
    ],
    categories: [
      { id: soupCat, name: '미역국', status: 'open', is_visible: true },
      { id: riceCat, name: '국밥', status: 'open', is_visible: true },
    ],
    picks: [
      { item_id: soup, status: 'active' }, { item_id: soup, status: 'active' },
      { item_id: rice, status: 'active' }, { item_id: soup, status: 'replaced' },
    ],
  };
  const db = client(tables);
  const service = new ProviderProfileService(db, db);
  const offline = await service.get(providerId);
  assert.equal(offline.channelLabel, '매장');
  assert.equal(offline.name, '서울집');
  assert.equal(offline.branchName, '성수점');
  assert.equal(offline.subtitle, '서울 성동구 성수로 1');
  assert.deepEqual({ ...offline.link }, { label: '지도 보기', url: 'https://map.example/seoul-house', host: 'map.example' });
  assert.deepEqual(Array.from(offline.items, (item) => [item.menuName, item.pickCount]), [['미역국', 2], ['국밥', 1]], 'provider menus sort by current Pick count');
  assert.equal(offline.items[0].thumbnailUrl, 'https://storage.test/soup-thumb.jpg');
  assert.equal(offline.brandId, brandId);

  const onlineProvider = '77777777-7777-4777-8777-777777777777';
  const storeId = '88888888-8888-4888-8888-888888888888';
  tables.providers.splice(0, 1, { id: onlineProvider, kind: 'online_store', name: '99밀크티', branch_name: null, place_id: null, online_store_id: storeId, status: 'active', brand_id: null });
  tables.online_stores.push({ id: storeId, host: '99tea.example', official_url: 'https://99tea.example/store' });
  tables.item_providers.splice(0, tables.item_providers.length,
    { item_id: soup, category_id: soupCat, provider_id: onlineProvider });
  const online = await new ProviderProfileService(client(tables), client(tables)).get(onlineProvider);
  assert.equal(online.channelLabel, '온라인');
  assert.equal(online.subtitle, '99tea.example');
  assert.deepEqual({ ...online.link }, { label: '공식몰 보기', url: 'https://99tea.example/store', host: '99tea.example' });

  const brandDb = client(tables, {
    brand_profile: {
      brand: { id: brandId, name: '서울집', logo_path: 'brand/logo.png' },
      brand_wide: [{ item_id: soup, category_id: soupCat, category_name: '미역국', pick_count: 3 }],
      branch_count: 2,
    },
    brand_branch_page: [
      { provider_id: providerId, kind: 'offline_branch', name: '서울집', branch_name: '성수점',
        road_address: '서울 성동구 성수로 1', region_1: '서울', region_2: '성동구', pick_count: 4, menu_count: 2 },
      { provider_id: onlineProvider, kind: 'online_store', name: '서울집몰', branch_name: null,
        official_url: 'https://shop.example', pick_count: 9, menu_count: 1 },
    ],
  });
  const brandService = new ProviderProfileService(brandDb, brandDb);
  const brand = await brandService.brand(brandId);
  assert.equal(brand.name, '서울집');
  assert.equal(brand.logoUrl, 'https://storage.test/brand/logo.png');
  assert.deepEqual(Array.from(brand.brandWide, (item) => [item.categoryName, item.pickCount]), [['미역국', 3]]);
  const branches = await brandService.brandBranches(brandId);
  assert.equal(branches.items.length, 1, 'MVP brand profile hides online providers');
  assert.equal(branches.items[0].providerId, providerId);
  assert.equal(branches.items[0].subtitle, '서울 성동구 성수로 1');

  tables.providers[0].status = 'hidden';
  await assert.rejects(
    () => new ProviderProfileService(client(tables), client(tables)).get(onlineProvider),
    (error) => error instanceof AppError && error.code === 'PROVIDER_NOT_FOUND',
  );
  await assert.rejects(
    () => service.get('not-a-uuid'),
    (error) => error instanceof AppError && error.code === 'PROVIDER_NOT_FOUND',
  );

  const screen = fs.readFileSync(path.join(root, 'src/app/provider/[providerId].tsx'), 'utf8');
  assert.match(screen, /query\.data\.link \? <View style=\{styles\.links\}>/, 'external action links are optional');
  assert.match(screen, /query\.data\.kind === 'offline_branch' \? '이곳의 원픽' : '이 판매처의 원픽'/);
  assert.match(screen, /원픽 \{item\.pickCount\.toLocaleString\(\)\}/, 'provider menus use OnePick count language');
  assert.doesNotMatch(screen, /Instagram|YouTube|SNS/, 'provider SNS remains outside PR 4');
  assert.match(screen, /useBrandProfile/);
  assert.match(screen, /브랜드 전체/);
  assert.match(screen, /scope: 'provider'/, 'brand branches reopen the existing provider detail mode');

  console.log('Provider profile checks passed: provider detail, brand-wide products, offline branch paging and provider drill-down.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
