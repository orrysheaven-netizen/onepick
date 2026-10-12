// #762 (user request 2026-10-12): on Home only, scrolling down hides the bottom tab bar and
// scrolling up shows it again. Deterministic checks of the direction logic and of both tab
// shells (web floating bar, native NativeTabs); not a browser or device test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const tokens = require('./design-tokens.cjs');

const root = path.join(__dirname, '..');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
function load(file, mocks) {
  const result = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  assert.equal((result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0, `${file}: syntax`);
  const exports = {};
  vm.runInNewContext(result.outputText, { exports, module: { exports }, require: (id) => {
    assert.ok(Object.hasOwn(mocks, id), `Unmocked dependency: ${id}`);
    return mocks[id];
  } }, { filename: file, timeout: 1000 });
  return exports;
}

// ---- Direction logic ---------------------------------------------------------------------
const { HOME_TAB_BAR_SCROLL_THRESHOLD: T, initialHomeTabBarScroll, nextHomeTabBarScroll } = load('src/lib/home/homeTabBarScroll.ts', {});
const run = (offsets, { content = 3000, viewport = 600, start = initialHomeTabBarScroll } = {}) => {
  let state = start;
  const toggles = [];
  for (const entry of offsets) {
    const sample = typeof entry === 'number' ? { offsetY: entry, contentHeight: content, viewportHeight: viewport } : { contentHeight: content, viewportHeight: viewport, ...entry };
    const next = nextHomeTabBarScroll(state, sample);
    if (next.hidden !== state.hidden) toggles.push(next.hidden);
    state = next;
  }
  return { state, toggles };
};

test('threshold is a small fixed 24px', () => assert.equal(T, 24));

test('scrolling down hides only after the threshold; scrolling up shows only after the threshold', () => {
  assert.deepEqual(run([100, 110, 123]).toggles, [], '23px down keeps the bar');
  assert.deepEqual(run([100, 124]).toggles, [true], '24px down hides');
  assert.deepEqual(run([100, 400, 377]).toggles, [true], '23px up keeps it hidden');
  assert.deepEqual(run([100, 400, 376]).toggles, [true, false], '24px up shows it again');
  assert.deepEqual(run([100, 400, 376, 1000]).toggles, [true, false, true], 'down again hides again');
});

test('jitter and tiny back-and-forth never toggle', () => {
  const jitter = [500];
  for (let i = 0; i < 40; i++) jitter.push(500 + (i % 2 ? 11 : -11)); // 22px peak-to-peak, under the threshold
  assert.deepEqual(run(jitter).toggles, []);
  const hiddenJitter = [100, 400];
  for (let i = 0; i < 40; i++) hiddenJitter.push(400 + (i % 2 ? 11 : -11));
  assert.deepEqual(run(hiddenJitter).toggles, [true], 'hidden bar stays hidden under jitter');
});

test('turning point is the extreme, not the start: slow drift then reversal is measured from the turn', () => {
  // Shown: drifts up to 80 (new low), then 24 down from that low hides.
  assert.deepEqual(run([100, 90, 80, 103]).toggles, []);
  assert.deepEqual(run([100, 90, 80, 104]).toggles, [true]);
  // Hidden: goes further down to 900 (new high), then 24 up from there shows.
  assert.deepEqual(run([100, 200, 900, 877]).toggles, [true]);
  assert.deepEqual(run([100, 200, 900, 876]).toggles, [true, false]);
});

test('top of list, pull-to-refresh and short content always show the bar', () => {
  assert.deepEqual(run([100, 400, 0]).toggles, [true, false], 'reaching the top shows it');
  assert.deepEqual(run([100, 400, -60]).toggles, [true, false], 'pull-to-refresh overscroll shows it');
  assert.equal(run([0, 30, 60, 90], { content: 500, viewport: 600 }).state.hidden, false, 'content shorter than the viewport never hides');
  assert.equal(run([], {}).state.hidden, false, 'no events: visible');
});

test('end-of-list bounce and load-more swipe do not count as scrolling up', () => {
  // max offset = 2400. Overscroll past the end (iOS bounce / swipe-up load) is clamped.
  assert.deepEqual(run([2300, 2400, 2480, 2440, 2400]).toggles, [true], 'rubber-band back to the end keeps it hidden');
});

test('a viewport resize (the bar itself leaving or returning) re-baselines instead of toggling', () => {
  // Hidden at the bottom; the viewport grows by the bar height and the offset is clamped up by 114.
  const r = run([2000, 2400, { offsetY: 2286, viewportHeight: 714 }, { offsetY: 2286, viewportHeight: 714 }]);
  assert.deepEqual(r.toggles, [true], 'no show/hide feedback loop at the list end');
  assert.equal(r.state.anchorY, 2286);
});

test('first event after focus or a list swap only sets the baseline', () => {
  assert.deepEqual(run([1500]).toggles, [], 'returning to Home mid-list does not hide on the first event');
  assert.deepEqual(run([1500, 1530]).toggles, [true]);
});

// ---- Web floating bar ----------------------------------------------------------------------
const jsx = (type, props) => ({ type, props: props ?? {} });
const flat = (style) => Array.isArray(style) ? style.flatMap(flat) : style ? [style] : [];
const styleOf = (node) => Object.assign({}, ...flat(typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style));
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function') return expand(node.type(node.props));
  return { ...node, props: { ...node.props, children: expand(node.props.children) } };
}
function all(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => all(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...all(node.props.children, predicate)];
}
function shell(file, extra = {}) {
  let pathname = '/';
  const states = [];
  let cursor = 0;
  const react = { useState(initial) {
    const i = cursor++;
    if (!(i in states)) states[i] = initial;
    return [states[i], (next) => { states[i] = next; }];
  } };
  const mocks = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (s) => s, flatten: (s) => Object.assign({}, ...flat(s)) } },
    '@/constants/onepick': tokens,
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: null, isLoading: false, error: null }) },
    '@/hooks/useNotifications': { useNotificationCount: () => ({ data: 0, isError: false }) },
    'expo-router': { Link: 'Link', Slot: 'Slot', usePathname: () => pathname, useRouter: () => ({ push() {}, replace() {} }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 20 }) },
    '@/components/ui/icon': { Icon: () => null },
    ...extra,
  };
  const mod = load(file, mocks);
  return {
    mod,
    at(next) { pathname = next; },
    render() { cursor = 0; return expand(mod.default()); },
  };
}
const barOf = (tree) => all(tree, (n) => n.type === 'View' && styleOf(n).position === 'absolute' && styleOf(n).flexDirection === 'row')[0];
const slotOf = (tree) => all(tree, (n) => n.type === 'View' && n.props.children?.type === 'Slot')[0];

test('web: shown bar keeps the locked geometry, five 44px tabs and the reserved content gap', () => {
  const web = shell('src/components/app-tabs.web.tsx');
  const tree = web.render();
  const bar = barOf(tree);
  assert.ok(bar, 'bar rendered by default');
  assert.equal(styleOf(bar).height, 64);
  assert.equal(styleOf(bar).bottom, 42);
  const tabs = all(bar, (n) => n.type === 'Pressable');
  assert.equal(tabs.length, 5);
  for (const tab of tabs) assert.ok(styleOf(tab).minWidth >= 44 && styleOf(tab).minHeight >= 44);
  assert.equal(styleOf(slotOf(tree)).paddingBottom, 34 + 8 + 64 + 8);
});

test('web: Home hide removes the bar entirely (no tap area, focus stop or a11y node) and keeps the safe area', () => {
  const web = shell('src/components/app-tabs.web.tsx');
  web.render();
  web.mod.setHomeTabBarHidden(true);
  const tree = web.render();
  assert.equal(barOf(tree), undefined, 'bar not rendered');
  assert.equal(all(tree, (n) => n.type === 'Pressable' || n.type === 'Link').length, 0, 'no hidden tab controls remain');
  assert.equal(styleOf(slotOf(tree)).paddingBottom, 34, 'content keeps max(inset, 34) at the bottom');
  web.mod.setHomeTabBarHidden(false);
  assert.ok(barOf(web.render()), 'scroll up brings the same bar back');
});

test('web: a hidden request never leaks to other tabs or screens', () => {
  const web = shell('src/components/app-tabs.web.tsx');
  web.render();
  web.mod.setHomeTabBarHidden(true);
  for (const other of ['/explore', '/notifications', '/profile', '/u/someone', '/feed']) {
    web.at(other);
    const tree = web.render();
    assert.ok(barOf(tree), `bar shown on ${other}`);
    assert.equal(styleOf(slotOf(tree)).paddingBottom, 114);
  }
  web.at('/');
  assert.equal(barOf(web.render()), undefined);
});

// ---- Native tabs ---------------------------------------------------------------------------
test('native: NativeTabs root `hidden` follows the Home request and the Home route only', () => {
  const NativeTabs = (props) => ({ type: 'NativeTabs', props });
  for (const key of ['Trigger']) NativeTabs[key] = Object.assign(() => null, { Label: () => null, Icon: () => null, Badge: () => null });
  const native = shell('src/components/app-tabs.tsx', { 'expo-router/unstable-native-tabs': { NativeTabs } });
  const hiddenOf = () => native.render().props.hidden;
  native.render();
  assert.equal(hiddenOf(), false);
  native.mod.setHomeTabBarHidden(true);
  assert.equal(hiddenOf(), true);
  native.at('/explore');
  assert.equal(hiddenOf(), false, 'other tabs keep the OS bar');
  native.at('/');
  native.mod.setHomeTabBarHidden(false);
  assert.equal(hiddenOf(), false);
});

console.log(`Home tab bar scroll checks passed: ${passed}. Logic and tab shells only; real scrolling, animation and screen readers need a browser/device.`);
