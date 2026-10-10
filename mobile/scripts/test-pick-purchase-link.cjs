// 구매처 링크와 쇼핑꿀팁. docs/pick-purchase-link.md 참조.
//
// 핵심은 두 가지다. 링크를 건드리지 않은 저장이 이미 남긴 링크를 지우지 않는
// 것, 그리고 팁을 남길지는 도메인이 아니라 사용자가 정하는 것.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name) => {
    // The choose screen imports these only for comment-origin registration;
    // preserve every existing test hook while rejecting unexpected new writes.
    if (name === 'expo-crypto') return { randomUUID: () => '11111111-1111-4111-8111-111111111111' };
    if (name === '@/hooks/useRegisterPick') {
      const hooks = imports[name] ?? {};
      return { ...hooks, useRegisterItemPick: hooks.useRegisterItemPick ?? (() => ({
        isPending: false, error: null,
        mutateAsync: async () => { throw new Error('unexpected comment-origin registration'); },
      })) };
    }
    if (name in imports) return imports[name];
    // Pure channel helpers of the choose screen load as-is.
    if (name === '@/lib/home/homeChannels') return load('lib/home/homeChannels.ts');
    if (name === '@/lib/items/pickChannel') return load('lib/items/pickChannel.ts');
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name === '@/services/onboardingService') return { onboardingService: { recordAction: async () => {} } };
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    assert.fail(`Unexpected dependency: ${name}`);
  } });
  return exports;
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const part = (tag) => ({ children }) => React.createElement(tag, null, children);
const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';
const itemId = 'a1111111-1111-4111-8111-111111111111';
const categoryId = 'b2222222-2222-4222-8222-222222222222';
const { AppError } = load('errors/appError.ts');

let auth, params, query, mutation, states, stateIndex, mountedKey;
let buttons, inputs, attempts;
const native = {
  View: part('div'), Text: part('span'), ScrollView: part('main'), ActivityIndicator: () => null,
  TextInput: (props) => { inputs.push(props); return null; },
  Pressable: (props) => { buttons.push(props); return React.createElement('button', null, props.children); },
  StyleSheet: { create: (styles) => styles },
};
const { default: Choose } = load('app/pick/choose.tsx', {
  react: { ...React,
    useState: (initial) => {
      const index = stateIndex++;
      const owner = states;
      if (!(index in owner)) owner[index] = typeof initial === 'function' ? initial() : initial;
      return [owner[index], (value) => { owner[index] = typeof value === 'function' ? value(owner[index]) : value; }];
    },
    useMemo: (compute) => compute(),
    useRef: () => ({ current: { focus() {} } }),
  },
  'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ replace() {}, push() {}, back() {}, canGoBack: () => true }) },
  'react-native': native, 'react-native-safe-area-context': { SafeAreaView: part('section') },
  '@/components/pick-photo': { PickPhoto: () => null }, '@/components/pick-photo-step': { PickPhotoStep: () => null }, '@/errors/appError': { AppError },
  '@/constants/onepick': { ...require('./design-tokens.cjs'), OnePickFeatures: { follow: false, purchaseLinks: true } },
  '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null }, '@/components/pick-photo-step': { PickPhotoStep: () => null } }),
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useItemDetail': { useItemDetail: () => query },
  '@/hooks/useChoosePick': { useChoosePick: () => mutation, useRequestPendingPick: () => ({ isPending: false, error: null }) },
});

function arrange(status = { type: 'not_selected' }) {
  auth = { user: { id: 'owner' }, isLoading: false, error: null, retry() {} };
  params = { itemId, categoryId };
  query = { isPending: false, isError: false, data: {
    item: { id: itemId, categoryId, name: '진라면', status: 'active', thumbnailUrl: null, imageUrl: 'https://image.test/item.jpg' },
    canChoose: true, myPickStatus: status,
  } };
  states = []; stateIndex = 0; mountedKey = null; attempts = [];
  mutation = { isPending: false, isError: false, error: null, mutateAsync: async (payload) => {
    attempts.push(payload);
    return { id: 'pick-1', userId: 'owner', itemId, categoryId, status: 'active',
      oneLineReview: payload.oneLineReview, purchaseUrl: null, purchaseTip: null };
  } };
}
function render() {
  const element = Choose();
  if (element.key !== mountedKey) { mountedKey = element.key; states = []; }
  stateIndex = 0; buttons = []; inputs = [];
  return renderToStaticMarkup(element);
}
const field = (label) => inputs.find((props) => props.accessibilityLabel === label);
function button(label) {
  const found = buttons.find((props) => props.accessibilityLabel === label || textOf(props.children) === label);
  assert.ok(found, `Expected button: ${label}`);
  return found;
}
const type = (label, value) => { render(); field(label).onChangeText(value); };

async function checkUntouchedLinkIsNotSent() {
  arrange();
  render();
  assert.ok(field('산 곳 링크'), '링크 입력은 등록 화면에 있다');
  type('원픽 한줄평', '결국 이걸로 돌아온다');
  render(); button('내 원픽으로 고르기').onPress(); await flush();
  assert.equal(attempts.length, 1);
  // 저장된 링크를 지우지 않으려면 건드리지 않은 필드는 아예 보내지 않아야 한다.
  assert.equal('purchaseUrl' in attempts[0], false, '링크를 건드리지 않으면 링크 인자를 보내지 않는다');
  assert.equal('purchaseTip' in attempts[0], false, '링크를 건드리지 않으면 팁 인자도 보내지 않는다');
}

async function checkQuestionOnlyAfterALink() {
  arrange();
  let page = render();
  assert.doesNotMatch(page, /살 때 알아두면 좋은 게 있나요/, '링크가 없으면 아무것도 더 묻지 않는다');
  type('원픽 한줄평', '이유');
  type('산 곳 링크', 'https://www.coupang.com/vp/products/1');
  page = render();
  assert.match(page, /살 때 알아두면 좋은 게 있나요/, '링크를 넣으면 한 번 물어본다');
  assert.equal(field('살 때 팁'), undefined, '묻기만 하고 팁 칸을 먼저 열지 않는다');

  // "그냥 판매 링크예요"를 고르면 팁 없이 링크만 저장된다.
  render(); button('그냥 판매 링크예요.').onPress();
  render(); button('내 원픽으로 고르기').onPress(); await flush();
  assert.equal(attempts[0].purchaseUrl, 'https://www.coupang.com/vp/products/1');
  assert.equal(attempts[0].purchaseTip, '', '팁 없음은 빈 문자열로 보내 이전 팁을 지운다');
}

async function checkTipIsSavedWhenOffered() {
  arrange();
  type('원픽 한줄평', '이유');
  type('산 곳 링크', 'https://ssg.com/item/1');
  render(); button('있어요').onPress();
  render();
  assert.ok(field('살 때 팁'), '있어요를 고르면 팁 칸이 열린다');
  type('살 때 팁', '  새벽배송이 빨라요  ');
  render(); button('내 원픽으로 고르기').onPress(); await flush();
  assert.equal(attempts[0].purchaseUrl, 'https://ssg.com/item/1');
  assert.equal(attempts[0].purchaseTip, '새벽배송이 빨라요', '앞뒤 공백은 떼고 보낸다');
}

async function checkNonHttpsIsRefusedBeforeSaving() {
  arrange();
  type('원픽 한줄평', '이유');
  type('산 곳 링크', 'http://coupang.com/x');
  const page = render();
  assert.match(page, /https:\/\/ 로 시작하는 주소만/, 'https가 아니면 이유를 알려준다');
  assert.doesNotMatch(page, /살 때 알아두면 좋은 게 있나요/, '잘못된 링크에는 팁을 묻지 않는다');
  button('내 원픽으로 고르기').onPress(); await flush();
  assert.equal(attempts.length, 0, '잘못된 링크로는 저장하지 않는다');
}

async function checkClearingTheLinkClearsTheTip() {
  arrange();
  type('원픽 한줄평', '이유');
  type('산 곳 링크', 'https://ssg.com/item/1');
  render(); button('있어요').onPress();
  type('살 때 팁', '새벽배송');
  type('산 곳 링크', '');
  const page = render();
  assert.doesNotMatch(page, /살 때 알아두면 좋은 게 있나요/, '링크를 지우면 질문도 사라진다');
  render(); button('내 원픽으로 고르기').onPress(); await flush();
  assert.equal(attempts[0].purchaseUrl, '', '빈 문자열로 링크를 지운다');
  assert.equal(attempts[0].purchaseTip, '', '살 곳이 없으면 팁도 함께 끝난다');
}

// 서비스 계층은 DB와 같은 규칙을 앞에서 한 번 더 건다. 실제 방어선은 DB다.
function checkServiceGuards() {
  const { PickService } = load('services/pickService.ts', {
    '@/errors/appError': { AppError },
    '@/repositories/interfaces/pickRepository': {},
    '@/repositories/interfaces/categoryRepository': {},
    '@/repositories/interfaces/itemRepository': {},
    '@/repositories/interfaces/readRepository': {},
  });
  const calls = [];
  const service = new PickService(
    { changePick: async (input) => { calls.push(input); return input; },
      updateReview: async (input) => { calls.push(input); return input; } },
    { getById: async () => ({ id: categoryId, status: 'open', isPickable: true }) },
    { getById: async () => ({ id: itemId, categoryId, status: 'active' }) },
    {},
  );
  const base = { categoryId, itemId, oneLineReview: '이유' };
  return Promise.resolve()
    .then(() => assert.rejects(() => service.choosePick({ ...base, purchaseUrl: 'http://x.com/a' }), /PURCHASE_URL_INVALID/))
    .then(() => assert.rejects(() => service.choosePick({ ...base, purchaseUrl: '', purchaseTip: '살 곳 없는 팁' }), /PURCHASE_TIP_WITHOUT_URL/))
    .then(() => assert.rejects(() => service.choosePick({ ...base, purchaseUrl: 'https://x.com/a', purchaseTip: 'x'.repeat(101) }), /PURCHASE_TIP_INVALID/))
    .then(async () => {
      // 링크를 넘기지 않은 편집은 두 인자 모두 그대로 비워 보낸다.
      await service.updateReview({ pickId: 'pick-1', oneLineReview: '수정' });
      const last = calls.at(-1);
      assert.equal('purchaseUrl' in last, false);
      assert.equal('purchaseTip' in last, false);
      // 팁만 고치는 경우, 저장된 링크는 DB가 확인하므로 앞에서 막지 않는다.
      await service.updateReview({ pickId: 'pick-1', oneLineReview: '수정', purchaseTip: '팁만' });
      assert.equal(calls.at(-1).purchaseTip, '팁만');
    });
}

async function main() {
  assert.equal(require('./design-tokens.cjs').OnePickFeatures.purchaseLinks, false,
    'Purchase-link UI stays dormant until the linked DB has the purchase schema');
  await checkUntouchedLinkIsNotSent();
  await checkQuestionOnlyAfterALink();
  await checkTipIsSavedWhenOffered();
  await checkNonHttpsIsRefusedBeforeSaving();
  await checkClearingTheLinkClearsTheTip();
  await checkServiceGuards();
  console.log('Purchase link checks passed: an untouched link is never sent, the tip question follows a valid link and the person answers it, trimming and clearing behave, non-https is refused before saving, and the service mirrors the database rules.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
