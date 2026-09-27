// Deterministic component-style checks, not a browser/React renderer test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const tokens = require('./design-tokens.cjs');
const { OnePick } = tokens;
const root = path.resolve(__dirname, '..');
const jsx = (type, props) => ({ type, props: props ?? {} });
const flattenStyle = (style) => Array.isArray(style) ? Object.assign({}, ...style.map(flattenStyle)) : style ?? {};
const native = { ActivityIndicator: 'Spinner', Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (styles) => styles, flatten: flattenStyle } };
let pathname = '/';
let navigated = null;
const auth = { user: { id: 'owner' }, isLoading: false, error: null };
const unread = { data: 0 };
const countCalls = [];
const mocks = {
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useNotifications': { useNotificationCount: (userId, enabled) => { countCalls.push({userId, enabled}); return unread; } },
  react: { useState: (initial) => [initial, () => {}] },
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': native,
  '@/constants/onepick': tokens,
  'expo-router': { Tabs: { Screen: 'Screen' }, Link: 'Link', Slot: 'Slot', usePathname: () => pathname, useRouter: () => ({ push: (href) => { navigated = href; } }) },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 20 }) },
  'expo-image': { Image: 'Image' },
  '../../public/brand/onepick-logo-horizontal.svg': 'logo-light.svg',
  '../../public/brand/onepick-logo-horizontal-white.svg': 'logo-dark.svg',
};
function load(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const result = ts.transpileModule(source, {
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
const { Button } = load('src/components/ui/button.tsx');
const { Chip } = load('src/components/ui/chip.tsx');
const AppTabs = load('src/components/app-tabs.web.tsx').default;
const NativeAppTabs = load('src/components/onepick-tabs.tsx').default;
const { OnePickBrand } = load('src/components/onepick-brand.tsx');
const flat = (style) => Array.isArray(style) ? style.flatMap(flat) : style ? [style] : [];
const styleOf = (node, pressed = false) => Object.assign({}, ...flat(typeof node.props.style === 'function' ? node.props.style({ pressed }) : node.props.style));
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
const first = (node, type) => all(node, (n) => n.type === type)[0];
const rgb = (hex) => {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
};
const luminance = (color) => color.reduce((sum, channel, index) => sum + [0.2126, 0.7152, 0.0722][index] * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4), 0);
const composite = (color, background, opacity) => color.map((channel, i) => opacity * channel + (1 - opacity) * background[i]);
function contrast(foreground, background, opacity = 1, canvas = OnePick.surface) {
  const backdrop = rgb(canvas);
  const light = [foreground, background].map((color) => luminance(composite(rgb(color), backdrop, opacity))).sort((a, b) => b - a);
  return (light[0] + 0.05) / (light[1] + 0.05);
}
const readable = (fg, bg, opacity = 1) => {
  for (const canvas of [OnePick.surface, OnePick.background]) {
    assert.ok(contrast(fg, bg, opacity, canvas) >= 4.5, `${fg} on ${bg}, opacity ${opacity}, canvas ${canvas}: text contrast >= 4.5`);
  }
};
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}
test('primary uses approved tangerine + ink, not legacy accent', () => {
  const button = Button({ label: '선택' });
  assert.equal(styleOf(button).backgroundColor, OnePick.brand);
  assert.equal(styleOf(first(button, 'Text')).color, OnePick.onBrand);
  readable(styleOf(first(button, 'Text')).color, styleOf(button).backgroundColor);
});
test('pressed primary retains readable text', () => {
  const button = Button({ label: '선택' });
  readable(styleOf(first(button, 'Text')).color, styleOf(button, true).backgroundColor, styleOf(button, true).opacity ?? 1);
});
test('loading primary has ink spinner and disabled/busy semantics', () => {
  const button = Button({ label: '선택', loading: true });
  assert.equal(first(button, 'Spinner').props.color, OnePick.onBrand);
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.accessibilityState.busy, true);
  assert.equal(button.props.accessibilityState.disabled, true);
  assert.equal(first(button, 'Text'), undefined);
});
test('secondary, soft and ghost labels remain readable off brand fills', () => {
  for (const variant of ['secondary', 'soft', 'ghost']) {
    const button = Button({ label: '보기', variant });
    const background = styleOf(button).backgroundColor;
    const canvas = background === 'transparent' ? OnePick.surface : background;
    const foreground = styleOf(first(button, 'Text')).color;
    assert.notEqual(foreground, OnePick.brand);
    readable(foreground, canvas);
    readable(foreground, canvas, styleOf(button, true).opacity ?? 1);
  }
});
test('danger loading spinner preserves semantic color', () => {
  const button = Button({ label: '삭제', variant: 'danger', loading: true });
  assert.equal(first(button, 'Spinner').props.color, OnePick.danger);
});
test('button dimensions, callback, overrides and labels are preserved', () => {
  let pressed = 0;
  for (const [size, height] of [['sm', 40], ['md', 48], ['lg', 52]]) {
    const button = Button({ label: '공유', size, fullWidth: true, onPress: () => { pressed++; } });
    assert.equal(styleOf(button).minHeight, height);
    assert.equal(styleOf(button).alignSelf, 'stretch');
    button.props.onPress();
  }
  assert.equal(pressed, 3);
  const override = Button({ label: '공유', accessibilityLabel: '원픽 공유', disabled: true, style: { marginTop: 4 } });
  assert.equal(styleOf(override).marginTop, 4);
  assert.equal(override.props.accessibilityLabel, '원픽 공유');
  assert.equal(override.props.accessibilityRole, 'button');
  assert.equal(override.props.disabled, true);
});
test('selected chip uses warm fill, ink label and readable outline', () => {
  const chip = Chip({ label: '책', selected: true });
  assert.equal(OnePick.accentSoft, '#FFF0DC');
  assert.equal(styleOf(chip).backgroundColor, OnePick.accentSoft);
  assert.equal(styleOf(first(chip, 'Text')).color, OnePick.text);
  assert.equal(chip.props.accessibilityState.selected, true);
  readable(styleOf(first(chip, 'Text')).color, styleOf(chip).backgroundColor);
  assert.ok(contrast(styleOf(chip).borderColor, OnePick.surface) >= 3);
});
test('pressed chip keeps readable selected and unselected text', () => {
  for (const selected of [true, false]) {
    const chip = Chip({ label: '책', selected });
    readable(styleOf(first(chip, 'Text')).color, styleOf(chip, true).backgroundColor, styleOf(chip, true).opacity ?? 1);
  }
});
test('unselected/dashed chip appearance and callback stay available', () => {
  let pressed = 0;
  const chip = Chip({ label: '책', dashed: true, onPress: () => { pressed++; } });
  assert.equal(styleOf(chip).backgroundColor, OnePick.surface);
  assert.equal(styleOf(chip).borderStyle, 'dashed');
  assert.equal(chip.props.accessibilityState.selected, false);
  chip.props.onPress(); assert.equal(pressed, 1);
});
test('Figma navigation preserves URL-backed links, selected state and touch sizes', () => {
  for (const [url, label] of [['/', '홈'], ['/explore', '탐색'], ['/notifications', '알림'], ['/profile', '프로필']]) {
    pathname = url;
    const tree = expand(AppTabs());
    const active = all(tree, (n) => n.props.accessibilityState?.selected);
    assert.equal(active.length, 1);
    assert.equal(active[0].props.accessibilityLabel, label);
    assert.deepEqual(all(tree, (n) => n.type === 'Link').map((n) => n.props.href), ['/', '/explore', '/notifications', '/profile']);
    for (const tab of all(tree, n => n.props.accessibilityRole === 'tab')) {
      assert.equal(typeof tab.props.style, 'object', 'Link asChild requires a concrete style');
      assert.equal(Array.isArray(tab.props.style), false);
      assert.equal(styleOf(tab).minHeight, 64);
      readable(styleOf(first(tab, 'Text')).color, '#ffffff');
    }
  }
});
test('central registration is a black circular action and never selects a tab', () => {
  const tree = expand(AppTabs());
  const button = all(tree, n => n.props.accessibilityLabel === '원픽 등록')[0];
  assert.equal(button.props.accessibilityRole, 'button');
  const icon = styleOf(first(button, 'View'));
  assert.equal(icon.width, 48); assert.equal(icon.height, 48); assert.equal(icon.borderRadius, 24);
  assert.equal(icon.backgroundColor, '#141416');
  readable(styleOf(first(button, 'Text')).color, icon.backgroundColor);
  button.props.onPress(); assert.equal(navigated, '/pick/new');
});
test('unread dot has no number, survives a transient count error and hides on logout', () => {
  const dot = tree => all(tree, n => n.props.testID === 'notification-unread-dot');
  unread.data = 42;
  let tree = expand(AppTabs());
  assert.equal(dot(tree).length, 1);
  assert.equal(all(tree, n => n.type === 'Text' && /42/.test(String(n.props.children))).length, 0);
  assert.ok(all(tree, n => n.props.accessibilityLabel === '알림, 읽지 않은 알림 있음').length);
  unread.isError = true; assert.equal(dot(expand(AppTabs())).length, 1);
  auth.user = null; assert.equal(dot(expand(AppTabs())).length, 0);
  assert.equal(countCalls.at(-1).enabled, false);
  auth.user = { id: 'owner' }; auth.error = new Error('session');
  assert.equal(dot(expand(AppTabs())).length, 0);
  auth.error = null; unread.data = 0; unread.isError = false;
  assert.equal(dot(expand(AppTabs())).length, 0);
});
test('native tab events can cancel navigation; registration always opens the stack', () => {
  const routes = ['index', 'explore', 'register', 'notifications', 'profile'].map(name => ({ name, key: `${name}-key` }));
  let prevented = false;
  const events = [], changes = [];
  const nativeTree = () => expand(NativeAppTabs().props.tabBar({
    state: { index: 0, routes },
    navigation: {
      emit: event => { events.push(event); return { defaultPrevented: prevented }; },
      navigate: (...args) => changes.push(args),
    },
  }));
  const action = label => all(nativeTree(), n => n.props.accessibilityLabel === label)[0];
  action('홈').props.onPress(); assert.equal(changes.length, 0);
  prevented = true; action('알림').props.onPress(); assert.equal(changes.length, 0);
  prevented = false; action('알림').props.onPress(); assert.equal(changes.at(-1)[0], 'notifications');
  assert.equal(events.at(-1).type, 'tabPress');
  action('프로필').props.onLongPress(); assert.equal(events.at(-1).type, 'tabLongPress');
  action('원픽 등록').props.onPress(); assert.equal(navigated, '/pick/new');
});
test('brand home link passes one style object through Link asChild', () => {
  // expo-router's Slot merges the child style with `{ ...style }`: an array
  // throws in the web DOM (blank home/login) and a function is silently dropped.
  for (const [props, height, source] of [[{}, 28, 'logo-light.svg'], [{ compact: true, appearance: 'dark' }, 24, 'logo-dark.svg']]) {
    const link = OnePickBrand(props);
    assert.equal(link.type, 'Link');
    assert.equal(link.props.href, '/');
    assert.equal(link.props.asChild, true);
    const pressable = link.props.children;
    assert.equal(pressable.type, 'Pressable');
    const { style } = pressable.props;
    assert.ok(style && typeof style === 'object' && !Array.isArray(style), 'Slot child style must be a plain object');
    assert.ok(style.padding >= height * 508 / 931, 'clear space at least the dot diameter');
    assert.equal(style.alignSelf, 'flex-start');
    assert.equal(pressable.props.accessibilityRole, 'link');
    assert.equal(pressable.props.accessibilityLabel, '원픽 홈');
    const image = first(pressable, 'Image');
    assert.equal(image.props.source, source);
    assert.equal(image.props.style.height, height);
  }
});
console.log(`Brand control checks: ${passed}/${passed + failures.length} passed.`);
process.exitCode = failures.length ? 1 : 0;
