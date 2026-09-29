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
    brands: [{ id: brandId, name: '서울집', logo_path: 'brand/store-logo.png', is_active: true }],
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
      { item_id: soup, status: 'active', one_line_review: '예전 한줄평', started_at: '2026-09-20T00:00:00Z' },
      { item_id: soup, status: 'active', one_line_review: '국물이 진한데 부담스럽지 않음', started_at: '2026-09-28T00:00:00Z' },
      { item_id: rice, status: 'active', one_line_review: '깔끔해서 자주 생각남', started_at: '2026-09-27T00:00:00Z' },
      { item_id: soup, status: 'replaced', one_line_review: '교체된 리뷰', started_at: '2026-09-29T00:00:00Z' },
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
  assert.equal(offline.items[0].latestReview, '국물이 진한데 부담스럽지 않음', 'provider menu shows the newest current Pick review');
  assert.equal(offline.items[1].latestReview, '깔끔해서 자주 생각남');
  assert.equal(offline.brandId, brandId);
  assert.equal(offline.brandName, '서울집');
  assert.equal(offline.brandLogoUrl, 'https://storage.test/brand/store-logo.png');

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

  const serviceSource = fs.readFileSync(path.join(root, 'src/services/providerProfileService.ts'), 'utf8');
  assert.match(serviceSource, /const \[location, brand, mappingResult\] = await Promise\.all\(\[/,
    'provider location, brand and item mapping must start in the same parallel phase');
  assert.match(serviceSource, /locationPromise,[\s\S]*brandPromise,[\s\S]*mappingPromise/,
    'parallel phase includes all independent provider profile reads');

  const screen = fs.readFileSync(path.join(root, 'src/app/provider/[providerId].tsx'), 'utf8');
  assert.match(screen, /<View style=\{styles\.storeHeader\}>/, 'store scope uses the Figma 17A Foundations header');
  assert.match(screen, /storeHeader:[\s\S]*?height: 56/);
  assert.match(screen, /storeHeaderSide: \{ width: 48, minHeight: 44, justifyContent: 'center' \}/);
  assert.match(screen, /storeContent:[\s\S]*?maxWidth: 390[\s\S]*?minHeight: 720[\s\S]*?paddingHorizontal: OnePickSpace\.gutter[\s\S]*?paddingTop: OnePickSpace\.sm/);
  assert.match(screen, /query\.data\.brandLogoUrl \?/, 'registered brand logo is used when available');
  assert.match(screen, /accessibilityLabel="로고 미등록"/, 'missing logo keeps the Figma 64px placeholder');
  assert.match(screen, /storeLogoPlaceholder:[\s\S]*?width: 64[\s\S]*?height: 64[\s\S]*?borderRadius: 20/);
  assert.match(screen, /query\.data\.link \? <View style=\{styles\.storeLinks\}>/, 'only registered external links render');
  assert.match(screen, /지도 링크 ↗/, 'offline store exposes its registered map action');
  assert.doesNotMatch(screen, />SNS</, 'SNS area stays hidden until an SNS data contract exists');
  assert.match(screen, /query\.data\.kind === 'offline_branch' \? '이곳의 원픽' : '이 판매처의 원픽'/);
  assert.match(screen, /storeMenuRow:[\s\S]*?minHeight: 72/, 'Figma 17A menu rows use the 72px geometry');
  assert.match(screen, /원픽 \{item\.pickCount\.toLocaleString\(\)\}/, 'provider menus use OnePick count language');
  assert.match(screen, /item\.latestReview \? <Text numberOfLines=\{1\} style=\{styles\.storeReview\}>/, 'menu rows show the newest current Pick review when present');
  assert.match(screen, /pathname: '\/item\/\[itemId\]'/, 'store menu rows remain item-detail entry points');
  assert.match(screen, /useBrandProfile/);
  assert.match(screen, /브랜드 전체/);
  assert.match(screen, /scope: 'provider'/, 'brand branches reopen the existing provider detail mode');

  console.log('Provider profile checks passed: Figma 17A store detail, registered links, latest reviews, brand identity, brand-wide products and provider drill-down.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
