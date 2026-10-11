const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

let pickQuery, itemQuery, sessionUser = null;
const actions = new Map();
const navigation = [];
const component = ({ children, testID, accessibilityLabel, onPress }) => {
  if (accessibilityLabel && onPress) actions.set(accessibilityLabel, onPress);
  return React.createElement('div', { 'data-testid': testID }, children);
};
const imports = {
  'expo-router': {
    useLocalSearchParams: () => ({ pickId: 'shared-review' }),
    useRouter: () => ({ canGoBack: () => false, back() {}, replace() {}, push(route) { navigation.push(route); } }),
  },
  'react-native': {
    ActivityIndicator: () => React.createElement('i', null, 'loading'),
    Pressable: component,
    ScrollView: component,
    Text: component,
    View: component,
    StyleSheet: { create: (x) => x, hairlineWidth: 1 },
  },
  'react-native-safe-area-context': { SafeAreaView: component },
  '@/components/pick-photo': { PickPhoto: ({ uri, label }) => React.createElement('img', { 'data-testid': 'pick-photo', src: uri ?? undefined, alt: label }) },
  '@/components/current-pick-flag': { CurrentPickFlag: () => React.createElement('i', null, 'flag') },
  '@/components/pick-replies': { PickReplies: ({ pickId, canWrite, focusCommentId }) => React.createElement('i', null, 'thread:' + pickId + ':' + canWrite + ':' + (focusCommentId ?? '')) },
  '@/hooks/useAuthSession': { useAuthSession: () => ({ user: sessionUser }) },
  '@/hooks/usePickDetail': { usePickDetail: () => pickQuery },
  '@/hooks/useItemDetail': { useItemDetail: () => itemQuery },
  '@/hooks/useNotifications': { useReadNotificationGroup: () => ({ mutateAsync: async () => 0 }) },
  '@/lib/items/itemTitle': { itemTitle: () => '헤더 전용 제목' },
  '@/services': { observabilityService: { captureProductEvent: async () => {} } },
};

const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/pick/[pickId].tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, {
  exports: exportsObject,
  require: (name) => name === '@/constants/onepick'
    ? require('./design-tokens.cjs')
    : name === 'react' || name === 'react/jsx-runtime'
      ? require(name)
      : name === '@/components/ui'
        ? { ...require('./icon-stub.cjs'), ...(imports[name] ?? {}) }
        : imports[name],
});

const render = () => renderToStaticMarkup(React.createElement(exportsObject.default));

pickQuery = { isPending: true, isError: false, data: undefined, refetch() {} };
itemQuery = { isPending: false, isError: false, data: undefined, refetch() {} };
assert.match(render(), /한줄평 대화를 불러오고 있어요/);

pickQuery = { isPending: false, isError: false, data: { pick: { id: 'shared-review', itemId: 'product' }, item: { name: '중앙해장' } }, refetch() {} };
itemQuery = { isPending: true, isError: false, data: undefined, refetch() {} };
assert.match(render(), /한줄평 대화를 불러오고 있어요/);

itemQuery = {
  isPending: false,
  isError: false,
  refetch() {},
  data: {
    item: { id: 'product', name: '중앙해장', imageSourceUrl: 'https://onepick.test/product.jpg', channels: ['offline'], providerId: 'store-1' },
    category: { name: '내장탕' },
    isRestaurant: true,
    picks: [{
      pick: { id: 'shared-review', userId: 'someone', oneLineReview: '국물이 좋아요', isCurrent: true, isDeleted: false, canComment: true },
      profile: { username: 'friend' },
    }],
  },
};
const loaded = render();
const order = [
  'data-testid="pick-item-context"',
  'data-testid="pick-photo"',
  'data-testid="pick-store-name"',
  'data-testid="pick-menu-name"',
  '@friend',
  '국물이 좋아요',
  'thread:shared-review:true:',
];
const positions = order.map((part) => {
  const index = loaded.indexOf(part);
  assert.ok(index >= 0, 'Missing Pick detail block: ' + part);
  return index;
});
assert.ok(positions.every((pos, i) => i === 0 || positions[i - 1] < pos), 'Photo → store → menu → author/review → thread order');
assert.match(loaded, /data-testid="pick-photo"[^>]*src="https:\/\/onepick\.test\/product\.jpg"/);
assert.match(loaded, /data-testid="pick-store-name"[^>]*>중앙해장<\/div>/, 'Store must be in the body');
assert.match(loaded, /data-testid="pick-menu-name"[^>]*>내장탕<\/div>/, 'Menu must be in the body');
assert.match(loaded, /한줄평 대화/, 'The generic header avoids duplicating the body title');
assert.doesNotMatch(loaded, /헤더 전용 제목/);
assert.equal(typeof actions.get('중앙해장 매장 보기'), 'function', 'A real provider is a link');
actions.get('중앙해장 매장 보기')();
assert.equal(navigation.at(-1).pathname, '/provider/[providerId]');
assert.equal(navigation.at(-1).params.providerId, 'store-1');
assert.equal(navigation.at(-1).params.scope, 'provider');

// Legacy food items with no channel never show a category as a fabricated menu.
actions.clear();
itemQuery = { ...itemQuery, data: { ...itemQuery.data, item: { ...itemQuery.data.item, channels: [], providerId: null } } };
const legacy = render();
assert.doesNotMatch(legacy, /data-testid="pick-store-name"/);
assert.match(legacy, /data-testid="pick-menu-name"[^>]*>중앙해장<\/div>/);
assert.doesNotMatch(legacy, /내장탕/, 'No fake menu for a legacy row');
assert.equal(actions.has('중앙해장 매장 보기'), false);

// Uncategorized and non-restaurant items remain readable without inventing a store.
itemQuery = { ...itemQuery, data: { ...itemQuery.data, category: null, isRestaurant: false } };
const uncategorized = render();
assert.match(uncategorized, /data-testid="pick-menu-name"[^>]*>중앙해장<\/div>/);
assert.doesNotMatch(uncategorized, /data-testid="pick-store-name"/);
itemQuery = { ...itemQuery, data: { ...itemQuery.data, item: { ...itemQuery.data.item, name: '신라면' }, category: { name: '라면' }, isRestaurant: false } };
const nonRestaurant = render();
assert.match(nonRestaurant, /data-testid="pick-menu-name"[^>]*>신라면<\/div>/);
assert.doesNotMatch(nonRestaurant, /data-testid="pick-store-name"|>라면<\/div>/);

// A known online store without a known category cannot invent a menu.
itemQuery = { ...itemQuery, data: { ...itemQuery.data, item: { ...itemQuery.data.item, name: '중앙해장', channels: ['online'] }, category: null, isRestaurant: false } };
const noMenu = render();
assert.match(noMenu, /data-testid="pick-store-name"[^>]*>중앙해장<\/div>/);
assert.doesNotMatch(noMenu, /data-testid="pick-menu-name"/);

// Photo-less public restriction precedes the new item context.
itemQuery = { ...itemQuery, data: { ...itemQuery.data, item: { ...itemQuery.data.item, imageSourceUrl: null } } };
assert.match(render(), /사진이 있는 원픽만 공개하고 있어요/);
assert.doesNotMatch(render(), /data-testid="pick-item-context"/);
sessionUser = { id: 'someone' };
assert.match(render(), /data-testid="pick-item-context"/, 'Owner can view own photo-less Pick');
sessionUser = null;
itemQuery = { ...itemQuery, isError: true, data: undefined };
assert.match(render(), /한줄평을 볼 수 없어요/);

console.log('Pick conversation links passed: pending, focused review, comment permission and unavailable states.');
