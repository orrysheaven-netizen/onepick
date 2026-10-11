// Choosing a pick for an item without a photo: the required photo step comes
// first and stays on this screen, no pick is saved before it, and the review
// typed after it survives a photo upload.
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
    // Pure channel helpers of the choose screen load as-is.
    if (name === '@/lib/home/homeChannels') return load('lib/home/homeChannels.ts');
    if (name === '@/lib/items/pickSavedToast') return load('lib/items/pickSavedToast.ts');
    if (name === '@/lib/items/pickChannel') return load('lib/items/pickChannel.ts');
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

let states, stateIndex, buttons, inputs, photoStep, photoCards, destinations;
const native = {
  View: part('div'), Text: part('span'), ScrollView: part('main'), ActivityIndicator: () => null,
  Image: (props) => React.createElement('img', { alt: props.accessibilityLabel }),
  TextInput: (props) => { inputs.push(props); return null; },
  Pressable: (props) => { buttons.push(props); return React.createElement('button', null, props.children); },
  StyleSheet: { create: (styles) => styles },
};
const fakeReact = { ...React,
  useState: (initial) => {
    const index = stateIndex++;
    const owner = states;
    if (!(index in owner)) owner[index] = typeof initial === 'function' ? initial() : initial;
    return [owner[index], (value) => { owner[index] = typeof value === 'function' ? value(owner[index]) : value; }];
  },
  useMemo: (compute) => compute(),
  useRef: (initial) => ({ current: initial ?? { focus() {} } }),
};
const PickPhoto = (props) => { photoCards.push(props); return null; };
const PickPhotoStep = (props) => { photoStep = props; return React.createElement('aside', null, 'PHOTO-STEP'); };
const ui = require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto } });

let auth, query, refetches, saves;
const { default: Choose } = load('app/pick/choose.tsx', {
  react: fakeReact,
  'expo-router': { useLocalSearchParams: () => ({ itemId, categoryId }), useRouter: () => ({
    replace: (route) => destinations.push(route), push: (route) => destinations.push(route), back() {}, canGoBack: () => false,
  }) },
  'react-native': native, 'react-native-safe-area-context': { SafeAreaView: part('section') },
  '@/components/pick-photo': { PickPhoto }, '@/components/pick-photo-step': { PickPhotoStep }, '@/errors/appError': { AppError },
  '@/components/ui': ui,
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useItemDetail': { useItemDetail: () => query },
  '@/hooks/useChoosePick': { useChoosePick: () => ({ isPending: false, isError: false, error: null,
    mutateAsync: async (input) => { saves.push(input); return { id: 'pick-1', itemId, userId: 'owner', oneLineReview: input.oneLineReview }; } }),
  useRequestPendingPick: () => ({ isPending: false, error: null }) },
});

function arrange(item, status = { type: 'not_selected' }) {
  auth = { user: { id: 'owner' }, isLoading: false, error: null, retry() {} };
  refetches = 0; saves = [];
  query = { isPending: false, isError: false, isFetching: false, refetch: async () => { refetches++; },
    data: { item: { id: itemId, categoryId, name: '을밀대', status: 'active', imagePath: null, imageUrl: null, thumbnailUrl: null, imageSourceUrl: null, ...item },
      canChoose: true, myPickStatus: status } };
  states = []; destinations = [];
}
function render() {
  stateIndex = 0; buttons = []; inputs = []; photoStep = undefined; photoCards = [];
  return renderToStaticMarkup(Choose());
}
const review = () => inputs.find((props) => props.accessibilityLabel === '원픽 한줄평');
const submit = (label = '내 원픽으로 고르기') => buttons.find((props) => textOf(props.children).includes(label));

async function main() {
  // 1. No photo yet: the photo step is shown first, then the numbered review.
  arrange({});
  let page = render();
  assert.ok(photoStep, 'An item without a photo starts with the photo step');
  assert.equal(photoStep.itemId, itemId);
  assert.equal(photoStep.userId, 'owner');
  assert.ok(page.indexOf('PHOTO-STEP') < page.indexOf('2. 한줄평'), 'The photo step comes before the review');
  assert.ok(photoCards.length > 0 && photoCards.every((props) => props.itemId === undefined),
    'The card has no "사진 등록하기" shortcut that would leave this screen');

  // 2. The photo is required: with a valid review but no photo, the save button
  // is disabled and even a forced press saves nothing.
  review().onChangeText('평양냉면은 여기');
  page = render();
  assert.equal(submit().disabled, true, 'The save button is disabled before the photo is saved');
  assert.match(page, /사진을 먼저 등록하면 저장할 수 있어요/, 'The screen says the photo comes first');
  submit().onPress();
  await flush();
  assert.equal(saves.length, 0, 'No pick is saved for an item that still has no photo');
  assert.equal(destinations.length, 0, 'A blocked save never navigates');

  // 3. The review typed on this screen survives a photo saved in step 1.
  photoStep.onAttached({ ...query.data.item, imagePath: 'owner/p.jpg', imageUrl: 'https://img.example/p.jpg' });
  await flush();
  page = render();
  assert.equal(review().value, '평양냉면은 여기', 'Uploading the photo keeps the typed review');
  assert.equal(photoStep, undefined, 'The photo step closes once the item has a photo');
  assert.match(page, /2. 한줄평/, 'Step numbering stays after the photo is added');
  assert.ok(photoCards.some((props) => props.uri === 'https://img.example/p.jpg'), 'The new photo shows on the card at once');
  assert.equal(refetches, 1, 'The item detail is refreshed after the photo is saved');
  assert.equal(destinations.length, 0, 'Adding a photo never navigates away');
  assert.equal(submit().disabled, false, 'The save button turns on as soon as the photo is saved');
  assert.doesNotMatch(page, /사진을 먼저 등록하면 저장할 수 있어요/);
  submit().onPress();
  await flush();
  assert.equal(saves.length, 1, 'With the photo saved, the pick saves');
  assert.equal(saves[0].oneLineReview, '평양냉면은 여기');

  // 4. Items that already have a photo go straight to the review.
  arrange({ imagePath: 'x/y.jpg', imageUrl: 'https://img.example/y.jpg' });
  page = render();
  assert.equal(photoStep, undefined);
  assert.match(page, /한줄평/);
  assert.doesNotMatch(page, /2. 한줄평/);

  // 5. Switching another pick to a photo-less item is held to the same rule.
  arrange({}, { type: 'selected_other', pickId: 'p0', oneLineReview: '다른 이유' });
  render();
  review().onChangeText('이걸로 바꿀래요');
  render();
  assert.ok(photoStep, 'Switching to a photo-less item shows the photo step');
  assert.equal(submit('원픽 바꾸기').disabled, true, 'Switching is disabled before the photo is saved');
  submit('원픽 바꾸기').onPress();
  await flush();
  assert.equal(saves.length, 0, 'No switch is saved without a photo');

  // 6. Editing the review of the current pick does not ask for a photo.
  arrange({}, { type: 'selected_this', pickId: 'p1', oneLineReview: '기존 이유' });
  render();
  assert.equal(photoStep, undefined, 'Review edits skip the photo step');
  assert.equal(submit('한줄평 저장하기').disabled, false, 'Review edits stay allowed without a photo');
  submit('한줄평 저장하기').onPress();
  await flush();
  assert.equal(saves.length, 1, 'A review edit of a photo-less pick still saves');

  // The step component itself: choose → preview → upload → onAttached, on this screen.
  let attached, uploads = [];
  const draft = { uri: 'data:image/jpeg;base64,eA==', base64: 'eA==' };
  const picker = { isPending: false, isError: false, error: null, mutateAsync: async () => draft };
  const attachment = { isPending: false, isError: false, error: null, reset() {},
    mutateAsync: async (input) => { uploads.push(input); return { id: itemId, imagePath: 'owner/p.jpg' }; } };
  const stepStates = [];
  let stepIndex = 0;
  const { PickPhotoStep: RealStep } = load('components/pick-photo-step.tsx', {
    react: { ...React, useState: (initial) => { const i = stepIndex++; if (!(i in stepStates)) stepStates[i] = initial;
      return [stepStates[i], (v) => { stepStates[i] = v; }]; }, useRef: (initial) => ({ current: initial }) },
    'react-native': native, '@/components/ui': ui, '@/errors/appError': { AppError },
    '@/hooks/useRegisterPick': { useChoosePhoto: () => picker, useAttachItemPhoto: () => attachment },
    '@/lib/photos/photoFailure': { showPhotoFailure() {} },
  });
  const renderStep = () => { stepIndex = 0; buttons = []; return renderToStaticMarkup(React.createElement(RealStep, { userId: 'owner', itemId, onAttached: (item) => { attached = item; } })); };
  let stepPage = renderStep();
  assert.match(stepPage, /1\. 대표 사진/);
  assert.match(stepPage, /1\. 대표 사진 <span>필수<\/span>/, 'The photo step is marked required');
  assert.match(stepPage, /사진을 등록해야 원픽을 저장할 수 있어요/);
  assert.doesNotMatch(stepPage, /사진이 없어도|사진 없이 계속/, 'Nothing suggests going on without a photo');
  buttons.find((props) => textOf(props.children).includes('사진 고르기')).onPress();
  await flush();
  stepPage = renderStep();
  assert.match(stepPage, /선택한 대표 이미지 미리보기/);
  buttons.find((props) => textOf(props.children).includes('이 사진 등록하기')).onPress();
  await flush();
  assert.equal(JSON.stringify(uploads), JSON.stringify([{ userId: 'owner', itemId, photo: draft }]), 'The chosen photo is uploaded for this item');
  assert.equal(attached.imagePath, 'owner/p.jpg', 'The saved item is handed back to the choose screen');

  console.log('Choose photo-first checks passed: required photo step before the review, no save without a photo, no navigation away, review kept across upload, skipped for items with photos and review edits, and the step uploads in place.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
