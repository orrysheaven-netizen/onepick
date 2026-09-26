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
const mocks = {
  react: { useState: (initial) => [initial, () => {}] },
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': native,
  '@/constants/onepick': tokens,
  'expo-router': { Link: 'Link', Slot: 'Slot', usePathname: () => pathname, useRouter: () => ({ push: (href) => { navigated = href; } }) },
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
test('web active tab uses ink icon on tangerine and an ink label', () => {
  pathname = '/explore';
  const tree = expand(AppTabs());
  const tab = all(tree, (n) => n.type === 'Pressable' && n.props.accessibilityLabel === '탐색')[0];
  assert.equal(tab.props.accessibilityState.selected, true);
  const background = styleOf(first(tab, 'View')).backgroundColor;
  const iconColor = first(tab, 'svg').props.stroke;
  assert.equal(background, OnePick.brand);
  assert.equal(iconColor, OnePick.onBrand);
  readable(iconColor, background, styleOf(tab, true).opacity ?? 1);
  readable(styleOf(first(tab, 'Text')).color, OnePick.surface);
});
test('web register control uses ink on tangerine and preserves route', () => {
  const tree = expand(AppTabs());
  const button = all(tree, (n) => n.type === 'Pressable' && n.props.accessibilityLabel === '원픽 등록')[0];
  const icon = first(button, 'View');
  assert.equal(styleOf(icon).backgroundColor, OnePick.brand);
  assert.equal(styleOf(first(icon, 'Text')).color, OnePick.onBrand);
  readable(styleOf(first(icon, 'Text')).color, styleOf(icon).backgroundColor, styleOf(button, true).opacity ?? 1);
  button.props.onPress(); assert.equal(navigated, '/pick/find');
});
test('web Link tabs pass one layout style object through Link asChild', () => {
  pathname = '/';
  const tree = expand(AppTabs());
  for (const label of ['홈', '탐색', '내 프로필']) {
    const tab = all(tree, (n) => n.type === 'Pressable' && n.props.accessibilityLabel === label)[0];
    assert.ok(tab, label);
    assert.ok(tab.props.style && typeof tab.props.style === 'object' && !Array.isArray(tab.props.style), 'Link tab style must be a plain object');
    assert.equal(tab.props.style.flex, 1);
    assert.equal(tab.props.style.minHeight, 56);
    assert.equal(tab.props.style.alignItems, 'center');
    assert.equal(tab.props.style.justifyContent, 'center');
    assert.equal(typeof tab.props.onPressIn, 'function');
    assert.equal(typeof tab.props.onPressOut, 'function');
  }
});
test('web tab routes and nested selection remain unchanged', () => {
  for (const [url, selected] of [['/', '홈'], ['/explore', '탐색'], ['/comments', '내 댓글'], ['/profile/edit', '내 프로필']]) {
    pathname = url;
    const tree = expand(AppTabs());
    const active = all(tree, (n) => n.type === 'Pressable' && n.props.accessibilityState?.selected);
    assert.equal(active.length, 1);
    assert.equal(active[0].props.accessibilityLabel, selected);
    assert.deepEqual(all(tree, (n) => n.type === 'Link').map((n) => n.props.href), ['/', '/explore', '/comments', '/profile']);
  }
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
