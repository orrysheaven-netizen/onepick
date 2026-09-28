// 원픽 등록 6단계 (매장 → 메뉴 → 링크 → 사진 → 한줄평 → 완료): the real screen
// with stubbed data hooks. Checks step order, skipped steps, what each step
// sends, and that the typed review survives moving between steps.
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
    if (name in imports) return imports[name];
    if (name === 'react/jsx-runtime') return require(name);
    assert.fail(`Unexpected dependency: ${name}`);
  } });
  return exports;
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const part = (tag) => ({ children }) => React.createElement(tag, null, children);
const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';
const { AppError } = load('errors/appError.ts');

let states, index, pressables, inputs, photoSteps, destination;
const native = {
  View: part('div'), Text: part('span'), ScrollView: part('main'), Modal: part('div'), ActivityIndicator: () => null,
  Platform: { OS: 'ios' },
  Image: (props) => React.createElement('img', { alt: props.accessibilityLabel }),
  TextInput: (props) => { inputs.push(props); return React.createElement('input', { 'aria-label': props.accessibilityLabel, placeholder: props.placeholder }); },
  Pressable: (props) => { pressables.push(props); return React.createElement('button', null, typeof props.children === 'function' ? props.children({ pressed: false }) : props.children); },
  StyleSheet: { create: (styles) => styles },
};
const fakeReact = { ...React,
  useState: (initial) => {
    const i = index++;
    if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
    return [states[i], (value) => { states[i] = typeof value === 'function' ? value(states[i]) : value; }];
  },
  useMemo: (compute) => compute(),
  useRef: (initial) => ({ current: initial }),
};
const ui = require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } });
const pickChannel = load('lib/items/pickChannel.ts');
const service = load('services/storeFirstService.ts', {
  '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
  '@/lib/supabase/client': { supabase: {} },
});

// ---- stubbed data layer -------------------------------------------------------
let auth, results, menuOptions, aiResult, detail, calls;
const mutation = (name, run) => ({ isPending: false, isError: false, error: null, reset() {},
  mutateAsync: async (input) => { calls.push([name, input]); return run(input); } });
let selectResult = { itemId: 'item-1', categoryId: 'cat-naengmyeon' };
let registerResult = { type: 'pending_item', item: { id: 'pending-1', name: '새 냉면집' } };
const hooks = {
  store: {
    useStoreSearch: (channel, query, enabled) => ({ data: enabled && query.trim() ? results[channel] : [], valid: enabled && query.trim().length > 0,
      isWaiting: false, isFetching: false, isError: false, refetch() {} }),
    useMenuOptions: () => ({ data: menuOptions, isSuccess: true, isError: false, refetch() {} }),
    useMenuSuggestions: (store, key, menuName, enabled) => ({ data: enabled && menuName.trim() ? aiResult : undefined, isPending: !enabled, isFetching: false, isError: false }),
    useSelectStoreItem: () => mutation('select', () => selectResult),
    useSuggestMapLink: () => mutation('link', () => undefined),
    useSetMenuHint: () => mutation('menuHint', () => undefined),
  },
};
const { default: Screen } = load('app/pick/new.tsx', {
  react: fakeReact, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: part('section') },
  'expo-router': {
    useLocalSearchParams: () => ({}),
    useRouter: () => ({ push: (route) => { destination = route; }, replace: (route) => { destination = route; }, setParams() {}, back() {}, canGoBack: () => true }),
  },
  '@/components/pick-photo-step': { PickPhotoStep: (props) => { photoSteps.push(props); return React.createElement('aside', null, 'PHOTO-STEP'); } },
  '@/components/ui': ui, '@/errors/appError': { AppError },
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useChoosePick': {
    useChoosePick: () => mutation('choose', (input) => ({ id: 'pick-1', itemId: input.itemId })),
    useRequestPendingPick: () => mutation('requestPick', (input) => input.oneLineReview),
  },
  '@/hooks/useItemDetail': { useItemDetail: (itemId) => ({ data: itemId ? detail : undefined, refetch: async () => {} }) },
  '@/hooks/useMyProfile': { useMyProfile: () => ({ data: { currentPicks: [] }, isSuccess: true, isPending: false, isError: false }) },
  '@/hooks/useLinkCategorySuggestions': { useAttachPendingItemLink: () => mutation('sellerLink', () => undefined) },
  '@/hooks/useRegisterPick': {
    useChoosePhoto: () => mutation('choosePhoto', () => ({ uri: 'data:image/jpeg;base64,eA==', base64: 'eA==' })),
    useRegisterPick: () => mutation('register', () => registerResult),
  },
  '@/hooks/useStoreFirst': hooks.store,
  '@/lib/items/pickChannel': pickChannel,
  '@/lib/photos/photoFailure': { showPhotoFailure() {}, isPhotoFailure: () => false },
  '@/lib/pick/pickDraftSession': { readPickReviewDraft: () => '', writePickReviewDraft() {}, clearPickReviewDraft() {} },
  '@/services/onboardingService': { onboardingService: { recordAction: async () => {} } },
  '@/services/storeFirstService': service,
});

function reset() {
  states = []; calls = []; destination = undefined;
  auth = { user: { id: 'owner' }, isLoading: false, error: null };
  results = {
    offline: [
      { kind: 'place', catalogId: 'cat-1', name: '을밀대', branchName: null, region: '서울 마포구', address: '숭문길 24', providerCategory: '국수/칼국수', mapUrl: null },
      { kind: 'place', catalogId: 'cat-2', name: '우래옥', branchName: null, region: '서울 중구', address: null, providerCategory: '백반/한정식', mapUrl: 'https://naver.me/wooraeok' },
    ],
    online: [{ kind: 'seller', providerId: 'prov-1', name: '곰탕몰', host: 'gomtang.example.com', officialUrl: 'https://gomtang.example.com/' }],
  };
  menuOptions = [
    { categoryId: 'cat-naengmyeon', name: '평양냉면', groupName: '면', placeEnabled: true },
    { categoryId: 'cat-suyuk', name: '수육', groupName: '고기', placeEnabled: true },
    { categoryId: 'cat-gomtang', name: '곰탕', groupName: '국', placeEnabled: false },
  ];
  aiResult = { suggestions: [{ categoryId: 'cat-naengmyeon', label: '면 › 평양냉면', reason: '평양냉면으로 유명한 곳이에요', confidence: 'high' }], needsNewCategory: false };
  detail = { item: { id: 'item-1', imagePath: null, imageUrl: null, thumbnailUrl: null, imageSourceUrl: null }, myPickStatus: { type: 'not_selected' } };
}
function render() {
  index = 0; pressables = []; inputs = []; photoSteps = [];
  return renderToStaticMarkup(React.createElement(Screen));
}
function press(label) {
  const found = pressables.find((props) => props.accessibilityLabel === label || textOf(props.children) === label || textOf(props.children).includes(label));
  assert.ok(found, `Expected control: ${label}`);
  assert.ok(!found.disabled, `Control is disabled: ${label}`);
  return found.onPress();
}
const input = (label) => { const found = inputs.find((props) => props.accessibilityLabel === label); assert.ok(found, `Expected input: ${label}`); return found; };
const step = (page) => /(\d) \/ 6/.exec(page)?.[1];

async function main() {
  // Signed out: login keeps the registration intent.
  reset(); auth.user = null;
  let page = render();
  assert.match(page, /로그인하고 원픽을 등록해보세요/);
  press('로그인');
  assert.equal(destination.pathname, '/auth/login');
  assert.equal(destination.params.action, 'store_pick');

  // Figma 75-1: store search is step 2/6 and uses the v6 copy/result-card flow.
  reset();
  page = render();
  assert.equal(step(page), '1');
  assert.match(page, /어디에서 고른 원픽인가요/);
  press('매장'); page = render();
  assert.equal(step(page), '2');
  assert.match(page, /새 원픽 등록/);
  assert.match(page, /상호명을 검색해 주세요/);
  assert.match(page, /오프라인 매장/);
  input('매장명 검색').onChangeText('을밀대');
  page = render();
  assert.match(page, /검색 결과 2개 · 지점과 주소를 확인해 주세요/);
  assert.match(page, /서울 마포구 · 상세 주소 표시/);
  assert.match(page, /찾는 매장이 없어요/);

  // Existing store -> Figma 75-2/4: menu/category is step 4/6. Existing exact menu skips AI.
  press('을밀대 선택');
  page = render();
  assert.equal(step(page), '4');
  assert.match(page, /어떤 메뉴인가요/);
  assert.match(page, /매장에서 부르는 메뉴 이름 그대로 적어 주세요/);
  input('메뉴 이름').onChangeText('평양냉면');
  page = render();
  assert.doesNotMatch(page, /AI 추천/, 'An exact catalog menu must not call AI');
  press('면 › 평양냉면');
  page = render();
  const exactNext = pressables.find((props) => props.accessibilityLabel === '다음');
  assert.ok(exactNext, 'Exact menu shows the next button');
  assert.equal(exactNext.disabled, false, 'Disabled AI query must not block next after an exact menu is selected');
  press('다음'); await flush();
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(['select', { categoryId: 'cat-naengmyeon', store: results.offline[0] }]));

  // Existing stores do not get a new-store link step in v6; no photo means step 5.
  page = render();
  assert.equal(step(page), '5');
  assert.equal(photoSteps.length, 1);
  assert.equal(photoSteps[0].itemId, 'item-1');
  press('사진 없이 계속');
  page = render();
  assert.equal(step(page), '6');
  assert.match(page, /한줄평을 남겨주세요/);
  input('원픽 한줄평').onChangeText('육수가 깔끔해요');
  page = render();
  assert.ok(page.includes('8 / 100자'));
  press('원픽 등록하기'); await flush();
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(['choose', {
    categoryId: 'cat-naengmyeon', itemId: 'item-1', oneLineReview: '육수가 깔끔해요', channel: 'offline',
  }]));
  page = render();
  assert.match(page, /원픽을 정했어요/);
  assert.match(page, /을밀대 평양냉면이 내 원픽이 됐어요/);
  press('확인');
  assert.equal(destination.pathname, '/item/[itemId]');
  assert.equal(destination.params.pickId, 'pick-1');

  // Figma 75-3/4: submitting a new menu starts AI; its full category paths are selectable.
  reset();
  selectResult = { itemId: 'item-ai', categoryId: 'cat-naengmyeon', hasPhoto: true };
  render(); press('매장'); render(); input('매장명 검색').onChangeText('우래옥'); render(); press('우래옥 선택'); render();
  input('메뉴 이름').onChangeText('평양물냉'); render();
  input('메뉴 이름').onSubmitEditing(); // deterministic stand-in for the 450ms production debounce.
  page = render();
  assert.match(page, /카테고리 · AI 추천/);
  assert.match(page, /면 › 평양냉면/);
  assert.match(page, /평양냉면으로 유명한 곳이에요/, 'The first usable AI suggestion is preselected');
  const aiNext = pressables.find((props) => props.accessibilityLabel === '다음');
  assert.ok(aiNext, 'AI recommendation shows the next button');
  assert.equal(aiNext.disabled, false, 'A preselected AI recommendation can continue without another tap');
  press('다음'); await flush();
  page = render();
  assert.equal(step(page), '6', 'Known photo skips directly from menu to review');
  input('원픽 한줄평').onChangeText('시원한 육수가 좋아요'); render();
  press('원픽 등록하기'); await flush();
  assert.equal(calls.filter(([name]) => name === 'register').length, 0, 'A usable AI category avoids admin intervention');

  // Figma 75-5: low confidence or failed AI falls back to searchable manual categories, with admin as the last option.
  reset();
  aiResult = { suggestions: [{ categoryId: 'cat-suyuk', label: '고기 › 저신뢰추천', reason: '확신이 낮아요', confidence: 'low' }], needsNewCategory: false };
  render(); press('매장'); render(); input('매장명 검색').onChangeText('을밀대'); render(); press('을밀대 선택'); render();
  input('메뉴 이름').onChangeText('할머니 비법 국수'); render();
  input('메뉴 이름').onSubmitEditing();
  page = render();
  assert.match(page, /카테고리를 추천하지 못했어요. 가까운 것을 직접 골라 주세요/);
  assert.ok(input('카테고리 검색'));
  assert.doesNotMatch(page, /저신뢰추천/);
  assert.match(page, /맞는 카테고리가 없어요/);
  press('맞는 카테고리가 없어요');
  page = render();
  assert.equal(step(page), '5', 'Admin fallback is the final option and continues to photo/review');

  // A truly new offline store asks for its map link before the menu, matching the v6 flow note.
  reset();
  render(); press('매장'); render(); input('매장명 검색').onChangeText('새 냉면집'); render();
  press('찾는 매장이 없어요'); page = render();
  assert.equal(input('등록 요청 이름').value, '새 냉면집');
  press('다음'); page = render();
  assert.equal(step(page), '3');
  input('네이버 지도 링크').onChangeText('https://naver.me/newstore'); render();
  press('다음'); await flush();
  assert.equal(calls.filter(([name]) => name === 'link').length, 0, 'New-store link waits for the item request to exist');
  page = render();
  assert.equal(step(page), '4');
  input('메뉴 이름').onChangeText('평양냉면'); render(); press('면 › 평양냉면'); render(); press('다음'); await flush();
  page = render(); assert.equal(step(page), '5');
  press('사진 선택'); await flush(); render(); press('다음'); render();
  input('원픽 한줄평').onChangeText('면이 좋아요'); render();
  press('원픽 등록하기'); await flush();
  const registered = calls.find(([name]) => name === 'register')[1];
  assert.equal(registered.categoryId, 'cat-naengmyeon');
  assert.equal(registered.itemName, '새 냉면집');
  assert.equal(registered.oneLineReview, '면이 좋아요');
  assert.equal(registered.channel, 'offline');
  assert.ok(registered.photo);
  assert.equal(JSON.stringify(calls.find(([name]) => name === 'link')), JSON.stringify(['link', { itemId: 'pending-1', url: 'https://naver.me/newstore' }]));
  page = render();
  assert.match(page, /등록 요청을 보냈어요/);

  // Online seller keeps the same six-step contract but has no map-link step.
  reset();
  selectResult = { itemId: 'item-1', categoryId: 'cat-gomtang', hasPhoto: false };
  render(); press('온라인'); render();
  input('판매처 이름 검색').onChangeText('곰탕'); render(); press('곰탕몰 선택'); render();
  assert.equal(step(render()), '4');
  input('메뉴 이름').onChangeText('곰탕'); render(); press('국 › 곰탕'); render(); press('다음'); await flush();
  page = render(); assert.equal(step(page), '5');
  press('사진 없이 계속'); render();
  input('원픽 한줄평').onChangeText('택배로도 진해요'); render();
  press('원픽 등록하기'); await flush();
  assert.equal(calls.find(([name]) => name === 'choose')[1].channel, 'online');

  // Pending catalog item goes straight to review and preserves the typed menu hint.
  reset();
  selectResult = { itemId: 'item-1', categoryId: 'cat-suyuk', hasPhoto: false, pending: true };
  render(); press('매장'); render(); input('매장명 검색').onChangeText('우래옥'); render(); press('우래옥 선택'); render();
  input('메뉴 이름').onChangeText('수육'); render(); press('고기 › 수육'); render(); press('다음'); await flush();
  page = render();
  assert.equal(step(page), '6');
  assert.match(page, /등록 확인이 필요한 경우/);
  input('원픽 한줄평').onChangeText('수육이 부드러워요'); render();
  press('원픽 등록하기'); await flush();
  assert.equal(JSON.stringify(calls.find(([name]) => name === 'requestPick')), JSON.stringify(['requestPick', { itemId: 'item-1', oneLineReview: '수육이 부드러워요' }]));
  assert.equal(JSON.stringify(calls.find(([name]) => name === 'menuHint')), JSON.stringify(['menuHint', { userId: 'owner', itemId: 'item-1', label: '수육' }]));
  page = render();
  assert.match(page, /등록 요청을 보냈어요/);

  // Service-side Naver link validation still mirrors the DB rule.
  for (const ok of ['https://naver.me/abc', 'https://map.naver.com/p/entry/place/1', 'https://m.place.naver.com/restaurant/1']) assert.ok(service.isNaverMapUrl(ok), ok);
  for (const bad of ['http://naver.me/abc', 'https://naver.me.evil.com/x', 'https://blog.naver.com/x', 'https://naver.me/a b']) assert.ok(!service.isNaverMapUrl(bad), bad);

  console.log('Store-first v6 checks passed: Figma 75 copy/steps, exact menu query state, AI category preselection, manual fallback, new-store link order, photo/review, online, and completion dialog.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
