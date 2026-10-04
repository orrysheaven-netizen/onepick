const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

let pickQuery, params;
const component = ({ children }) => React.createElement('div', null, children);
const imports = {
  'expo-router': {
    Redirect: ({ href }) => React.createElement('i', null, 'redirect:' + JSON.stringify(href)),
    useLocalSearchParams: () => params,
    useRouter: () => ({ canGoBack: () => false, back() {}, replace() {} }),
  },
  'react-native': {
    ActivityIndicator: () => React.createElement('i', null, 'loading'),
    Pressable: component,
    Text: component,
    View: component,
    StyleSheet: { create: (x) => x, hairlineWidth: 1 },
  },
  'react-native-safe-area-context': { SafeAreaView: component },
  '@/hooks/useAuthSession': { useAuthSession: () => ({ user: null }) },
  '@/hooks/usePickDetail': { usePickDetail: () => pickQuery },
  '@/services': { observabilityService: { captureProductEvent: async () => {} } },
};

const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/pick/[pickId].tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, {
  exports: exportsObject,
  require: (name) => {
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    assert.ok(name in imports, 'Unexpected runtime dependency: ' + name);
    return imports[name];
  },
});

const render = () => renderToStaticMarkup(React.createElement(exportsObject.default));
const redirectOf = (html) => {
  const match = /redirect:(.*?)<\/i>/.exec(html);
  return match ? JSON.parse(match[1].replace(/&quot;/g, '"')) : null;
};

// A shared link without item identity waits for the pick lookup.
params = { pickId: 'shared-review' };
pickQuery = { isPending: true, isError: false, data: undefined, refetch() {} };
assert.match(render(), /한줄평을 불러오고 있어요/);
assert.equal(redirectOf(render()), null);

// There is no conversation screen (10-04): it opens the item detail with the thread expanded.
pickQuery = { isPending: false, isError: false, data: { pick: { id: 'shared-review', itemId: 'product', channel: 'offline' }, item: { name: '중앙해장' } }, refetch() {} };
assert.deepEqual(redirectOf(render()), { pathname: '/item/[itemId]', params: { itemId: 'product', pickId: 'shared-review', thread: '1' } });

// Notification and comment-list params travel with the hand-off.
params = { pickId: 'p1', itemId: 'i1', notificationKind: 'reply', notificationGroupId: 'g', notificationSnapshot: 's', rootCommentId: 'c1', commentAfterTime: 't', commentAfterId: 'a', focusCommentId: 'f' };
assert.deepEqual(redirectOf(render()).params, {
  itemId: 'i1', pickId: 'p1', thread: '1', focusCommentId: 'f', notificationGroupId: 'g', notificationSnapshot: 's',
  notificationKind: 'reply', rootCommentId: 'c1', commentAfterTime: 't', commentAfterId: 'a',
});

// Hidden future channels stay closed in the MVP.
params = { pickId: 'online-review' };
pickQuery = { isPending: false, isError: false, data: { pick: { id: 'online-review', itemId: 'product', channel: 'online' } }, refetch() {} };
assert.match(render(), /현재 공개 중인 원픽이 아니에요/);
assert.equal(redirectOf(render()), null);

// Missing/removed reviews keep a retry state.
pickQuery = { isPending: false, isError: true, data: undefined, refetch() {} };
assert.match(render(), /한줄평을 볼 수 없어요/);

console.log('Pick links passed: pending lookup, hand-off to the item thread with forwarded params, hidden channel and unavailable states.');
