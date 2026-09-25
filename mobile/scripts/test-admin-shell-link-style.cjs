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

function compile(relativePath, mocks) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: path.basename(relativePath),
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  assert.equal((compiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  const moduleExports = {};
  vm.runInNewContext(compiled.outputText, {
    exports: moduleExports,
    module: { exports: moduleExports },
    require: (id) => {
      assert.ok(Object.hasOwn(mocks, id), `Unmocked dependency: ${id}`);
      return mocks[id];
    },
  }, { filename: relativePath, timeout: 1000 });
  return moduleExports;
}

const dataTabs = compile('src/lib/admin/dataTabs.ts', {});
const route = { pathname: '/admin/dashboard', params: {} };

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
  'expo-router': { Link: 'Link', usePathname: () => route.pathname, useGlobalSearchParams: () => route.params },
  '@/constants/onepick': tokens,
  '@/lib/admin/dataTabs': dataTabs,
};

const moduleExports = compile('src/components/admin/admin-shell.tsx', mocks);

function all(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => all(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}

// Arrays built inside the vm context have a different prototype; compare by value.
const sameList = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
const render = (props = {}) => moduleExports.AdminShell({ children: 'content', onSignOut: () => {}, ...props });
const adminLinks = (tree) => all(tree, (node) => node.type === 'Link' && String(node.props.href).startsWith('/admin/'));

const tree = render();
const links = adminLinks(tree);
const expectedHrefs = dataTabs.ADMIN_NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.href));
sameList(links.map((link) => link.props.href), expectedHrefs);
assert.ok(expectedHrefs.includes('/admin/place-catalog-qa') && expectedHrefs.includes('/admin/profile-taste-qa'));
for (const tab of dataTabs.ADMIN_DATA_TABS) {
  assert.ok(expectedHrefs.includes(`/admin/data?tab=${tab.key}`), `sidebar links the ${tab.key} tab`);
}

for (const link of links) {
  assert.equal(link.props.asChild, true);
  const pressable = link.props.children;
  assert.equal(pressable.type, 'Pressable');
  assert.ok(pressable.props.style && typeof pressable.props.style === 'object' && !Array.isArray(pressable.props.style));
  assert.equal(pressable.props.style.paddingVertical, 11);
  assert.equal(pressable.props.style.paddingHorizontal, 12);
  assert.equal(pressable.props.style.borderRadius, 8);
}

const styleOf = (tree, href) => adminLinks(tree).find((link) => link.props.href === href).props.children.props.style;
assert.equal(styleOf(tree, '/admin/dashboard').backgroundColor, tokens.OnePick.sunken);
assert.equal(styleOf(tree, '/admin/data?tab=pending').backgroundColor, undefined);

// A data tab is active by its ?tab= value, not by the shared /admin/data path.
route.pathname = '/admin/data';
route.params = { tab: 'pending' };
const onPending = render({ queueCounts: { pending: 3, reports: 0 } });
assert.equal(styleOf(onPending, '/admin/data?tab=pending').backgroundColor, tokens.OnePick.sunken);
assert.equal(styleOf(onPending, '/admin/data?tab=reports').backgroundColor, undefined);
assert.equal(styleOf(onPending, '/admin/dashboard').backgroundColor, undefined);

const badgeTexts = (tree, href) => all(adminLinks(tree).find((link) => link.props.href === href), (node) => node.type === 'Text').map((node) => node.props.children);
sameList(badgeTexts(onPending, '/admin/data?tab=pending'), ['검수 대기', 3]);
sameList(badgeTexts(onPending, '/admin/data?tab=reports'), ['신고'], 'an empty queue shows no badge');
sameList(badgeTexts(render({ queueCounts: { pending: 140 } }), '/admin/data?tab=pending'), ['검수 대기', '99+']);

// /admin/data without a tab opens the default tab, so that entry is highlighted.
route.params = {};
assert.equal(styleOf(render(), `/admin/data?tab=${dataTabs.DEFAULT_ADMIN_DATA_TAB}`).backgroundColor, tokens.OnePick.sunken);

console.log('Admin shell checks passed: grouped sidebar covers every tab, tab-aware active state, queue badges and Link styles.');
