const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/components/profile-pick-card.tsx'), 'utf8');
const owner = fs.readFileSync(path.join(root, 'src/app/(tabs)/profile.tsx'), 'utf8');
const publicProfile = fs.readFileSync(path.join(root, 'src/app/u/[username].tsx'), 'utf8');

const exports = {};
const presses = [];
const native = {
  View: ({ children }) => React.createElement('div', null, children),
  Text: ({ children }) => React.createElement('span', null, children),
  Pressable: (props) => { presses.push(props); return React.createElement('button', null, props.children); },
  StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
};

vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, {
  exports,
  require: (name) => {
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return native;
    if (name === '@/components/pick-photo') return { PickPhoto: () => React.createElement('img', { alt: 'photo' }) };
    assert.fail(`Unexpected import: ${name}`);
  },
});

let pickCalls = 0, itemCalls = 0;
const html = renderToStaticMarkup(React.createElement(exports.ProfilePickCard, {
  categoryName: '영화',
  itemName: '아주 긴 제품 이름을 가진 테스트 작품',
  review: '긴 한줄평도 카드 높이를 과하게 늘리지 않고 두 줄 안에서 읽을 수 있어야 합니다.',
  itemId: 'item-1',
  itemStatus: 'active',
  hasPhoto: true,
  statusText: '다른 원픽으로 변경됨',
  onPressPick: () => { pickCalls++; },
  onPressItem: () => { itemCalls++; },
}));

assert.match(html, /영화/);
assert.match(html, /아주 긴 제품 이름/);
assert.match(html, /긴 한줄평/);
assert.match(html, /다른 원픽으로 변경됨/);
assert.match(html, /제품 보기/);
assert.doesNotMatch(html, />원픽 상세 보기</);

const pickButton = presses.find((p) => p.accessibilityLabel?.includes('원픽 상세 보기'));
const itemButton = presses.find((p) => p.accessibilityLabel?.includes('제품 상세 보기'));
assert.ok(pickButton, 'main card action must open the Pick');
assert.ok(itemButton, 'secondary action must open the item');
pickButton.onPress();
assert.equal(pickCalls, 1);
assert.equal(itemCalls, 0, 'opening the Pick must not also open the item');
itemButton.onPress();
assert.equal(itemCalls, 1);
assert.equal(itemButton.hitSlop, 4, 'compact product action keeps an expanded touch target');

assert.match(source, /<Text numberOfLines=\{2\} style=\{styles\.name\}>/);
assert.match(source, /<Text numberOfLines=\{2\} style=\{styles\.review\}>/);
assert.match(source, /categoryPill/);
assert.match(owner, /import \{ ProfilePickCard \} from '@\/components\/profile-pick-card'/);
assert.match(publicProfile, /import \{ ProfilePickCard \} from '@\/components\/profile-pick-card'/);
assert.ok((owner.match(/<ProfilePickCard/g) || []).length >= 2, 'owner profile uses the shared card for current and history picks');
assert.ok((publicProfile.match(/<ProfilePickCard/g) || []).length >= 1, 'public profile uses the shared card');
assert.doesNotMatch(publicProfile, /원픽 상세 보기 ›/);
assert.doesNotMatch(publicProfile, /제품 상세 보기 ›/);

console.log('Shared profile pick card checks passed: 2-line scan limits, distinct Pick/item actions, expanded product touch target, and owner/public reuse.');
