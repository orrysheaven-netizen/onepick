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
  }).outputText, { exports, URL, require: (name) => {
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name === '@/lib/items/pickChannel') return load('lib/items/pickChannel.ts');
    if (name in imports) return imports[name];
    if (name === 'react/jsx-runtime') return require(name);
    assert.fail(name);
  } });
  return exports;
}

const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';
const constants = require('./design-tokens.cjs');
constants.OnePickFeatures.foodChannelPicker = true;
const settle = () => new Promise(setImmediate);

async function main() {
  let state = [], index = 0, presses = [], inputs = [], destination, payload, calls = 0;
  let sessionRetries = 0, categoryRetries = 0, profileRetries = 0;
  let suggestionItemId, applyItemId, appliedCategoryId, categorySuggestionRetries = 0;
  let hintItemId, hintUserId, sentHint, hintOutcome = async (label) => label;
  let attachedPendingLink;
  let applyOutcome = (categoryId) => ({ type: 'classified', itemId: 'general-pending', categoryId });
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
  let params = { categoryId: category.id, itemName: '새 라면' };
  const auth = { user: { id: 'owner' }, isLoading: false, error: null, retry: () => { sessionRetries++; } };
  const categories = { data: [category], isPending: false, isError: false, refetch: () => { categoryRetries++; } };
  const profile = { data: { currentPicks: [] }, isPending: false, isError: false, error: null, refetch: () => { profileRetries++; } };
  let outcome = async () => ({ type: 'pending_item', item: { id: 'pending-ramen', name: '새 라면' } });
  const mutation = { isPending: false, isError: false, error: null, reset() { this.isError = false; this.error = null; }, mutateAsync: async (input) => {
    calls++; payload = input;
    return outcome();
  } };
  const draft = { uri: 'data:image/jpeg;base64,cGhvdG8=', base64: 'cGhvdG8=', thumbnailBase64: 'dGh1bWI=', uploadId: 'request-photo' };
  let chosenPhoto = draft, pickerCalls = 0, importedUrl;
  const picker = { isPending: false, isError: false, error: null, reset() { this.isError = false; this.error = null; }, mutateAsync: async () => { pickerCalls++; return chosenPhoto; } };
  const importer = { ...picker, mutateAsync: async (url) => { importedUrl = url; return { ...draft, sourceUrl: url }; } };
  const suggestionQuery = {
    data: {
      itemId: 'general-pending',
      suggestions: [
        { categoryId: 'ramen', label: '먹을것 › 라면', reason: '상품명과 가장 가까운 기존 분류입니다.', confidence: 'high' },
        { categoryId: 'snacks', label: '먹을것 › 과자', reason: '간식류일 가능성도 확인할 수 있습니다.', confidence: 'low' },
      ],
      categories: [
        { categoryId: 'ramen', label: '먹을것 › 라면' },
        { categoryId: 'snacks', label: '먹을것 › 과자' },
        { categoryId: 'keyboard', label: '테크 › 키보드' },
      ],
      needsNewCategory: false,
      reused: false,
    },
    isPending: false,
    isError: false,
    error: null,
    refetch: () => { categorySuggestionRetries++; },
  };
  const applyMutation = {
    isPending: false,
    isError: false,
    error: null,
    mutateAsync: async (categoryId) => {
      appliedCategoryId = categoryId;
      return applyOutcome(categoryId);
    },
  };
  const hintMutation = {
    isPending: false,
    isError: false,
    error: null,
    reset() { this.isError = false; this.error = null; },
    mutateAsync: async (label) => { sentHint = label; return hintOutcome(label); },
  };
  const linkAttachMutation = {
    isPending: false,
    isError: false,
    error: null,
    mutateAsync: async (input) => { attachedPendingLink = input; },
  };
  const { default: Request } = load('app/pick/request.tsx', {
    '@/services/registrationService': { CATEGORY_HINT_MAX_LENGTH: 60 },
    react: fakeReact, 'react-native': native,
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } }),
    'react-native-safe-area-context': { SafeAreaView: component('section') },
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({
      push: (route) => { destination = route; }, replace: (route) => { destination = route; }, canGoBack: () => false,
    }) },
    '@/errors/appError': { AppError },
    '@/lib/photos/photoFailure': { showPhotoFailure() {}, isPhotoFailure: () => false },
    '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/hooks/useItemCategoryAi': {
      useItemCategorySuggestions: (itemId) => {
        suggestionItemId = itemId;
        return itemId ? suggestionQuery : { ...suggestionQuery, data: undefined };
      },
      useApplyItemCategory: (itemId) => {
        applyItemId = itemId;
        return applyMutation;
      },
      useSetItemCategoryHint: (itemId, userId) => {
        hintItemId = itemId;
        hintUserId = userId;
        return hintMutation;
      },
    },
    '@/hooks/useMyProfile': { useMyProfile: () => profile },
    '@/hooks/useLinkCategorySuggestions': { useAttachPendingItemLink: () => linkAttachMutation },
    '@/hooks/useRegisterPick': { useRegisterPick: () => mutation, useRegistrationCategories: () => categories,
      useChoosePhoto: () => picker, useImportItemPhoto: () => importer },
  });
  const render = () => { index = 0; presses = []; inputs = []; return renderToStaticMarkup(React.createElement(Request)); };
  const button = (text) => { const found = presses.find((p) => textOf(p.children).includes(text)); assert.ok(found, text); return found; };
  const press = (text) => { const found = button(text); assert.ok(!found.disabled, text); return found.onPress(); };
  const nameInput = () => inputs.find((p) => p.accessibilityLabel === '등록 요청 이름');
  const assertBlocked = async () => {
    const submit = button('등록하기');
    assert.equal(submit.disabled, true);
    submit.onPress(); await settle();
    assert.equal(calls, 0, 'Unavailable prerequisites must not submit even through a stale handler');
  };

  // A registration request is not a Pick. No one-line Pick review is collected
  // before approval.
  assert.doesNotMatch(render(), /한 줄 이유|원픽 한줄평/);

  render(); nameInput().onChangeText('  수정한   라면  ');
  auth.error = new Error('session unavailable');
  assert.match(render(), /로그인 상태를 확인하지 못했어요/);
  assert.equal(inputs.length, 0); press('로그인 상태 다시 확인'); assert.equal(sessionRetries, 1);
  auth.error = null; render(); assert.equal(nameInput().value, '  수정한   라면  ');

  categories.isError = true;
  assert.match(render(), /선택한 종류를 확인하지 못했어요/);
  await assertBlocked(); press('종류 다시 확인하기'); assert.equal(categoryRetries, 1);
  categories.isError = false; categories.data = [];
  assert.match(render(), /선택한 콘텐츠 종류를 사용할 수 없어요/); await assertBlocked();
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
  render(); press('등록하기'); press('등록하기');
  assert.equal(calls, 1, 'Two taps before a rerender send exactly one request');
  assert.equal(payload.itemName, '수정한 라면');
  assert.equal(payload.categoryId, category.id);
  assert.equal(payload.photo, null);
  assert.equal(payload.oneLineReview, undefined, 'The request carries no Pick review intent');
  mutation.isPending = true; render();
  assert.equal(nameInput().editable, false);
  assert.equal(presses.find((p) => p.accessibilityLabel === '돌아가기').disabled, true);
  rejectRequest(new Error('offline')); await settle();
  mutation.isPending = false; mutation.isError = true; mutation.error = new Error('offline');
  assert.match(render(), /등록하지 못했어요. 다시 시도해주세요/);
  assert.equal(nameInput().value, '  수정한   라면  ', 'A failed request keeps the edited draft');
  outcome = async () => ({ type: 'pending_item', item: { id: 'pending-ramen', name: '수정한 라면' } });
  press('등록하기'); await settle();
  assert.equal(calls, 2, 'Failure releases the in-flight guard for retry');
  const done = render();
  assert.match(done, /등록 요청을 보냈어요/);
  assert.match(done, /승인돼도 원픽으로 자동 등록되거나 승인 알림이 오지 않아요/, 'The user is told approval requires an explicit later Pick');
  press('내 등록 요청 보기');
  assert.equal(destination, '/(tabs)/(profile)/profile', 'A pending request leads directly to its status in My Profile');
  press('홈으로 돌아가기');
  assert.equal(destination, '/');

  // If the request races with an already-approved catalog item, do not show a
  // fake request receipt and do not auto-pick it. Open the item for explicit choice.
  state = []; mutation.isError = false; mutation.error = null;
  outcome = async () => ({ type: 'available_item', item: { id: 'available-ramen', name: '이미 등록된 라면' } });
  render(); press('등록하기'); await settle();
  assert.equal(destination.pathname, '/item/[itemId]');
  assert.equal(destination.params.itemId, 'available-ramen');

  state = []; render();
  press('사진 고르기'); await settle(); render();
  assert.equal(button('등록하기').disabled, false, 'A chosen photo can be sent without a separate confirmation step');
  assert.doesNotMatch(render(), /이 제품의 사진이 맞으며|체크해주세요/, 'No consent checkbox is rendered');
  chosenPhoto = null;
  press('다른 사진 고르기'); await settle(); render();
  button('사진 빼기');
  assert.equal(button('등록하기').disabled, false, 'Cancelling the picker keeps the chosen photo');
  nameInput().onChangeText('사진 있는 라면'); render();
  assert.equal(button('등록하기').disabled, false, 'Changing the name keeps the photo ready to send');
  picker.isPending = true; render();
  assert.equal(button('등록하기').disabled, true, 'Submitting is blocked during photo preparation');
  assert.equal(nameInput().editable, false);
  picker.isPending = false;
  outcome = async () => { throw new AppError('PHOTO_UPLOAD_FAILED'); };
  render(); press('등록하기'); await settle();
  assert.equal(payload.photo, draft, 'The actual request carries the selected image');
  mutation.isError = true; mutation.error = new AppError('PHOTO_UPLOAD_FAILED');
  assert.match(render(), /사진 파일은 정상적으로 읽었지만 서버에 저장하지 못했어요/);
  button('사진 빼기'); assert.equal(button('등록하기').disabled, false, 'Upload failure preserves photo for retry');
  press('사진 빼기'); render();
  assert.equal(button('등록하기').disabled, false, 'Image-free requests remain supported');
  inputs.find((p) => p.accessibilityLabel === '대표 이미지 링크').onChangeText('https://maker.example/ramen');
  render(); press('링크에서 이미지 가져오기'); await settle(); render();
  assert.equal(importedUrl, 'https://maker.example/ramen');
  assert.equal(button('등록하기').disabled, false, 'Imported images are ready to send immediately');
  outcome = async () => ({ type: 'pending_item', item: { id: 'pending-photo', name: '사진 있는 라면' } });
  press('등록하기'); await settle();
  assert.equal(payload.photo.sourceUrl, importedUrl, 'Source attribution reaches the existing registration service');
  assert.match(render(), /등록 요청을 보냈어요/);

  state = []; auth.user = null; profile.data = undefined; profile.isPending = true;
  const beforeLogin = calls;
  render();
  const beforePicker = pickerCalls;
  press('로그인하고 사진 추가');
  assert.equal(pickerCalls, beforePicker, 'Sign in before choosing a photo so OAuth cannot lose the file draft');
  assert.equal(destination.params.action, 'request_item');
  press('로그인하고 등록하기');
  assert.equal(calls, beforeLogin);
  assert.equal(destination.pathname, '/auth/login');
  assert.equal(destination.params.action, 'request_item');
  assert.equal(destination.params.itemName, params.itemName);
  assert.equal(destination.params.categoryId, category.id);
  assert.equal(destination.params.oneLineReview, undefined, 'Login return carries no pre-approval Pick review');

  // Link-first online requests keep the source URL attached to the caller's pending item.
  state = []; auth.user = { id: 'owner' }; profile.data = { currentPicks: [] }; profile.isPending = false; profile.isError = false; profile.error = null;
  categories.isError = false; categories.data = [category]; attachedPendingLink = undefined;
  params = { categoryId: category.id, itemName: '온라인 라면', sourceUrl: 'https://shop.example/ramen' };
  outcome = async () => ({ type: 'pending_item', item: { id: 'pending-online', name: '온라인 라면' } });
  const onlinePage = render();
  assert.match(onlinePage, /원본 링크\(shop\.example\)가 함께 저장돼 관리자 검수에 사용돼요/,
    'The user sees which host will be attached before submitting');
  press('등록하기'); await settle();
  assert.equal(attachedPendingLink.itemId, 'pending-online');
  assert.equal(attachedPendingLink.url, 'https://shop.example/ramen');
  assert.match(render(), /등록 요청을 보냈어요/);

  // 온라인 restaurant requests (channel=online) require the seller link and reject delivery apps.
  state = []; attachedPendingLink = undefined; mutation.isError = false; mutation.error = null;
  params = { categoryId: category.id, itemName: '곰탕 온라인몰', channel: 'online' };
  outcome = async () => ({ type: 'pending_item', item: { id: 'pending-seller', name: '곰탕 온라인몰' } });
  const sellerLink = () => inputs.find((p) => p.accessibilityLabel === '온라인 판매처 링크');
  let sellerPage = render();
  assert.match(sellerPage, /온라인 판매처 등록 요청/);
  assert.ok(sellerLink(), 'Online requests ask for the seller link');
  assert.equal(button('등록하기').disabled, true, 'An online request cannot be sent without a seller link');
  sellerLink().onChangeText('https://s.baemin.com/store/123'); sellerPage = render();
  assert.match(sellerPage, /배달앱 링크는 매장 원픽이에요/);
  assert.equal(button('등록하기').disabled, true, 'Delivery-app links are rejected before submit');
  sellerLink().onChangeText('http://shop.example/gomtang'); sellerPage = render();
  assert.match(sellerPage, /https:\/\/로 시작하는 판매처 링크/);
  assert.equal(button('등록하기').disabled, true);
  sellerLink().onChangeText('https://smartstore.example/gomtang'); sellerPage = render();
  assert.match(sellerPage, /원본 링크\(smartstore\.example\)가 함께 저장돼/);
  press('등록하기'); await settle();
  assert.equal(attachedPendingLink.itemId, 'pending-seller');
  assert.equal(attachedPendingLink.url, 'https://smartstore.example/gomtang', 'The typed seller link is attached for admin review');

  // A signed-out online request carries the channel and seller link through login.
  state = []; auth.user = null;
  params = { categoryId: category.id, itemName: '곰탕 온라인몰', channel: 'online', sourceUrl: 'https://smartstore.example/gomtang' };
  render(); press('로그인하고 등록하기');
  assert.equal(destination.pathname, '/auth/login');
  assert.equal(destination.params.channel, 'online');
  assert.equal(destination.params.sourceUrl, 'https://smartstore.example/gomtang');
  auth.user = { id: 'owner' };

  // Ordinary products do not ask the user for a category. Even if the category
  // list is temporarily unavailable, the product-name request can still proceed.
  state = []; auth.user = { id: 'owner' }; profile.data = { currentPicks: [] }; profile.isPending = false; profile.isError = false; profile.error = null;
  categories.isError = true; params = { itemName: '새 텀블러' }; mutation.isError = false; mutation.error = null;
  outcome = async () => ({ type: 'pending_item', item: { id: 'general-pending', name: '새 텀블러' } });
  const generalPage = render();
  assert.match(generalPage, /이름만 등록하면 돼요/);
  assert.doesNotMatch(generalPage, /카테고리를 불러오지 못했어요|선택한 종류를 확인하지 못했어요/);
  press('등록하기'); await settle();
  assert.equal(payload.itemName, '새 텀블러');
  assert.equal(payload.categoryId, undefined, 'General product requests are staged without a user-selected category');

  const aiPage = render();
  assert.equal(suggestionItemId, 'general-pending');
  assert.equal(applyItemId, 'general-pending');
  assert.match(aiPage, /AI가 카테고리를 추천했어요/);
  assert.match(aiPage, /AI의 추천은 자동으로 적용되지 않아요/);
  assert.equal(appliedCategoryId, undefined, 'AI suggestions never apply automatically');

  press('먹을것 › 라면'); render();
  assert.equal(appliedCategoryId, undefined, 'Selecting a suggestion still does not mutate the item');
  press('이 카테고리로 정하기'); await settle();
  assert.equal(appliedCategoryId, 'ramen', 'Only the explicit apply action writes the category');
  assert.match(render(), /카테고리를 적용했어요/);

  state = []; appliedCategoryId = undefined; suggestionQuery.isError = true; suggestionQuery.data = undefined;
  params = { itemName: '새 제품' }; outcome = async () => ({ type: 'pending_item', item: { id: 'general-pending', name: '새 제품' } });
  render(); press('등록하기'); await settle();
  assert.match(render(), /AI 추천을 불러오지 못했어요/);
  press('AI 추천 다시 받기'); assert.equal(categorySuggestionRetries, 1);
  press('카테고리는 나중에 정하기'); assert.equal(destination, '/(tabs)/(profile)/profile', 'AI failure never blocks the saved product request');

  const hintInput = () => inputs.find((p) => p.accessibilityLabel === '원하는 카테고리');
  assert.equal(hintItemId, 'general-pending', 'The hint targets the staged request');
  assert.equal(hintUserId, 'owner');
  assert.equal(hintInput(), undefined, 'The hint field stays collapsed until requested');
  press('카테고리 직접 적기'); render();
  assert.equal(button('카테고리 힌트 보내기').disabled, true, 'An empty hint cannot be sent');
  hintInput().onChangeText('  텀블러 /  보온병 '); render();
  assert.match(render(), /9\/60/, 'The counter reflects the normalized hint length');
  hintOutcome = async () => { throw new AppError('CATEGORY_LABEL_INVALID'); };
  press('카테고리 힌트 보내기'); await settle();
  assert.equal(sentHint, '텀블러 / 보온병', 'The hint is sent with collapsed whitespace');
  hintMutation.isError = true; hintMutation.error = new AppError('CATEGORY_LABEL_INVALID');
  assert.match(render(), /1~60자로 적어주세요/);
  assert.equal(hintInput().value, '  텀블러 /  보온병 ', 'A failed hint keeps the typed text');
  hintMutation.isError = false; hintMutation.error = null; hintOutcome = async (label) => label;
  press('카테고리 힌트 보내기'); await settle();
  const hintDone = render();
  assert.match(hintDone, /카테고리 힌트를 남겼어요/);
  assert.match(hintDone, /텀블러 \/ 보온병/);
  assert.equal(hintItemId, undefined, 'A saved hint stops further classification queries');
  press('내 등록 요청 보기'); assert.equal(destination, '/(tabs)/(profile)/profile');

  // Applying a category that matches an existing product resolves the request;
  // show that product so the member can choose it explicitly.
  state = []; suggestionQuery.isError = false;
  suggestionQuery.data = { itemId: 'general-pending', suggestions: [{ categoryId: 'ramen', label: '먹을것 › 라면', reason: '가까운 분류', confidence: 'high' }],
    categories: [{ categoryId: 'ramen', label: '먹을것 › 라면' }], needsNewCategory: false, reused: false };
  params = { itemName: '새 제품' }; outcome = async () => ({ type: 'pending_item', item: { id: 'general-pending', name: '새 제품' } });
  applyOutcome = () => ({ type: 'existing_item', itemId: 'existing-ramen', categoryId: 'ramen' });
  render(); press('등록하기'); await settle(); render();
  press('먹을것 › 라면'); render(); press('이 카테고리로 정하기'); await settle();
  assert.equal(destination.pathname, '/item/[itemId]');
  assert.equal(destination.params.itemId, 'existing-ramen');

  console.log('Item request checks passed: fixed content categories, category-free product requests, user-applied AI categories, free-text category hints, photos and recovery routes.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
