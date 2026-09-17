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
    TextInput: (props) => { inputs.push(props); return null; }, ActivityIndicator: () => null, Image: () => null,
    StyleSheet: { create: (styles) => styles },
  };
  const { AppError } = load('errors/appError.ts');
  const category = { id: 'ramen', label: '먹을것 › 라면' };
  const params = { categoryId: category.id, itemName: '새 라면' };
  const auth = { user: { id: 'owner' }, isLoading: false, error: null, retry: () => { sessionRetries++; } };
  const categories = { data: [category], isPending: false, isError: false, refetch: () => { categoryRetries++; } };
  const profile = { data: { currentPicks: [] }, isPending: false, isError: false, error: null, refetch: () => { profileRetries++; } };
  let outcome = async () => ({ type: 'pending_item', item: { name: '새 라면' } });
  const mutation = { isPending: false, isError: false, error: null, reset() { this.isError = false; this.error = null; }, mutateAsync: async (input) => {
    calls++; payload = input;
    return outcome();
  } };
  const draft = { uri: 'data:image/jpeg;base64,cGhvdG8=', base64: 'cGhvdG8=', thumbnailBase64: 'dGh1bWI=', uploadId: 'request-photo' };
  let chosenPhoto = draft, pickerCalls = 0, importedUrl;
  const picker = { isPending: false, isError: false, error: null, reset() { this.isError = false; this.error = null; }, mutateAsync: async () => { pickerCalls++; return chosenPhoto; } };
  const importer = { ...picker, mutateAsync: async (url) => { importedUrl = url; return { ...draft, sourceUrl: url }; } };
  const { default: Request } = load('app/pick/request.tsx', {
    react: fakeReact, 'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: component('section') },
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({
      push: (route) => { destination = route; }, replace: (route) => { destination = route; }, canGoBack: () => false,
    }) },
    '@/errors/appError': { AppError },
    '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/hooks/useMyProfile': { useMyProfile: () => profile },
    '@/hooks/useRegisterPick': { useRegisterPick: () => mutation, useRegistrationCategories: () => categories,
      useChoosePhoto: () => picker, useImportItemPhoto: () => importer },
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
  assert.equal(destination.params.itemName, '수정한 라면');
  assert.equal(destination.params.categoryId, category.id);
  profile.isError = false; profile.error = null;

  let rejectRequest;
  outcome = () => new Promise((_, reject) => { rejectRequest = reject; });
  render(); press('제품 등록 요청 보내기'); press('제품 등록 요청 보내기');
  assert.equal(calls, 1, 'Two taps before a rerender send exactly one request');
  assert.equal(payload.itemName, '수정한 라면');
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
  outcome = async () => ({ type: 'pending_item', item: { name: '수정한 라면' } });
  press('제품 등록 요청 보내기'); await settle();
  assert.equal(calls, 2, 'Failure releases the in-flight guard for retry');
  assert.match(render(), /제품 등록 요청을 보냈어요/);
  press('내 등록 요청 보기');
  assert.equal(destination, '/(tabs)/profile', 'A pending request leads directly to its status in My Profile');
  press('홈으로 돌아가기');
  assert.equal(destination, '/');

  state = []; mutation.isError = false; mutation.error = null;
  outcome = async () => ({ type: 'existing_item', item: { id: 'existing', categoryId: category.id } });
  render(); press('제품 등록 요청 보내기'); await settle();
  assert.equal(destination.pathname, '/pick/choose');
  assert.equal(destination.params.itemId, 'existing');

  state = []; render();
  press('직접 사진 선택'); await settle(); render();
  assert.equal(button('제품 등록 요청 보내기').disabled, true, 'A photo needs explicit shared-image confirmation');
  press('이 제품의 사진이 맞으며'); render();
  assert.equal(button('제품 등록 요청 보내기').disabled, false);
  chosenPhoto = null;
  press('사진 바꾸기'); await settle(); render();
  assert.equal(button('이 제품의 사진이 맞으며').accessibilityState.checked, true, 'Cancelling keeps the confirmed photo');
  nameInput().onChangeText('사진 있는 라면'); render();
  assert.equal(button('제품 등록 요청 보내기').disabled, true, 'Changing identity requires confirming the photo again');
  press('이 제품의 사진이 맞으며'); render();
  picker.isPending = true; render();
  assert.equal(button('제품 등록 요청 보내기').disabled, true, 'Submitting is blocked during photo preparation');
  assert.equal(nameInput().editable, false);
  picker.isPending = false;
  outcome = async () => { throw new AppError('PHOTO_UPLOAD_FAILED'); };
  render(); press('제품 등록 요청 보내기'); await settle();
  assert.equal(payload.photo, draft, 'The actual request carries the selected image');
  mutation.isError = true; mutation.error = new AppError('PHOTO_UPLOAD_FAILED');
  assert.match(render(), /사진을 저장하지 못했어요/);
  assert.equal(button('이 제품의 사진이 맞으며').accessibilityState.checked, true, 'Upload failure preserves photo for retry');
  press('사진 제거'); render();
  assert.equal(button('제품 등록 요청 보내기').disabled, false, 'Image-free requests remain supported');
  inputs.find((p) => p.accessibilityLabel === '제품 이미지 링크').onChangeText('https://maker.example/ramen');
  render(); press('링크에서 이미지 가져오기'); await settle(); render();
  assert.equal(importedUrl, 'https://maker.example/ramen');
  assert.equal(button('제품 등록 요청 보내기').disabled, true, 'Imported images also need confirmation');
  press('이 제품의 사진이 맞으며'); render();
  outcome = async () => ({ type: 'pending_item', item: { name: '사진 있는 라면' } });
  press('제품 등록 요청 보내기'); await settle();
  assert.equal(payload.photo.sourceUrl, importedUrl, 'Source attribution reaches the existing registration service');
  assert.match(render(), /제품 등록 요청을 보냈어요/);

  state = []; auth.user = null; profile.data = undefined; profile.isPending = true;
  const beforeLogin = calls;
  render();
  const beforePicker = pickerCalls;
  press('로그인하고 사진 추가');
  assert.equal(pickerCalls, beforePicker, 'Sign in before choosing a photo so OAuth cannot lose the file draft');
  assert.equal(destination.params.action, 'request_item');
  press('로그인하고 요청하기');
  assert.equal(calls, beforeLogin);
  assert.equal(destination.pathname, '/auth/login');
  assert.equal(destination.params.action, 'request_item');
  assert.equal(destination.params.itemName, params.itemName);
  assert.equal(destination.params.categoryId, category.id);
  console.log('Item request checks passed: prerequisites, photo selection/import/confirmation, retry preservation, duplicate taps and login/approval routes.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
