const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
let query, destination;
const component = ({ children }) => React.createElement('div', null, children);
const imports = {
  'expo-router': {
    useLocalSearchParams: () => ({ pickId: 'shared-review' }), useRouter: () => ({}),
    Redirect: ({ href }) => { destination = href; return null; },
  },
  'react-native': { ActivityIndicator: () => null, Pressable: component, Text: component, View: component, StyleSheet: { create: (x) => x } },
  'react-native-safe-area-context': { SafeAreaView: component },
  '@/hooks/useAuthSession': { useAuthSession: () => ({ user: null }) },
  '@/hooks/usePickDetail': { usePickDetail: () => query },
  '@/services': { observabilityService: { captureProductEvent: async () => {} } },
};
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/pick/[pickId].tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: exportsObject, require: (name) => name === 'react' || name === 'react/jsx-runtime' ? require(name) : imports[name] });
const render = () => { destination = null; return renderToStaticMarkup(React.createElement(exportsObject.default)); };
query = { isPending: true };
assert.match(render(), /원픽을 불러오고 있어요/);
assert.equal(destination, null);
query = { data: { pick: { id: 'shared-review', itemId: 'product' } } };
render();
assert.equal(destination.pathname, '/item/[itemId]');
assert.equal(destination.params.itemId, 'product');
assert.equal(destination.params.pickId, 'shared-review');
query = { ...query, isError: true };
assert.match(render(), /원픽을 볼 수 없어요/);
assert.equal(destination, null, 'A failed lookup must not redirect using stale data');
console.log('Legacy Pick links passed: pending, product/review routing, unavailable and stale-error states.');
