// #757 follow-up: profile rows open the pick detail as one button, so the detail
// must carry the real store link. A plain item read (items table) has no
// provider column; the provider comes from item_providers, the same relation
// the home feed uses. This exercises the real repository, the service passthrough
// and the screen's show/hide behavior instead of matching button strings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadSource(relativePath, imports = {}) {
  const result = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports,
    require: (name) => {
      if (name === '@/constants/onepick') return require('./design-tokens.cjs');
      if (name in imports) return imports[name];
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name === '@/components/ui') return require('./icon-stub.cjs');
      throw new Error('Unexpected runtime dependency: ' + name);
    },
  });
  return exports;
}

// Fake Supabase client: items table plus item_providers relation.
function fakeClient(itemProviders) {
  const tables = {
    items: (id) => ({ id, name: '99밀크티앤커피 흑당밀크티', category_id: 'food-cafe', image_path: null, thumbnail_path: null }),
  };
  return {
    from(table) {
      if (table === 'items') {
        const q = { select: () => q, eq: (_c, id) => ({ maybeSingle: async () => ({ data: tables.items(id), error: null }) }) };
        return q;
      }
      if (table === 'item_providers') {
        const q = {
          select: () => q,
          in: async (_c, ids) => ({ data: itemProviders.filter((row) => ids.includes(row.item_id)), error: null }),
        };
        return q;
      }
      assert.fail('Unexpected table: ' + table);
    },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  };
}

async function repositoryChecks() {
  const { fetchItemProviderIds } = loadSource('repositories/supabase/itemProviders.ts');
  const { SupabaseItemRepository } = loadSource('repositories/supabase/supabaseItemRepository.ts', {
    '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
    '@/errors/appError': { AppError: Error },
    '@/repositories/mappers/itemMapper': { mapItemRow: (row) => ({ id: row.id, name: row.name, categoryId: row.category_id, status: 'active' }) },
    '@/repositories/supabase/itemChannels': { fetchItemChannels: async () => new Map([['item-store', ['offline']]]) },
    '@/repositories/supabase/itemProviders': { fetchItemProviderIds },
  });

  const linked = new SupabaseItemRepository(fakeClient([{ item_id: 'item-store', provider_id: 'provider-99' }]));
  const withStore = await linked.getById('item-store');
  assert.equal(withStore.providerId, 'provider-99', 'A plain item read resolves the store through item_providers');
  assert.equal(JSON.stringify(withStore.channels), JSON.stringify(['offline']), 'Channel lookup still runs alongside the provider lookup');

  const withoutStore = await linked.getById('item-plain');
  assert.equal(withoutStore.providerId, null, 'Items without a store carry providerId null, not undefined');

  const noRelation = new SupabaseItemRepository(fakeClient([]));
  assert.equal((await noRelation.getById('item-store')).providerId, null);

  // Enhancement-only: a failing provider lookup must not break the item itself.
  const broken = fakeClient([]);
  const originalFrom = broken.from.bind(broken);
  broken.from = (table) => table === 'item_providers'
    ? { select: () => ({ in: async () => ({ data: null, error: new Error('offline') }) }) }
    : originalFrom(table);
  const degraded = await new SupabaseItemRepository(broken).getById('item-store');
  assert.equal(degraded.id, 'item-store');
  assert.equal(degraded.providerId, null);
}

async function serviceChecks() {
  const { ItemService } = loadSource('services/itemService.ts', { '@/errors/appError': { AppError: Error } });
  const item = { id: 'item-store', name: '흑당밀크티', categoryId: 'food-cafe', status: 'active', providerId: 'provider-99' };
  const service = new ItemService(
    { getById: async () => item },
    { getCurrentPicksInCategory: async () => [] },
    { getById: async () => ({ id: 'food-cafe', rootSlug: 'food' }), getOpenCategories: async () => [{ id: 'food-cafe', rootSlug: 'food' }] },
    { getPicks: async () => [], getPickById: async () => null },
  );
  const detail = await service.getItemDetail('item-store', 'viewer');
  assert.equal(detail.item.providerId, 'provider-99', 'getItemDetail passes the repository providerId through untouched');
}

function screenChecks() {
  const pushes = [];
  const component = ({ children }) => React.createElement('div', null, children);
  const pressable = ({ children, accessibilityLabel, onPress }) => React.createElement('button', { 'aria-label': accessibilityLabel, onClick: onPress }, children);
  let itemQuery;
  const pickQuery = { isPending: false, isError: false, data: { pick: { id: 'pick-1', itemId: 'item-store' }, item: { name: '흑당밀크티' } }, refetch() {} };
  const screen = loadSource('app/pick/[pickId].tsx', {
    'expo-router': {
      useLocalSearchParams: () => ({ pickId: 'pick-1' }),
      useRouter: () => ({ canGoBack: () => true, back() {}, replace() {}, push: (target) => pushes.push(target) }),
    },
    'react-native': {
      ActivityIndicator: () => null, Pressable: pressable, ScrollView: component, Text: component, View: component,
      StyleSheet: { create: (x) => x, hairlineWidth: 1 },
    },
    'react-native-safe-area-context': { SafeAreaView: component },
    '@/components/current-pick-flag': { CurrentPickFlag: () => null },
    '@/components/pick-replies': { PickReplies: () => null },
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: 'viewer' } }) },
    '@/hooks/usePickDetail': { usePickDetail: () => pickQuery },
    '@/hooks/useItemDetail': { useItemDetail: () => itemQuery },
    '@/hooks/useNotifications': { useReadNotificationGroup: () => ({ mutateAsync: async () => 0 }) },
    '@/lib/items/itemTitle': { itemTitle: (name) => name },
    '@/services': { observabilityService: { captureProductEvent: async () => {} } },
  });
  const pressableProps = [];
  const captured = loadSource('app/pick/[pickId].tsx', {
    'expo-router': {
      useLocalSearchParams: () => ({ pickId: 'pick-1' }),
      useRouter: () => ({ canGoBack: () => true, back() {}, replace() {}, push: (target) => pushes.push(target) }),
    },
    'react-native': {
      ActivityIndicator: () => null, ScrollView: component, Text: component, View: component,
      Pressable: (props) => { pressableProps.push(props); return pressable(props); },
      StyleSheet: { create: (x) => x, hairlineWidth: 1 },
    },
    'react-native-safe-area-context': { SafeAreaView: component },
    '@/components/current-pick-flag': { CurrentPickFlag: () => null },
    '@/components/pick-replies': { PickReplies: () => null },
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: 'viewer' } }) },
    '@/hooks/usePickDetail': { usePickDetail: () => pickQuery },
    '@/hooks/useItemDetail': { useItemDetail: () => itemQuery },
    '@/hooks/useNotifications': { useReadNotificationGroup: () => ({ mutateAsync: async () => 0 }) },
    '@/lib/items/itemTitle': { itemTitle: (name) => name },
    '@/services': { observabilityService: { captureProductEvent: async () => {} } },
  });
  const baseData = {
    category: { name: '카페' }, isRestaurant: true,
    picks: [{ pick: { id: 'pick-1', userId: 'someone', oneLineReview: '달아요', isCurrent: true, isDeleted: false, canComment: true }, profile: { username: 'friend' } }],
  };

  itemQuery = { isPending: false, isError: false, refetch() {}, data: { ...baseData, item: { id: 'item-store', name: '흑당밀크티', imageSourceUrl: 'https://x/y.jpg', providerId: 'provider-99' } } };
  const withStore = renderToStaticMarkup(React.createElement(screen.default));
  assert.match(withStore, /메뉴 상세 보기/);
  assert.match(withStore, /매장 보기/, 'A store-linked item shows 매장 보기 in the pick detail');
  pressableProps.length = 0;
  renderToStaticMarkup(React.createElement(captured.default));
  const storeButton = pressableProps.find((p) => typeof p.accessibilityLabel === 'string' && p.accessibilityLabel.endsWith('매장 보기'));
  const menuButton = pressableProps.find((p) => typeof p.accessibilityLabel === 'string' && p.accessibilityLabel.endsWith('메뉴 상세 보기'));
  storeButton.onPress();
  menuButton.onPress();
  assert.equal(JSON.stringify(pushes[0]), JSON.stringify({ pathname: '/provider/[providerId]', params: { providerId: 'provider-99', scope: 'provider' } }), '매장 보기 navigates to the exact provider from item_providers');
  assert.equal(JSON.stringify(pushes[1]), JSON.stringify({ pathname: '/item/[itemId]', params: { itemId: 'item-store' } }), '메뉴 상세 보기 keeps opening the item detail');

  itemQuery = { ...itemQuery, data: { ...baseData, item: { id: 'item-plain', name: '집밥', imageSourceUrl: 'https://x/z.jpg', providerId: null } } };
  const withoutStore = renderToStaticMarkup(React.createElement(screen.default));
  assert.match(withoutStore, /메뉴 상세 보기/);
  assert.doesNotMatch(withoutStore, /매장 보기/, 'Items without a store hide 매장 보기');
}

async function main() {
  await repositoryChecks();
  await serviceChecks();
  screenChecks();
  console.log('Pick detail store link checks passed: item_providers lookup on plain item reads, service passthrough, and show/hide + navigation in the screen.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
