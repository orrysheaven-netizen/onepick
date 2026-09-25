const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const tokens = require('./design-tokens.cjs');

const root = path.resolve(__dirname, '..');
const jsx = (type, props) => ({ type, props: props ?? {} });
const flattenStyle = (style) => Array.isArray(style)
  ? Object.assign({}, ...style.filter(Boolean).map(flattenStyle))
  : style ?? {};

const mocks = {
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  react: {},
  'react-native': {
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    StyleSheet: { create: (styles) => styles, flatten: flattenStyle },
    Text: 'Text',
    View: 'View',
    useWindowDimensions: () => ({ width: 1200 }),
  },
  'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  'expo-router': { Link: 'Link', usePathname: () => '/admin/dashboard' },
  '@/constants/onepick': tokens,
};

const source = fs.readFileSync(path.join(root, 'src/components/admin/admin-shell.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  fileName: 'admin-shell.tsx',
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
});
assert.equal((compiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);

const exports = {};
vm.runInNewContext(compiled.outputText, {
  exports,
  module: { exports },
  require: (id) => {
    assert.ok(Object.hasOwn(mocks, id), `Unmocked dependency: ${id}`);
    return mocks[id];
  },
}, { filename: 'admin-shell.tsx', timeout: 1000 });

function all(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => all(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}

const tree = exports.AdminShell({ children: 'content', onSignOut: () => {} });
const links = all(tree, (node) => node.type === 'Link' && String(node.props.href).startsWith('/admin/'));
assert.equal(links.length, 4);

for (const link of links) {
  assert.equal(link.props.asChild, true);
  const pressable = link.props.children;
  assert.equal(pressable.type, 'Pressable');
  assert.ok(pressable.props.style && typeof pressable.props.style === 'object' && !Array.isArray(pressable.props.style));
  assert.equal(pressable.props.style.paddingVertical, 11);
  assert.equal(pressable.props.style.paddingHorizontal, 12);
  assert.equal(pressable.props.style.borderRadius, 8);
}

const active = links.find((link) => link.props.href === '/admin/dashboard').props.children;
assert.equal(active.props.style.backgroundColor, tokens.OnePick.sunken);
const inactive = links.find((link) => link.props.href === '/admin/data').props.children;
assert.equal(inactive.props.style.backgroundColor, undefined);

console.log('Admin shell Link style checks passed.');
