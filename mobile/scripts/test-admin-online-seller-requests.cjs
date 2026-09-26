const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// --- admin-api: request detection and the atomic resolve RPC -----------------
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

const placeCategory = (enabled) => ({ name: '도가니탕', slug: 'doganitang', category_catalog_sources: enabled });
const sellerRequest = {
  id: 'request-1', category_id: 'dogani', name: '○○곰탕 온라인몰', status: 'pending', created_at: '2026-09-26T10:00:00Z',
  image_path: null, official_url: 'https://smartstore.example/gomtang', requested_category_label: null,
  categories: placeCategory({ place_catalog_enabled: true }),
};
const ordinaryRequest = {
  ...sellerRequest, id: 'request-2', name: '새 텀블러', official_url: 'https://shop.example/tumbler',
  categories: { name: '텀블러', slug: 'tumbler', category_catalog_sources: { place_catalog_enabled: false } },
};

async function apiChecks() {
  const calls = [];
  const api = loadApi(async (url, init = {}) => { calls.push({ url, body: init.body ? JSON.parse(init.body) : null }); return { status: 200, ok: true, json: async () => [] }; });

  assert.equal(api.isOnlineSellerRequest(sellerRequest), true);
  assert.equal(api.isOnlineSellerRequest({ ...sellerRequest, categories: placeCategory([{ place_catalog_enabled: true }]) }), true, 'Array embeds are understood too');
  assert.equal(api.isOnlineSellerRequest({ ...sellerRequest, official_url: null }), false, 'A restaurant request without a link is not a seller request');
  assert.equal(api.isOnlineSellerRequest(ordinaryRequest), false, 'Linked requests outside restaurant categories keep the normal review');
  assert.equal(api.isOnlineSellerRequest({ ...sellerRequest, categories: null }), false);

  await api.getPendingItems();
  assert.match(decodeURIComponent(calls[0].url), /categories\(name,slug,category_catalog_sources\(place_catalog_enabled\)\)/, 'Pending rows carry the place-category flag');

  await api.resolveOnlineSellerRequest({ itemId: 'request-1', name: '  ○○곰탕   공식몰 ', storeType: 'official_site', officialUrl: ' https://smartstore.example/gomtang ' });
  assert.equal(calls[1].url, 'https://example.supabase.co/rest/v1/rpc/admin_resolve_online_seller_request');
  assert.deepEqual(calls[1].body, {
    p_item_id: 'request-1', p_name: '○○곰탕 공식몰', p_store_type: 'official_site',
    p_official_url: 'https://smartstore.example/gomtang', p_platform: null, p_store_key: null,
  });

  assert.throws(() => api.resolveOnlineSellerRequest({ itemId: 'request-1', name: '배달', storeType: 'official_site', officialUrl: 'https://s.baemin.com/store/1' }), /배달앱 링크/);
  assert.throws(() => api.createOnlineProvider({ categoryId: 'dogani', name: '배달', storeType: 'official_site', officialUrl: 'https://web.coupangeats.com/x' }), /배달앱 링크/,
    'The existing provider form also refuses delivery apps');
  assert.equal(calls.length, 2, 'Rejected input never reaches the server');
  return api;
}

// --- PendingPanel: badge, filter, resolve flow -------------------------------
const source = fs.readFileSync(path.join(__dirname, '../src/components/admin/data/pending-panel.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
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
    useMemo(create, deps) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { deps, value: create() };
      return slots[index].value;
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: { current: initial } };
      return slots[index].value;
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
    exports: exported, Error, Intl, URL, Date, Set,
    window: { confirm: (message) => { confirms.push(message); return true; } },
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'react-native') return {
        ActivityIndicator: 'ActivityIndicator', Image: 'Image', Linking: { openURL: async () => undefined }, Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View',
        StyleSheet: { create: (value) => value },
      };
      if (name === '@/lib/admin-api') return api;
      // Admin photo registration is covered by test-admin-cleanup.cjs.
      if (name === '@/errors/appError') return { AppError: class AppError extends Error {} };
      if (name === '@/lib/admin/itemPhoto') return { chooseItemPhoto: async () => null, importItemPhoto: async () => null, itemPhotoUrl: () => null, saveItemPhoto: async () => ({}) };
      if (name === '@/lib/photos/photoFailure') return { photoFailureMessage: () => '' };
      if (name === '@/components/admin/admin-shell') return { adminStyles: {} };
      if (name === '@/constants/onepick') return { OnePick: {} };
      if (name === '@/lib/categories/categoryTree') return {
        categoryLabel: (item) => item.name,
        newLeafParentCategories: (items) => items.filter((item) => item.status === 'open' && item.isVisible && !item.isPickable),
        selectableCategories: (items) => items.filter((item) => item.status === 'open' && item.isVisible && item.isPickable),
      };
      assert.fail(`Unexpected dependency: ${name}`);
    },
  });
  const walk = (node) => Array.isArray(node) ? node.flatMap(walk) : (!node || typeof node !== 'object') ? [] : [node, ...walk(node.props.children)];
  const text = (node) => Array.isArray(node) ? node.map(text).join('') : (typeof node === 'string' || typeof node === 'number') ? String(node) : node?.props ? text(node.props.children) : '';
  const render = () => {
    for (let pass = 0; pass < 5; pass++) {
      cursor = 0; tree = expand(exported.PendingPanel());
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
  const input = (label) => {
    const found = walk(tree).find((node) => node.type === 'TextInput' && node.props.accessibilityLabel === label);
    return found?.props;
  };
  return { render, settle, button, input, confirms, texts: () => text(tree), pressables, text };
}

async function panelChecks(realApi) {
  const calls = { resolve: [], review: [] };
  let resolveResult = async () => [{ provider_id: 'p', online_store_id: 's', item_id: 'online-item', category_id: 'dogani', merged_item_id: 'request-1' }];
  const api = {
    ADMIN_PAGE_SIZE: 100,
    isOnlineSellerRequest: realApi.isOnlineSellerRequest,
    getPendingItems: async () => [JSON.parse(JSON.stringify(sellerRequest)), JSON.parse(JSON.stringify(ordinaryRequest))],
    getCategories: async () => [
      { id: 'dogani', parent_id: null, name: '도가니탕', slug: 'doganitang', status: 'open', is_visible: true, is_pickable: true, sort_order: 1, ranking_min_sample: 1, image_url: null },
      { id: 'tumbler', parent_id: null, name: '텀블러', slug: 'tumbler', status: 'open', is_visible: true, is_pickable: true, sort_order: 2, ranking_min_sample: 1, image_url: null },
    ],
    getPendingItemCategorySuggestion: async () => null,
    getMergeCandidates: async () => [],
    mergePendingItem: async () => ({}),
    updatePendingItem: async (...args) => { calls.review.push(args); return {}; },
    resolveOnlineSellerRequest: async (input) => { calls.resolve.push(input); return resolveResult(input); },
  };
  const view = harness(api);
  view.render();
  let page = await view.settle();

  assert.match(page, /온라인 판매처 요청 · 1/, 'The filter chip counts seller requests');
  assert.match(page, /온라인 판매처 요청[\s\S]*pending/, 'Seller requests get their own badge; ordinary rows keep pending');
  assert.match(page, /온라인 판매처로 연결/, 'The first (seller) request opens the resolve box');
  assert.equal(view.input('온라인 판매처 이름').value, '○○곰탕 온라인몰', 'Seller name is prefilled from the request');
  assert.equal(view.input('온라인 판매처 URL').value, 'https://smartstore.example/gomtang', 'Seller URL is prefilled from the attached link');
  assert.equal(view.pressables().some((node) => view.text(node) === '승인'), false, 'Plain approval is hidden for seller requests');
  assert.ok(view.button('반려'), 'Seller requests can still be rejected');

  view.button('온라인 판매처 요청만 보기').onPress();
  page = view.render();
  assert.doesNotMatch(page, /새 텀블러/, 'The filter hides ordinary requests');
  view.button('온라인 판매처 요청만 보기').onPress();
  page = view.render();
  assert.match(page, /새 텀블러/);

  view.input('온라인 판매처 이름').onChangeText('○○곰탕 공식몰');
  view.render();
  view.button('플랫폼 스토어').onPress();
  view.render();
  assert.ok(view.input('플랫폼 식별자') && view.input('스토어 키'), 'Platform stores ask for platform and store key');
  view.input('플랫폼 식별자').onChangeText('smartstore');
  view.input('스토어 키').onChangeText('smartstore:gomtang');
  view.render();

  resolveResult = async () => { throw new Error('new row violates check constraint "online_stores_not_delivery_app"'); };
  view.button('판매처 만들고 요청 연결').onPress();
  page = await view.settle();
  assert.match(page, /배달앱 링크는 온라인 판매처가 될 수 없습니다/, 'Server delivery-guard errors are translated');
  assert.match(page, /○○곰탕 온라인몰/, 'A failed resolve keeps the request in the queue');

  resolveResult = async () => [{ provider_id: 'p', online_store_id: 's', item_id: 'online-item', category_id: 'dogani', merged_item_id: 'request-1' }];
  view.button('판매처 만들고 요청 연결').onPress();
  page = await view.settle();
  assert.equal(calls.resolve.length, 2);
  assert.deepEqual({ ...calls.resolve[1] }, {
    itemId: 'request-1', name: '○○곰탕 공식몰', storeType: 'platform_store',
    officialUrl: 'https://smartstore.example/gomtang', platform: 'smartstore', storeKey: 'smartstore:gomtang',
  });
  assert.match(view.confirms[0], /되돌릴 수 없습니다/, 'Resolving asks for confirmation first');
  assert.match(page, /요청을 온라인 판매처로 연결했습니다. 요청자에게 알림이 가고/);
  assert.match(page, /온라인 판매처 요청 · 0/, 'The resolved request leaves the queue');
  assert.equal(view.input('온라인 판매처 이름'), undefined, 'The next (ordinary) request has no resolve form');
  assert.ok(view.pressables().some((node) => view.text(node) === '승인'), 'Ordinary requests keep plain approval');
  assert.equal(calls.review.length, 0, 'Resolving never goes through plain approval');
}

(async () => {
  const api = await apiChecks();
  await panelChecks(api);
  console.log('Admin online seller request checks passed: request detection, atomic resolve RPC, delivery refusal, queue filter, prefilled resolve form and approval guard.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
