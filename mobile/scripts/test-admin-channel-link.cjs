const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// --- admin-api request shapes ------------------------------------------------
function loadApi(fetchFn) {
  const exported = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/admin-api.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: exported, fetch: fetchFn, URLSearchParams, JSON,
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk' } },
    require: (name) => {
      if (name === '@/lib/supabase/client') return { supabase: {} };
      if (name === '@/lib/items/itemIdentity') return { canonicalItemName: (value) => value };
      if (name === '@/lib/items/pickChannel') return require('./pick-channel.cjs');
      if (name === '@/lib/admin/adminSession') return { getAdminAccessToken: async () => 'aal2-token' };
      assert.fail(`Unexpected dependency: ${name}`);
    },
  });
  return exported;
}

async function apiChecks() {
  const calls = [];
  const api = loadApi(async (url, init = {}) => { calls.push({ url, body: init.body ? JSON.parse(init.body) : null }); return { status: 200, ok: true, json: async () => [] }; });
  await api.getUnlinkedItems('  대성 ');
  assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/rpc/admin_unlinked_items');
  assert.deepEqual(calls[0].body, { p_root_slug: 'food', p_query: '대성', p_limit: 100 });
  await api.getUnlinkedItems('');
  assert.equal(calls[1].body.p_query, null, 'An empty search lists everything');
  await api.searchPlaceCatalogForItem('dogani', ' 대성집 ');
  assert.deepEqual(calls[2].body, { p_category_id: 'dogani', p_query: '대성집', p_limit: 10 });
  await api.linkItemToPlace('item-1', 'catalog-1');
  assert.equal(calls[3].url, 'https://example.supabase.co/rest/v1/rpc/admin_link_item_to_place');
  assert.deepEqual(calls[3].body, { p_item_id: 'item-1', p_catalog_id: 'catalog-1' });
  await api.linkItemToOnlineProvider({ itemId: 'item-2', name: ' SHEEP  몰 ', storeType: 'official_site', officialUrl: ' https://sheep.example ' });
  assert.equal(calls[4].url, 'https://example.supabase.co/rest/v1/rpc/admin_link_item_to_online_provider');
  assert.deepEqual(calls[4].body, { p_item_id: 'item-2', p_name: 'SHEEP 몰', p_store_type: 'official_site', p_official_url: 'https://sheep.example', p_platform: null, p_store_key: null });
  assert.throws(() => api.linkItemToOnlineProvider({ itemId: 'item-2', name: '배달', storeType: 'official_site', officialUrl: 'https://s.baemin.com/1' }), /배달앱 링크/);
  assert.equal(calls.length, 5, 'Rejected input never reaches the server');
}

// --- ChannelLinkPanel ---------------------------------------------------------
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/admin/data/channel-link-panel.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function harness(api) {
  const slots = [];
  let cursor = 0, tree, pendingEffects = [];
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((item, index) => !Object.is(item, b[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (next) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }];
    },
    useEffect(setup, deps) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) {
        const cleanup = slots[index]?.cleanup;
        slots[index] = { deps };
        pendingEffects.push(() => { cleanup?.(); slots[index].cleanup = setup(); });
      }
    },
  };
  const jsx = (type, props = {}) => ({ type, props });
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  };
  const confirms = [];
  const exported = {};
  vm.runInNewContext(compiled, {
    exports: exported, Error,
    window: { confirm: (text) => { confirms.push(text); return true; } },
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'react-native') return {
        ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View',
        StyleSheet: { create: (value) => value },
      };
      if (name === '@/lib/admin-api') return api;
      if (name === '@/components/admin/admin-shell') return { adminStyles: {} };
      if (name === '@/constants/onepick') return { OnePick: {} };
      assert.fail(`Unexpected dependency: ${name}`);
    },
  });
  const walk = (node) => Array.isArray(node) ? node.flatMap(walk) : (!node || typeof node !== 'object') ? [] : [node, ...walk(node.props.children)];
  const text = (node) => Array.isArray(node) ? node.map(text).join('') : (typeof node === 'string' || typeof node === 'number') ? String(node) : node?.props ? text(node.props.children) : '';
  const render = () => {
    for (let pass = 0; pass < 5; pass++) {
      cursor = 0; tree = expand(exported.ChannelLinkPanel());
      const effects = pendingEffects; pendingEffects = [];
      effects.forEach((effect) => effect());
      if (!effects.length) break;
    }
    return text(tree);
  };
  const settle = async () => { for (let i = 0; i < 6; i++) { await new Promise((resolve) => setImmediate(resolve)); render(); } return text(tree); };
  const pressables = () => walk(tree).filter((node) => node.type === 'Pressable');
  const button = (label) => {
    const found = pressables().find((node) => node.props.accessibilityLabel === label || text(node) === label);
    assert.ok(found, `Button not found: ${label}`);
    return found.props;
  };
  const input = (label) => walk(tree).find((node) => node.type === 'TextInput' && node.props.accessibilityLabel === label)?.props;
  return { render, settle, button, input, confirms, pressables, text };
}

async function panelChecks() {
  const calls = { place: [], online: [], search: [] };
  let placeResult = async () => ({});
  const rows = () => [
    { item_id: 'daesung', item_name: '대성집', category_id: 'dogani', category_name: '도가니탕', category_path: '먹을것 › 국/탕 › 도가니탕', uses_place_catalog: true, pick_count: 3, created_at: '' },
    { item_id: 'sheep', item_name: 'SHEEP새끼', category_id: 'lamb', category_name: '양고기', category_path: '먹을것 › 양고기', uses_place_catalog: false, pick_count: 1, created_at: '' },
  ];
  const api = {
    getUnlinkedItems: async () => rows(),
    searchPlaceCatalogForItem: async (categoryId, query) => {
      calls.search.push([categoryId, query]);
      return [
        { catalog_id: 'cat-main', name: '대성집', branch_name: '본점', road_address: '서울 종로구 사직로 5', address: null, region_1: '서울', region_2: '종로구', existing_item_id: null },
        { catalog_id: 'cat-taken', name: '대성집', branch_name: '2호점', road_address: '서울 중구', address: null, region_1: '서울', region_2: '중구', existing_item_id: 'other-item' },
      ];
    },
    linkItemToPlace: async (itemId, catalogId) => { calls.place.push([itemId, catalogId]); return placeResult(); },
    linkItemToOnlineProvider: async (input) => { calls.online.push(input); return {}; },
  };
  const view = harness(api);
  view.render();
  let page = await view.settle();

  assert.match(page, /연결 안 된 음식 항목 · 2/);
  assert.match(page, /원픽 3/); assert.match(page, /매장·온라인/); assert.match(page, /온라인만/);
  assert.equal(view.button('매장 연결').accessibilityState.selected, true, 'Place-capable items start on 매장');
  assert.equal(view.input('장소 검색').value, '대성집', 'The place search is prefilled with the item name');

  view.button('장소 검색').onPress();
  page = await view.settle();
  assert.deepEqual(calls.search[0], ['dogani', '대성집'], 'Places are searched inside the item category');
  assert.match(page, /이미 이 카테고리의 원픽 항목이 연결된 장소입니다/);
  assert.equal(view.button('대성집 2호점에 연결').disabled, true, 'A place that already has its item cannot be linked again');

  placeResult = async () => { throw new Error('PLACE_ALREADY_LINKED'); };
  view.button('대성집 본점에 연결').onPress();
  page = await view.settle();
  assert.match(page, /같은 카테고리의 원픽 항목이 이미 있습니다/, 'Server errors are translated');
  assert.match(page, /연결 안 된 음식 항목 · 2/, 'A failed link keeps the item in the list');

  placeResult = async () => ({});
  view.button('대성집 본점에 연결').onPress();
  page = await view.settle();
  assert.deepEqual(calls.place.at(-1), ['daesung', 'cat-main']);
  assert.match(view.confirms.at(-1), /기존 원픽은 그대로 유지/, 'Linking asks for confirmation and promises Picks stay');
  assert.match(page, /대성집 항목을 매장 대성집 본점에 연결했습니다/);
  assert.match(page, /연결 안 된 음식 항목 · 1/);

  // The next item has no place catalog: only the online form is available.
  assert.equal(view.button('매장 연결').disabled, true, 'Non-place categories cannot be linked to a place');
  assert.equal(view.button('온라인 연결').accessibilityState.selected, true);
  assert.equal(view.input('온라인 판매처 이름').value, 'SHEEP새끼', 'The seller name is prefilled from the item');
  assert.equal(view.button('온라인 판매처에 연결').disabled, true, 'A URL is required');
  view.input('온라인 판매처 URL').onChangeText('https://sheep.example/shop');
  view.render();
  view.button('온라인 판매처에 연결').onPress();
  page = await view.settle();
  assert.deepEqual({ ...calls.online[0] }, { itemId: 'sheep', name: 'SHEEP새끼', storeType: 'official_site', officialUrl: 'https://sheep.example/shop', platform: null, storeKey: null });
  assert.match(page, /온라인 판매처에 연결했습니다/);
  assert.match(page, /연결할 항목이 없습니다/);
}

(async () => {
  await apiChecks();
  await panelChecks();
  console.log('Admin channel link checks passed: unlinked list request, place search in category, duplicate-place guard, translated errors, 매장/온라인 link payloads and list updates.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
