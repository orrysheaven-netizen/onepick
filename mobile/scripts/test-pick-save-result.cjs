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
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name in imports) return imports[name];
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
const newPickId = 'c3333333-3333-4333-8333-333333333333';
const { AppError } = load('errors/appError.ts');
let auth, params, query, mutation, result, states, stateIndex, mountedKey;
let buttons, input, inputs, destinations, attempts, mode, pending, retries = 0;
const native = {
  View: part('div'), Text: part('span'), ScrollView: part('main'), ActivityIndicator: () => null,
  // The screen now renders the review, the purchase link and the tip. Keep
  // `input` on the review field so typing a reason still targets the reason.
  TextInput: (props) => { inputs.push(props); if (props.accessibilityLabel === '원픽 한줄평') input = props; return null; },
  Pressable: (props) => { buttons.push(props); return React.createElement('button', null, props.children); },
  StyleSheet: { create: (styles) => styles },
};
const { default: Choose } = load('app/pick/choose.tsx', {
  react: { ...React,
    useState: (initial) => {
      const index = stateIndex++;
      const owner = states;
      if (!(index in owner)) owner[index] = typeof initial === 'function' ? initial() : initial;
      // Capture the mounted form's state store so late results cannot affect a new key.
      return [owner[index], (value) => { owner[index] = typeof value === 'function' ? value(owner[index]) : value; }];
    },
    useMemo: (compute) => compute(),
    useRef: () => ({ current: { focus() {} } }),
  },
  'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({
    replace: (route) => destinations.push({ action: 'replace', route }),
    push: (route) => destinations.push({ action: 'push', route }), back() {},
  }) },
  'react-native': native, 'react-native-safe-area-context': { SafeAreaView: part('section') },
  '@/components/pick-photo': { PickPhoto: () => null }, '@/errors/appError': { AppError },
  '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } }),
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useItemDetail': { useItemDetail: () => query },
  '@/hooks/useChoosePick': { useChoosePick: () => mutation },
});

function arrange(status = { type: 'not_selected' }) {
  auth = { user: { id: 'owner' }, isLoading: false, error: null, retry: () => retries++ };
  params = { itemId, categoryId };
  query = { isPending: false, isError: false, data: {
    item: { id: itemId, categoryId, name: '진라면', status: 'active', thumbnailUrl: null },
    canChoose: true, myPickStatus: status,
  } };
  result = { id: status.type === 'selected_this' ? status.pickId : newPickId,
    userId: 'owner', itemId, categoryId, status: 'active', oneLineReview: '서버에서 확인한 나의 한줄평' };
  states = []; stateIndex = 0; mountedKey = null;
  destinations = []; attempts = []; mode = 'success'; pending = null;
  mutation = { isPending: false, isError: false, error: null, mutateAsync: async (payload) => {
    attempts.push(payload); mutation.isPending = true; mutation.isError = false;
    try {
      if (mode === 'failure') throw new AppError('INTERNAL_ERROR');
      if (mode === 'pending') return await new Promise((resolve, reject) => { pending = { resolve, reject }; });
      return result;
    } catch (error) { mutation.isError = true; mutation.error = error; throw error; }
    finally { mutation.isPending = false; }
  } };
}
function render() {
  const element = Choose();
  if (element.key !== mountedKey) { mountedKey = element.key; states = []; }
  stateIndex = 0; buttons = []; inputs = []; input = undefined;
  return renderToStaticMarkup(element);
}
function button(label) {
  const found = buttons.find((props) => props.accessibilityLabel === label || textOf(props.children) === label);
  assert.ok(found, `Expected button: ${label}`);
  return found;
}
function noSuccess(markup) {
  assert.doesNotMatch(markup, /원픽이 선택됐어요|다른 사람의 원픽 계속 보기/);
  assert.equal(buttons.some((props) => props.accessibilityLabel === '내 원픽 보기'), false);
}
function submit(label) {
  render(); input.onChangeText('  직접 작성한 나의 이유  '); render(); button(label).onPress();
}
function checkSavedNavigation() {
  const page = render();
  assert.match(page, /원픽이 선택됐어요/);
  assert.match(page, /서버에서 확인한 나의 한줄평/);
  assert.match(page, /내 원픽은 내 프로필에 모이고/);
  assert.doesNotMatch(page, /홈에서 확인하기/);
  assert.ok(page.indexOf('내 원픽 보기') < page.indexOf('다른 사람의 원픽 계속 보기'));
  assert.equal(destinations.length, 0, 'Saving should not silently navigate before the user chooses');
  const before = attempts.length;
  button('내 원픽 보기').onPress();
  const destination = destinations.at(-1);
  assert.equal(destination.action, 'replace');
  assert.equal(destination.route.pathname, '/item/[itemId]');
  assert.equal(destination.route.params.itemId, result.itemId);
  assert.equal(destination.route.params.pickId, result.id, 'Use acknowledged Pick ID, not the previous choice or another author');
  assert.equal(Object.keys(destination.route.params).sort().join(','), 'itemId,pickId');
  button('다른 사람의 원픽 계속 보기').onPress();
  assert.equal(destinations.at(-1).action, 'replace'); assert.equal(destinations.at(-1).route, '/');
  assert.equal(attempts.length, before, 'Result actions navigate only; they must not register another Pick');
}

async function main() {
  for (const [status, label] of [
    [{ type: 'not_selected' }, '내 원픽으로 선택'],
    [{ type: 'selected_other', pickId: 'old-pick', itemId: 'old-product' }, '이 제품으로 바꾸기'],
    [{ type: 'selected_this', pickId: newPickId, oneLineReview: '이전 한줄평' }, '한줄평 저장'],
  ]) {
    arrange(status); noSuccess(render()); submit(label); await flush();
    assert.equal(attempts.length, 1); assert.equal(attempts[0].oneLineReview, '직접 작성한 나의 이유');
    checkSavedNavigation();
  }

  arrange(); mode = 'pending'; submit('내 원픽으로 선택'); noSuccess(render());
  assert.equal(button('내 원픽으로 선택').disabled, true);
  button('내 원픽으로 선택').onPress(); assert.equal(attempts.length, 1);
  pending.resolve(result); await flush();
  // Stale/failed metadata reads must not send the user to an older Pick or imply the save failed.
  query.data = undefined; query.isError = true;
  let page = render(); assert.match(page, /원픽이 선택됐어요/); assert.match(page, /진라면/);
  assert.doesNotMatch(page, /제품을 불러오지 못했어요/);
  checkSavedNavigation();

  arrange(); mode = 'failure'; submit('내 원픽으로 선택'); await flush();
  noSuccess(render()); assert.equal(input.value, '  직접 작성한 나의 이유  ');
  assert.equal(destinations.length, 0, 'Failure must not navigate to a success target');
  assert.match(render(), /원픽을 저장하지 못했어요/);
  mode = 'success'; button('내 원픽으로 선택').onPress(); await flush();
  assert.equal(attempts.length, 2); checkSavedNavigation();

  arrange(); submit('내 원픽으로 선택'); await flush(); render();
  auth.isLoading = true; noSuccess(render()); auth.isLoading = false;
  auth.error = new Error('session'); page = render(); noSuccess(page);
  assert.match(page, /로그인 상태를 확인하지 못했어요/); button('다시 확인하기').onPress(); assert.equal(retries, 1);
  auth.error = null; assert.match(render(), /원픽이 선택됐어요/);
  const ownerKey = mountedKey;
  auth.user = null; noSuccess(render()); assert.notEqual(mountedKey, ownerKey);
  assert.doesNotMatch(render(), /서버에서 확인한 나의 한줄평/); button('로그인하고 계속').onPress();
  assert.equal(destinations.at(-1).route.params.action, 'choose_pick');
  assert.equal(destinations.at(-1).route.params.itemId, itemId);

  // Remount identity is explicit for both another account and another product.
  arrange(); submit('내 원픽으로 선택'); await flush(); render();
  let oldKey = mountedKey; auth.user = { id: 'different-user' }; noSuccess(render()); assert.notEqual(mountedKey, oldKey);
  assert.equal(input.value, '', 'Previous account draft must not be reused');
  oldKey = mountedKey; params = { itemId: 'new-item', categoryId };
  query.data.item = { ...query.data.item, id: 'new-item', name: '신라면' };
  noSuccess(render()); assert.notEqual(mountedKey, oldKey);
  oldKey = mountedKey; params = { ...params, categoryId: 'other-category' }; noSuccess(render()); assert.notEqual(mountedKey, oldKey);

  arrange(); mode = 'pending'; submit('내 원픽으로 선택'); render();
  const oldResult = result; auth.user = { id: 'new-user' }; noSuccess(render());
  pending.resolve(oldResult); await flush(); noSuccess(render());
  assert.doesNotMatch(render(), /서버에서 확인한 나의 한줄평/, 'Late result belongs only to the unmounted old account form');

  arrange(); query.data = undefined; query.isError = true;
  noSuccess(render()); assert.match(render(), /제품을 불러오지 못했어요/);
  arrange(); query.data.canChoose = false; noSuccess(render()); assert.equal(input, undefined);

  // Multi-pick category with a free slot: saving adds, never names a pick to replace.
  arrange({ type: 'can_add', heldCount: 2, maxPicks: 5 }); query.data.category = { maxPicks: 5 };
  page = render();
  assert.match(page, /이것도 내 원픽에 담을까요\?/); assert.match(page, /지금 2개를 담았어요\. 5개까지/);
  assert.match(page, /이 카테고리는 5개까지/);
  submit('내 원픽에 추가'); await flush();
  assert.equal(attempts.length, 1); assert.equal('replacePickId' in attempts[0], false, 'Adding must not replace anything');

  // Full multi-pick category: nothing is saved until the person picks which one to swap out.
  const heldPicks = [
    { pickId: 'held-1', itemId: 'movie-1', itemName: '첫 번째 영화', position: 1 },
    { pickId: 'held-2', itemId: 'movie-2', itemName: '두 번째 영화', position: 2 },
  ];
  arrange({ type: 'category_full', maxPicks: 2, heldPicks }); query.data.category = { maxPicks: 2 };
  page = render();
  assert.match(page, /어떤 원픽과 바꿀까요\?/); assert.match(page, /첫 번째 영화/); assert.match(page, /대표/);
  input.onChangeText('새로 담는 이유'); render();
  button('바꿀 원픽을 골라주세요').onPress(); await flush();
  assert.equal(attempts.length, 0, 'A full category never saves without a chosen replacement');
  buttons.find((props) => props.accessibilityRole === 'radio' && props.accessibilityLabel === '두 번째 영화 대신 담기').onPress();
  render();
  assert.equal(buttons.find((props) => props.accessibilityRole === 'radio' && props.accessibilityLabel === '두 번째 영화 대신 담기')
    .accessibilityState.checked, true);
  buttons.filter((props) => props.accessibilityRole !== 'radio' && textOf(props.children) === '두 번째 영화 대신 담기')[0].onPress();
  await flush();
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].replacePickId, 'held-2', 'The chosen pick is the one replaced');
  console.log('Saved Pick confirmation passed: new/change/review save, exact result IDs, explicit home browsing, no extra writes, pending/failure/retry, refresh failure, session gates and account/item scope isolation, multi-pick add and chosen replacement.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
