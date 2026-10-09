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
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name === '@/components/ui') return require('./icon-stub.cjs');
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  } });
  return exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));

async function main() {
  // Repository: RPC rows become one overview with three channel lists.
  const calls = [];
  const rows = [
    { category_id: 'dish', category_name: '미역국', channel: null, item_id: null, item_name: null, thumbnail_path: null, image_path: null, image_source_url: null, pick_count: 0, rank: 0 },
    { category_id: 'dish', category_name: '미역국', channel: 'offline', item_id: 's1', item_name: '미역국 명가', thumbnail_path: 'u/t.jpg', image_path: null, image_source_url: null, pick_count: 3, rank: 1 },
    { category_id: 'dish', category_name: '미역국', channel: 'recipe', item_id: 'v1', item_name: '초간단 미역국', thumbnail_path: null, image_path: null, image_source_url: 'https://i.ytimg.com/v.jpg', pick_count: 1, rank: 1 },
    { category_id: 'dish', category_name: '미역국', channel: 'delivery', item_id: 'x', item_name: 'x', pick_count: 9, rank: 1 },
  ];
  const client = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'item_brands') return { data: [{ item_id: 's1', brand_id: 'b1', brand_name: '명가', logo_path: 'b1/logo.png' }], error: null };
      return { data: rows, error: null };
    },
    storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: 'https://storage/' + p } }) }) },
  };
  const { SupabaseReadRepository } = load('repositories/supabase/supabaseReadRepository.ts', {
    '@/errors/appError': { AppError: Error },
    '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
    '@/repositories/mappers/categoryMapper': {}, '@/repositories/mappers/commentMapper': {}, '@/repositories/mappers/itemMapper': {},
    '@/repositories/mappers/pickMapper': {}, '@/repositories/mappers/profileMapper': {},
    '@/repositories/supabase/itemChannels': { fetchItemChannels: async () => new Map() },
    '@/repositories/supabase/itemProviders': { fetchItemProviderIds: async () => new Map() },
    './itemChannels': { fetchItemChannels: async () => new Map() },
  });
  const overview = await new SupabaseReadRepository(client).getDishChannelOverview('미역국');
  assert.deepEqual(plain(calls[0]), ['dish_channel_overview', { p_query: '미역국' }]);
  assert.equal(overview.categoryName, '미역국');
  assert.deepEqual(plain(calls[1]), ['item_brands', { p_item_ids: ['s1', 'v1', 'x'] }], 'brand logos are read once for the whole overview');
  assert.deepEqual(plain(overview.channels.offline), [{ itemId: 's1', name: '미역국 명가', thumbnailUrl: 'https://storage/u/t.jpg', brandLogoUrl: 'https://storage/b1/logo.png', pickCount: 3 }]);
  assert.equal(overview.channels.recipe[0].brandLogoUrl, null, 'an item without a brand has no logo');
  assert.deepEqual(plain(overview.channels.online), [], 'an empty channel stays an empty list');
  assert.equal(overview.channels.recipe[0].thumbnailUrl, 'https://i.ytimg.com/v.jpg');
  assert.equal(Object.keys(overview.channels).length, 3, 'unknown channels are dropped');
  rows.length = 0;
  assert.equal(await new SupabaseReadRepository(client).getDishChannelOverview('브이로그'), null, 'a query that is not a dish has no overview');

  // Service: one-character queries never reach the server.
  const { ItemService } = load('services/itemService.ts', { '@/errors/appError': { AppError: Error } });
  const asked = [];
  const service = new ItemService({}, {}, {}, { getDishChannelOverview: async (q) => { asked.push(q); return null; } });
  assert.equal(await service.getDishChannelOverview(' 미 '), null);
  await service.getDishChannelOverview('  미역국  ');
  assert.deepEqual(asked, ['미역국']);

  // Component: three sections in order, counts, and a register action on empty ones.
  const pressed = [];
  const native = (tag) => (props) => React.createElement(tag, { 'aria-label': props.accessibilityLabel }, props.children);
  const { DishChannelOverview } = load('components/dish-channel-overview.tsx', {
    'react-native': {
      Pressable: (props) => { pressed.push(props); return React.createElement('button', { 'aria-label': props.accessibilityLabel }, typeof props.children === 'function' ? props.children({ pressed: false }) : props.children); },
      Text: native('span'), View: native('div'), StyleSheet: { create: (s) => s },
    },
    '@/components/pick-photo': { PickPhoto: () => null },
    '@/lib/home/homeChannels': load('lib/home/homeChannels.ts'),
  });
  const registered = [];
  const selected = [];
  const html = renderToStaticMarkup(React.createElement(DishChannelOverview, {
    overview: {
      categoryId: 'dish', categoryName: '미역국',
      channels: { offline: [{ itemId: 's1', name: '미역국 명가', thumbnailUrl: null, pickCount: 3 }], online: [], recipe: [{ itemId: 'v1', name: '초간단 미역국', thumbnailUrl: null, pickCount: 1 }] },
    },
    onSelectItem: (id) => selected.push(id),
    onRegister: (categoryId, channel) => registered.push([categoryId, channel]),
  }));
  const offline = html.indexOf('오프라인 맛집'), online = html.indexOf('온라인 맛집'), recipe = html.indexOf('레시피</span>');
  assert.ok(offline > -1 && offline < online && online < recipe, '오프라인 맛집, 온라인 맛집, 레시피 in that order');
  assert.match(html, /3명이 원픽/);
  assert.match(html, /미역국 온라인 맛집의 첫 원픽을 골라보세요/);
  pressed.find((p) => p.accessibilityLabel === '미역국 온라인 맛집 원픽 등록하기').onPress();
  assert.deepEqual(registered, [['dish', 'online']]);
  pressed.find((p) => /^레시피 1위, 초간단 미역국/.test(p.accessibilityLabel)).onPress();
  assert.deepEqual(selected, ['v1']);

  // MVP caller can expose only the offline section without deleting future-channel support.
  pressed.length = 0; registered.length = 0; selected.length = 0;
  const mvpHtml = renderToStaticMarkup(React.createElement(DishChannelOverview, {
    overview: {
      categoryId: 'dish', categoryName: '미역국',
      channels: { offline: [{ itemId: 's1', name: '미역국 명가', thumbnailUrl: null, pickCount: 3 }], online: [], recipe: [{ itemId: 'v1', name: '초간단 미역국', thumbnailUrl: null, pickCount: 1 }] },
    },
    visibleChannels: ['offline'],
    onSelectItem: (id) => selected.push(id),
    onRegister: (categoryId, channel) => registered.push([categoryId, channel]),
  }));
  assert.match(mvpHtml, /매장에서 먹은 메뉴 원픽/);
  assert.match(mvpHtml, /오프라인 맛집/);
  assert.doesNotMatch(mvpHtml, /온라인 맛집|레시피</);
  assert.equal(pressed.some((p) => /온라인|레시피/.test(p.accessibilityLabel ?? '')), false);

  // Explore: unscoped dish search is pinned to the initial MVP public channel.
  const explore = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/explore.tsx'), 'utf8');
  assert.match(explore, /dishChannels=\{\{ userId: user\?\.id, channel: OnePickMvp\.publicPickChannel, onRegister: registerDish \}\}/);
  assert.match(explore, /channel === 'recipe'\s+\? \{ pathname: '\/pick\/recipe', params: \{ categoryId \} \}\s+: \{ pathname: '\/pick\/find', params: \{ categoryId, channel \} \}/);
  const search = fs.readFileSync(path.join(__dirname, '../src/components/item-search.tsx'), 'utf8');
  assert.match(search, /useDishChannels\(searchText, dishChannels\?\.userId, Boolean\(dishChannels\) && !categoryId\)/, 'category-scoped searches skip the dish overview');
  assert.match(search, /visibleChannels=\{dishChannels\?\.channel \? \[dishChannels\.channel\] : undefined\}/);
  assert.match(search, /fixedChannel=\{dishChannels\?\.channel\}/);

  const people = fs.readFileSync(path.join(__dirname, '../src/components/dish-people-picks.tsx'), 'utf8');
  assert.match(people, /const activeChannel = fixedChannel \?\? channel/);
  assert.match(people, /!fixedChannel \? <ScrollView/, 'fixed channel hides the future channel switcher');

  const menuRoute = fs.readFileSync(path.join(__dirname, '../src/app/menu/[slug].tsx'), 'utf8');
  assert.match(menuRoute, /fixedChannel=\{OnePickMvp\.publicPickChannel\}/, 'Dedicated menu view stays offline-only');
  const rankingRoute = fs.readFileSync(path.join(__dirname, '../src/app/ranking/[slug].tsx'), 'utf8');
  assert.match(rankingRoute, /fixedChannel=\{OnePickMvp\.publicPickChannel\}/, 'Ranking people feed stays offline-only');

  console.log('Dish channel search passed: full internal three-channel model remains, while MVP discovery, menu and people feeds are pinned to offline.');
}

main().catch((error) => { console.error(error); process.exit(1); });
