const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

let pickQuery, itemQuery;
const component = ({ children }) => React.createElement('div', null, children);
const imports = {
  'expo-router': {
    useLocalSearchParams: () => ({ pickId: 'shared-review' }),
    useRouter: () => ({ canGoBack: () => false, back() {}, replace() {} }),
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
  '@/components/current-pick-flag': { CurrentPickFlag: () => React.createElement('i', null, 'flag') },
  '@/components/pick-replies': { PickReplies: ({ pickId, canWrite }) => React.createElement('i', null, 'thread:' + pickId + ':' + canWrite) },
  '@/hooks/useAuthSession': { useAuthSession: () => ({ user: null }) },
  '@/hooks/usePickDetail': { usePickDetail: () => pickQuery },
  '@/hooks/useItemDetail': { useItemDetail: () => itemQuery },
  '@/hooks/useNotifications': { useReadNotificationGroup: () => ({ mutateAsync: async () => 0 }) },
  '@/lib/items/itemTitle': { itemTitle: () => '중앙해장 내장탕' },
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
    item: { id: 'product', name: '중앙해장', imageSourceUrl: 'https://onepick.test/product.jpg' },
    category: { name: '내장탕' },
    isRestaurant: true,
    picks: [{
      pick: { id: 'shared-review', userId: 'someone', oneLineReview: '국물이 좋아요', isCurrent: true, isDeleted: false, canComment: true },
      profile: { username: 'friend' },
    }],
  },
};
const loaded = render();
assert.match(loaded, /중앙해장 내장탕/);
assert.match(loaded, /@friend/);
assert.match(loaded, /국물이 좋아요/);
assert.match(loaded, /thread:shared-review:true/);

itemQuery = { ...itemQuery, isError: true, data: undefined };
assert.match(render(), /한줄평을 볼 수 없어요/);

console.log('Pick conversation links passed: pending, focused review, comment permission and unavailable states.');
