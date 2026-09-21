// 카드에 실린 구매처와 쇼핑꿀팁. docs/pick-purchase-link.md 참조.
//
// 팁이 있어야 쇼핑꿀팁이다. 링크만 있으면 어디서 샀는지만 보이고, 어느 경우든
// 주소 전체가 아니라 호스트만 보여 어디로 가는지 먼저 읽히게 한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// The module runs in its own vm context, so `window` has to be put there
// rather than on Node's global for the web branch to be reachable at all.
const fakeWindow = { open: (...args) => { opened.push(['web', ...args]); } };
function load(file, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, ...globals, require: (name) => {
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name in imports) return imports[name];
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    assert.fail(`Unexpected dependency: ${name}`);
  } });
  return exports;
}
const component = (tag) => ({ children }) => React.createElement(tag, null, children);
let pressables, opened, platform;
const native = {
  Text: component('span'), View: component('div'), ActivityIndicator: () => null,
  Pressable: (props) => { pressables.push(props); return React.createElement('button', null, props.children); },
  StyleSheet: { create: (styles) => styles },
  get Platform() { return { OS: platform }; },
  Linking: { openURL: async (url) => { opened.push(['native', url]); } },
};
const pickPhoto = { PickPhoto: () => null };
const ui = require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': pickPhoto });
const { purchaseHost } = load('lib/format/purchaseHost.ts');
const { HomeFeedCard } = load('components/home-feed-card.tsx', {
  '@/components/ui': ui, 'react-native': native,
  '@/lib/format/relativeTime': load('lib/format/relativeTime.ts'),
  '@/lib/format/purchaseHost': { purchaseHost },
}, { window: fakeWindow });

const basePick = {
  pickId: 'p1', userId: 'u1', username: 'tester', profileImageUrl: null,
  itemId: 'i1', name: '신라면', categoryId: 'c1', categoryName: '라면',
  oneLineReview: '결국 이걸로 돌아온다', thumbnailUrl: null,
  purchaseUrl: null, purchaseTip: null, startedAt: new Date().toISOString(),
};
function render(pick) {
  pressables = []; opened = []; platform = 'web';
  const noop = () => {};
  return renderToStaticMarkup(React.createElement(HomeFeedCard, {
    pick: { ...basePick, ...pick }, onOpenItem: noop, onOpenProfile: noop,
    onOpenPick: noop, onChooseSame: noop, onChooseOther: noop,
  }));
}
const linkButton = () => pressables.find((p) => typeof p.accessibilityLabel === 'string' && p.accessibilityLabel.includes('산 곳'));

function checkHostFormatting() {
  assert.equal(purchaseHost('https://www.coupang.com/vp/products/1?itemId=5'), 'coupang.com', 'www.와 경로는 떼고 호스트만 남긴다');
  assert.equal(purchaseHost('https://SmartStore.Naver.com/shop/1'), 'smartstore.naver.com', '호스트는 소문자로 맞춘다');
  assert.equal(purchaseHost('https://ssg.com:443/item/1'), 'ssg.com', '포트는 읽는 사람에게 의미가 없다');
  assert.equal(purchaseHost(null), null);
  assert.equal(purchaseHost('   '), null);
  // 저장된 링크는 DB가 이미 https로 맞춘다. 그 밖의 값은 추측하지 않고 아무것도 보여주지 않는다.
  assert.equal(purchaseHost('http://coupang.com/x'), null, 'https가 아니면 아무것도 보여주지 않는다');
  assert.equal(purchaseHost('javascript:alert(1)'), null);
}

function checkCardStates() {
  const plain = render({});
  assert.doesNotMatch(plain, /쇼핑꿀팁/, '링크가 없으면 쇼핑꿀팁 배지도 호스트도 없다');
  assert.equal(linkButton(), undefined);

  const linkOnly = render({ purchaseUrl: 'https://www.coupang.com/vp/products/1' });
  assert.doesNotMatch(linkOnly, /쇼핑꿀팁/, '링크만 있으면 쇼핑꿀팁이 아니다');
  assert.match(linkOnly, /coupang\.com/, '어디서 샀는지는 보여준다');
  assert.doesNotMatch(linkOnly, /vp\/products/, '주소 전체는 카드에 싣지 않는다');

  const withTip = render({ purchaseUrl: 'https://ssg.com/item/1', purchaseTip: '새벽배송이 빨라요' });
  assert.match(withTip, /쇼핑꿀팁/, '팁이 있으면 쇼핑꿀팁으로 표시한다');
  assert.match(withTip, /새벽배송이 빨라요/, '팁 내용이 카드에 실린다');
  assert.match(withTip, /ssg\.com/);
  assert.match(withTip, /결국 이걸로 돌아온다/, '한줄평은 그대로 카드의 중심이다');
}

function checkOpening() {
  render({ purchaseUrl: 'https://www.coupang.com/vp/products/1', purchaseTip: '6개입이 싸요' });
  const link = linkButton();
  assert.ok(link, '호스트는 누를 수 있다');
  assert.equal(link.accessibilityRole, 'link');
  assert.match(link.accessibilityLabel, /coupang\.com/, '어디로 가는지 레이블에서도 알 수 있다');

  // 웹에서는 새 탭으로 열되 참조자 정보를 넘기지 않는다.
  link.onPress();
  assert.deepEqual(opened, [['web', 'https://www.coupang.com/vp/products/1', '_blank', 'noopener,noreferrer']]);

  // 네이티브에서는 OS 처리기로 넘긴다.
  render({ purchaseUrl: 'https://ssg.com/item/1' });
  platform = 'ios';
  linkButton().onPress();
  assert.deepEqual(opened, [['native', 'https://ssg.com/item/1']]);
}

function main() {
  checkHostFormatting();
  checkCardStates();
  checkOpening();
  console.log('Purchase card checks passed: a tip is what makes a card 쇼핑꿀팁, a link alone only shows where it was bought, cards show the host rather than the whole URL, and the link opens in a new tab on web or the OS handler on native.');
}

main();
