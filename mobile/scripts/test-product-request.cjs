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
    if (name in imports) return imports[name];
    if (name === 'react/jsx-runtime') return require(name);
    assert.fail(name);
  } });
  return exports;
}

const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';
const settle = () => new Promise(setImmediate);

async function main() {
  let state = [], index = 0, presses = [], inputs = [], destination, payload, calls = 0;
  let sessionRetries = 0, categoryRetries = 0, profileRetries = 0;
  const fakeReact = { ...React, useState: (initial) => {
    const slot = index++;
    if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
    return [state[slot], (value) => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }];
  }, useRef: (initial) => {
    const slot = index++;
    if (!(slot in state)) state[slot] = { current: initial };
    return state[slot];
  } };
  const component = (tag) => ({ children }) => React.createElement(tag, null, children);
  const native = {
    Text: component('span'), View: component('div'), ScrollView: component('main'),
    Pressable: (props) => { presses.push(props); return React.createElement('button', null, props.children); },
    TextInput: (props) => { inputs.push(props); return null; }, ActivityIndicator: () => null,
    StyleSheet: { create: (styles) => styles },
  };
  const { AppError } = load('errors/appError.ts');
  const category = { id: 'ramen', label: '먹을것 › 라면' };
  const params = { categoryId: category.id, productName: '새 라면' };
  const auth = { user: { id: 'owner' }, isLoading: false, error: null, retry: () => { sessionRetries++; } };
  const categories = { data: [category], isPending: false, isError: false, refetch: () => { categoryRetries++; } };
  const profile = { data: { currentPicks: [] }, isPending: false, isError: false, error: null, refetch: () => { profileRetries++; } };
  let outcome = async () => ({ type: 'pending_product', product: { name: '새 라면' } });
  const mutation = { isPending: false, isError: false, error: null, mutateAsync: async (input) => {
    calls++; payload = input;
    return outcome();
  } };
  const { default: Request } = load('app/pick/request.tsx', {
    react: fakeReact, 'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: component('section') },
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({
      push: (route) => { destination = route; }, replace: (route) => { destination = route; }, canGoBack: () => false,
    }) },
    '@/errors/appError': { AppError },
    '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/hooks/useMyProfile': { useMyProfile: () => profile },
    '@/hooks/useRegisterPick': { useRegisterPick: () => mutation, useRegistrationCategories: () => categories },
  });
  const render = () => { index = 0; presses = []; inputs = []; return renderToStaticMarkup(React.createElement(Request)); };
  const button = (text) => { const found = presses.find((p) => textOf(p.children).includes(text)); assert.ok(found, text); return found; };
  const press = (text) => { const found = button(text); assert.ok(!found.disabled, text); return found.onPress(); };
  const nameInput = () => inputs.find((p) => p.accessibilityLabel === '요청 제품명');
  const assertBlocked = async () => {
    const submit = button('제품 등록 요청 보내기');
    assert.equal(submit.disabled, true);
    submit.onPress(); await settle();
    assert.equal(calls, 0, 'Unavailable prerequisites must not submit even through a stale handler');
  };

  render(); nameInput().onChangeText('  수정한   라면  ');
  auth.error = new Error('session unavailable');
  assert.match(render(), /로그인 상태를 확인하지 못했어요/);
  assert.equal(inputs.length, 0); press('로그인 상태 다시 확인'); assert.equal(sessionRetries, 1);
  auth.error = null; render(); assert.equal(nameInput().value, '  수정한   라면  ');

  categories.isError = true;
  assert.match(render(), /카테고리를 불러오지 못했어요/);
  await assertBlocked(); press('카테고리 다시 불러오기'); assert.equal(categoryRetries, 1);
  categories.isError = false; categories.data = [];
  assert.match(render(), /요청할 수 있는 카테고리가 없어요/); await assertBlocked();
  categories.data = [category];

  profile.isPending = true; render(); await assertBlocked();
  profile.isPending = false; profile.isError = true; profile.error = new Error('profile unavailable');
  assert.match(render(), /프로필을 불러오지 못했어요/); await assertBlocked();
  press('프로필 다시 불러오기'); assert.equal(profileRetries, 1);
  profile.error = new AppError('PROFILE_NOT_FOUND');
  render(); press('사용자명 만들기');
  assert.equal(destination.pathname, '/auth/username');
  assert.equal(destination.params.productName, '수정한 라면');
  assert.equal(destination.params.categoryId, category.id);
  profile.isError = false; profile.error = null;

  let rejectRequest;
  outcome = () => new Promise((_, reject) => { rejectRequest = reject; });
  render(); press('제품 등록 요청 보내기'); press('제품 등록 요청 보내기');
  assert.equal(calls, 1, 'Two taps before a rerender send exactly one request');
  assert.equal(payload.productName, '수정한 라면');
  assert.equal(payload.categoryId, category.id);
  assert.equal(payload.photo, null);
  mutation.isPending = true; render();
  assert.equal(nameInput().editable, false);
  assert.equal(button(category.label).disabled, true);
  assert.equal(presses.find((p) => p.accessibilityLabel === '돌아가기').disabled, true);
  rejectRequest(new Error('offline')); await settle();
  mutation.isPending = false; mutation.isError = true; mutation.error = new Error('offline');
  assert.match(render(), /요청을 보내지 못했어요/);
  assert.equal(nameInput().value, '  수정한   라면  ', 'A failed request keeps the edited draft');
  outcome = async () => ({ type: 'pending_product', product: { name: '수정한 라면' } });
  press('제품 등록 요청 보내기'); await settle();
  assert.equal(calls, 2, 'Failure releases the in-flight guard for retry');
  assert.match(render(), /제품 등록 요청을 보냈어요/);

  state = []; mutation.isError = false; mutation.error = null;
  outcome = async () => ({ type: 'existing_product', product: { id: 'existing', categoryId: category.id } });
  render(); press('제품 등록 요청 보내기'); await settle();
  assert.equal(destination.pathname, '/pick/choose');
  assert.equal(destination.params.productId, 'existing');

  state = []; auth.user = null; profile.data = undefined; profile.isPending = true;
  const beforeLogin = calls;
  render(); press('로그인하고 요청하기');
  assert.equal(calls, beforeLogin);
  assert.equal(destination.pathname, '/auth/login');
  assert.equal(destination.params.action, 'request_product');
  assert.equal(destination.params.productName, params.productName);
  assert.equal(destination.params.categoryId, category.id);
  console.log('Product request checks passed: prerequisite failures, retries, draft preservation, duplicate taps and login/approval routes.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
