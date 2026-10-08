// Deterministic component-style checks, not a browser/React renderer test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const tokens = require('./design-tokens.cjs');
const { OnePick, OnePickLayout } = tokens;
const root = path.resolve(__dirname, '..');
const jsx = (type, props) => ({ type, props: props ?? {} });
const flattenStyle = (style) => Array.isArray(style) ? Object.assign({}, ...style.map(flattenStyle)) : style ?? {};
const native = { ActivityIndicator: 'Spinner', Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (styles) => styles, flatten: flattenStyle } };
let pathname = '/';
let navigated = null;
let bottomInset = 20;
const mocks = {
  react: { useState: (initial) => [initial, () => {}] },
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  'react-native': native,
  '@/constants/onepick': tokens,
  '@/hooks/useAuthSession': { useAuthSession: () => ({ user: null, isLoading: false, error: null }) },
  '@/hooks/useNotifications': { useNotificationCount: () => ({ data: 0, isError: false }) },
  'expo-router': { Link: 'Link', Slot: 'Slot', usePathname: () => pathname, useRouter: () => ({ push: (href) => { navigated = href; } }) },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: bottomInset }) },
  'expo-image': { Image: 'Image' },
  '../../public/brand/onepick-wordmark.svg': 'logo-light.svg',
  '../../public/brand/onepick-wordmark-white.svg': 'logo-dark.svg',
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
mocks['./touch'] = load('src/components/ui/touch.ts');
mocks['./icon-paths'] = load('src/components/ui/icon-paths.ts');
mocks['@/components/ui/icon'] = load('src/components/ui/icon.web.tsx');
const { Button } = load('src/components/ui/button.tsx');
const { Chip } = load('src/components/ui/chip.tsx');
const { Avatar } = load('src/components/ui/avatar.tsx');
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
test('primary uses approved ink action + white on-action text', () => {
  const button = Button({ label: '선택' });
  assert.equal(styleOf(first(button, 'View')).backgroundColor, OnePick.actionPrimary);
  assert.equal(styleOf(first(button, 'Text')).color, OnePick.onAction);
  readable(styleOf(first(button, 'Text')).color, styleOf(first(button, 'View')).backgroundColor);
});
test('pressed primary retains readable text', () => {
  const button = Button({ label: '선택' });
  readable(styleOf(first(button, 'Text')).color, styleOf(first(button, 'View')).backgroundColor, styleOf(button, true).opacity ?? 1);
});
test('loading primary has on-action spinner and disabled/busy semantics', () => {
  const button = Button({ label: '선택', loading: true });
  assert.equal(first(button, 'Spinner').props.color, OnePick.onAction);
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.accessibilityState.busy, true);
  assert.equal(button.props.accessibilityState.disabled, true);
  assert.equal(first(button, 'Text'), undefined);
});
test('secondary, soft, ghost and dangerText labels remain readable off brand fills', () => {
  for (const variant of ['secondary', 'soft', 'ghost', 'dangerText']) {
    const button = Button({ label: '보기', variant });
    const background = styleOf(first(button, 'View')).backgroundColor;
    const canvas = background === 'transparent' ? OnePick.surface : background;
    const foreground = styleOf(first(button, 'Text')).color;
    assert.notEqual(foreground, OnePick.brand);
    readable(foreground, canvas);
    readable(foreground, canvas, styleOf(button, true).opacity ?? 1);
  }
});
test('danger uses semantic fill, white label and white loading spinner', () => {
  const button = Button({ label: '삭제', variant: 'danger' });
  assert.equal(styleOf(first(button, 'View')).backgroundColor, OnePick.danger);
  assert.equal(styleOf(first(button, 'Text')).color, OnePick.onAction);
  readable(styleOf(first(button, 'Text')).color, styleOf(first(button, 'View')).backgroundColor);
  const loading = Button({ label: '삭제', variant: 'danger', loading: true });
  assert.equal(first(loading, 'Spinner').props.color, OnePick.onAction);
  assert.equal(styleOf(first(loading, 'View')).backgroundColor, OnePick.actionDisabled);
  assert.equal(styleOf(loading).opacity, 1);
});
test('button dimensions, callback, overrides and labels are preserved', () => {
  let pressed = 0;
  for (const [size, height] of [['sm', 40], ['md', 52], ['lg', 52]]) {
    const button = Button({ label: '공유', size, fullWidth: true, onPress: () => { pressed++; } });
    assert.equal(styleOf(first(button, 'View')).minHeight, height);
    assert.ok(styleOf(button).minWidth >= 44 && styleOf(button).minHeight >= 44, 'wrapper is a 44x44 touch area');
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
test('interactive avatar has a real 44x44 touch wrapper', () => {
  const avatar = Avatar({ name: 'duck', size: 24, onPress: () => {} });
  assert.equal(avatar.type, 'Pressable');
  assert.ok(styleOf(avatar).minWidth >= 44 && styleOf(avatar).minHeight >= 44);
  assert.equal(styleOf(avatar).marginHorizontal, -10);
  assert.equal(styleOf(avatar).marginVertical, -10);
  const circle = first(avatar, 'View');
  assert.equal(styleOf(circle).width, 24);
  assert.equal(styleOf(circle).height, 24);
});

test('selected chip uses Foundations ink fill and on-action label', () => {
  const chip = Chip({ label: '책', selected: true });
  assert.equal(styleOf(first(chip, 'View')).minHeight, 32);
  assert.equal(styleOf(first(chip, 'View')).backgroundColor, OnePick.actionPrimary);
  assert.equal(styleOf(first(chip, 'Text')).color, OnePick.onAction);
  assert.equal(chip.props.accessibilityState.selected, true);
  readable(styleOf(first(chip, 'Text')).color, styleOf(first(chip, 'View')).backgroundColor);
});
test('pressed chip keeps readable selected and unselected text', () => {
  for (const selected of [true, false]) {
    const chip = Chip({ label: '책', selected });
    readable(styleOf(first(chip, 'Text')).color, styleOf(first(chip, 'View')).backgroundColor, styleOf(chip, true).opacity ?? 1);
  }
});
test('unselected/dashed chip appearance and callback stay available', () => {
  let pressed = 0;
  const chip = Chip({ label: '책', dashed: true, onPress: () => { pressed++; } });
  assert.equal(styleOf(first(chip, 'View')).backgroundColor, OnePick.bgDefault);
  assert.equal(styleOf(first(chip, 'View')).borderColor, OnePick.borderDefault);
  assert.equal(styleOf(first(chip, 'View')).borderStyle, 'dashed');
  assert.equal(chip.props.accessibilityState.selected, false);
  chip.props.onPress(); assert.equal(pressed, 1);
});
test('web inactive tab separates tertiary icon from readable secondary label', () => {
  pathname = '/';
  const tree = expand(AppTabs());
  const tab = all(tree, (n) => n.type === 'Pressable' && n.props.accessibilityLabel === '탐색')[0];
  assert.equal(first(tab, 'svg').props.stroke, OnePick.textTertiary);
  assert.equal(styleOf(first(tab, 'Text')).color, OnePick.textSecondary);
  readable(styleOf(first(tab, 'Text')).color, OnePick.surface);
});

test('screen canvas is white and floating tab bar matches the approved Figma geometry', () => {
  assert.equal(OnePick.background, '#FFFFFF');
  assert.equal(OnePick.background, OnePick.bgDefault);
  assert.equal(OnePickLayout.safeAreaBottom, 34);
  assert.equal(OnePickLayout.tabBarHeight, 64);
  assert.equal(OnePickLayout.tabBarHorizontalGutter, 16);
  assert.equal(OnePickLayout.tabBarRadius, 24);
  assert.equal(OnePickLayout.tabBarSafeAreaGap, 8);
  assert.equal(OnePickLayout.tabBarContentGap, 8);
  pathname = '/';
  const tree = expand(AppTabs());
  const bar = all(tree, (n) => n.type === 'View' && styleOf(n).position === 'absolute' && styleOf(n).flexDirection === 'row')[0];
  const style = styleOf(bar);
  assert.equal(style.backgroundColor, OnePick.bgDefault);
  assert.equal(style.left, 16);
  assert.equal(style.right, 16);
  assert.equal(style.height, 64);
  assert.equal(style.borderRadius, 24);
  assert.equal(style.bottom, 42);
  const tabs = all(bar, (n) => n.type === 'Pressable');
  assert.equal(tabs.length, 5);
  for (const tab of tabs) {
    assert.ok(styleOf(tab).minWidth >= 44);
    assert.ok(styleOf(tab).minHeight >= 44);
  }
});

test('web floating tab bar preserves larger device insets and content clearance', () => {
  try {
    for (const inset of [0, 20, 34, 59]) {
      bottomInset = inset;
      const tree = expand(AppTabs());
      const safeBottom = Math.max(inset, OnePickLayout.safeAreaBottom);
      const bar = all(tree, (n) => n.type === 'View' && styleOf(n).position === 'absolute' && styleOf(n).flexDirection === 'row')[0];
      assert.equal(styleOf(bar).bottom, safeBottom + OnePickLayout.tabBarSafeAreaGap);
      const slots = all(tree, (n) => n.type === 'View' && styleOf(n).flex === 1 && styleOf(n).minHeight === 0);
      const slot = slots.find((n) => styleOf(n).paddingBottom !== undefined);
      assert.ok(slot);
      assert.equal(styleOf(slot).paddingBottom, safeBottom + OnePickLayout.tabBarSafeAreaGap + OnePickLayout.tabBarHeight + OnePickLayout.tabBarContentGap);
    }
  } finally {
    bottomInset = 20;
  }
});

test('web active tab uses ink icon and label without a brand fill', () => {
  pathname = '/explore';
  const tree = expand(AppTabs());
  const tab = all(tree, (n) => n.type === 'Pressable' && n.props.accessibilityLabel === '탐색')[0];
  assert.equal(tab.props.accessibilityState.selected, true);
  const iconColor = first(tab, 'svg').props.stroke;
  assert.equal(iconColor, OnePick.actionPrimary);
  assert.equal(styleOf(first(tab, 'Text')).color, OnePick.actionPrimary);
  readable(iconColor, OnePick.surface, styleOf(tab, true).opacity ?? 1);
  readable(styleOf(first(tab, 'Text')).color, OnePick.surface);
});
test('web register control matches Figma Add Button 287:261 and preserves route', () => {
  const tree = expand(AppTabs());
  const button = all(tree, (n) => n.type === 'Pressable' && n.props.accessibilityLabel === '원픽 등록')[0];
  const svg = first(button, 'svg');
  assert.equal(Number(svg.props.width), 32, 'Figma: 32px circle');
  assert.equal(svg.props.stroke, OnePick.actionPrimary);
  const circle = first(svg, 'circle');
  assert.equal(circle.props.fill, OnePick.bgDefault);
  assert.equal(String(circle.props.strokeWidth), '1.5', 'Figma: 1.5 border');
  assert.ok(first(svg, 'path'), 'plus is drawn as a path, not a text glyph');
  readable(svg.props.stroke, circle.props.fill, styleOf(button, true).opacity ?? 1);
  assert.equal(styleOf(first(button, 'Text')).color, OnePick.textPrimary, 'Figma: the register label is text/primary');
  button.props.onPress(); assert.equal(navigated, '/pick/new');
});
test('web active fill is reserved for Home; other active tabs stay outlined', () => {
  for (const [path, activeLabel] of [['/', '홈'], ['/explore', '탐색'], ['/notifications', '알림'], ['/profile', '프로필']]) {
    pathname = path;
    const tree = expand(AppTabs());
    for (const label of ['홈', '탐색', '알림', '프로필']) {
      const tab = all(tree, (n) => n.type === 'Pressable' && n.props.accessibilityLabel === label)[0];
      const fills = all(first(tab, 'svg'), (n) => n.props && n.props.fill !== undefined).map((n) => n.props.fill);
      if (label === '홈' && activeLabel === '홈') assert.ok(fills.includes(OnePick.actionPrimary), 'Home is filled when active');
      else assert.ok(!fills.includes(OnePick.actionPrimary), `${label} does not use an active fill`);
    }
  }
});
test('web Link tabs pass one layout style object through Link asChild', () => {
  pathname = '/';
  const tree = expand(AppTabs());
  for (const label of ['홈', '탐색', '알림', '프로필']) {
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
  for (const [url, selected] of [['/', '홈'], ['/explore', '탐색'], ['/notifications', '알림'], ['/profile/edit', '프로필']]) {
    pathname = url;
    const tree = expand(AppTabs());
    const active = all(tree, (n) => n.type === 'Pressable' && n.props.accessibilityState?.selected);
    assert.equal(active.length, 1);
    assert.equal(active[0].props.accessibilityLabel, selected);
    assert.deepEqual(all(tree, (n) => n.type === 'Link').map((n) => n.props.href), ['/', '/explore', '/notifications', '/profile']);
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
    assert.equal(image.props.alt, 'onepick', 'Screens show the English wordmark only (no Korean 원픽 beside it)');
  }
});
console.log(`Brand control checks: ${passed}/${passed + failures.length} passed.`);
process.exitCode = failures.length ? 1 : 0;
