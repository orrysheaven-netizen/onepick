const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, URL, ...globals,
    require: (name) => {
      if (name === '@/constants/onepick') return require('./design-tokens.cjs');
      if (name in imports) return imports[name];
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      assert.fail('Unexpected dependency: ' + name);
    },
  });
  return exports;
}

const component = (tag) => ({ children }) => React.createElement(tag, null, children);
let pressables = [];
let opened = [];
let platform = 'web';
const fakeWindow = { open: (...args) => opened.push(['web', ...args]) };
const native = {
  Text: component('span'),
  View: component('div'),
  ActivityIndicator: () => null,
  Pressable: (props) => { pressables.push(props); return React.createElement('button', null, props.children); },
  StyleSheet: { create: (styles) => styles },
  get Platform() { return { OS: platform }; },
  Linking: { openURL: async (url) => { opened.push(['native', url]); } },
};
const pickPhoto = { PickPhoto: () => null };
const ui = require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': pickPhoto });
const { purchaseHost } = load('lib/format/purchaseHost.ts');
const { HomeFeedCard } = load('components/home-feed-card.tsx', {
  '@/components/ui': ui,
  'react-native': native,
  '@/lib/format/relativeTime': load('lib/format/relativeTime.ts'),
  '@/lib/format/purchaseHost': { purchaseHost },
}, { window: fakeWindow });

const basePick = {
  pickId: 'p1',
  userId: 'u1',
  username: 'tester',
  profileImageUrl: null,
  itemId: 'i1',
  name: '신라면',
  categoryId: 'c1',
  categoryName: '라면',
  oneLineReview: '결국 이걸로 돌아온다',
  thumbnailUrl: null,
  purchaseUrl: null,
  purchaseTip: null,
  startedAt: '2026-09-22T00:00:00.000000+00:00',
};

function render(overrides = {}) {
  pressables = [];
  opened = [];
  platform = 'web';
  const noop = () => {};
  return renderToStaticMarkup(React.createElement(HomeFeedCard, {
    pick: { ...basePick, ...overrides },
    onOpenItem: noop,
    onOpenProfile: noop,
    onOpenPick: noop,
    onChooseSame: noop,
    onChooseOther: noop,
  }));
}

function purchaseLink() {
  return pressables.find((entry) => typeof entry.accessibilityLabel === 'string' && entry.accessibilityLabel.includes('산 곳'));
}

assert.equal(purchaseHost('https://www.coupang.com/vp/products/1?itemId=5'), 'coupang.com');
assert.equal(purchaseHost('https://SmartStore.Naver.com/shop/1'), 'smartstore.naver.com');
assert.equal(purchaseHost('https://user:pass@coupang.com/item'), null, 'userinfo never becomes a trusted-looking host');
assert.equal(purchaseHost('http://coupang.com/item'), null);
assert.equal(purchaseHost('javascript:alert(1)'), null);
assert.equal(purchaseHost('   '), null);

let html = render();
assert.doesNotMatch(html, /쇼핑꿀팁/);
assert.equal(purchaseLink(), undefined);

html = render({ purchaseUrl: 'https://www.coupang.com/vp/products/1' });
assert.doesNotMatch(html, /쇼핑꿀팁/, 'A link alone is not labeled as a shopping tip');
assert.match(html, /coupang\.com/);
assert.doesNotMatch(html, /vp\/products/);

html = render({ purchaseUrl: 'https://ssg.com/item/1', purchaseTip: '새벽배송이 빨라요' });
assert.match(html, /쇼핑꿀팁/);
assert.match(html, /새벽배송이 빨라요/);
assert.match(html, /결국 이걸로 돌아온다/);

render({ purchaseUrl: 'https://www.coupang.com/vp/products/1', purchaseTip: '6개입이 싸요' });
let link = purchaseLink();
assert.ok(link);
assert.equal(link.accessibilityRole, 'link');
link.onPress();
assert.deepEqual(opened, [['web', 'https://www.coupang.com/vp/products/1', '_blank', 'noopener,noreferrer']]);

render({ purchaseUrl: 'https://ssg.com/item/1' });
platform = 'ios';
link = purchaseLink();
link.onPress();
setImmediate(() => {
  assert.deepEqual(opened, [['native', 'https://ssg.com/item/1']]);
  console.log('Purchase card checks passed.');
});
