// Figma 75 store-first registration with the real screen and stubbed hooks.
// Public MVP flow is four steps: store -> menu -> photo -> review. The final
// write always uses the immediate register_item_pick mutation contract.
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
    if (name === '@/lib/pick/registrationFooterLayout') return load('lib/pick/registrationFooterLayout.ts');
    if (name === '@/components/ui/dialog-labels') return require('./dialog-labels.cjs');
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

let states, refs, stateIndex, refIndex, pressables, inputs, destination, uuidCounter, routeParams;
const native = {
  View: part('div'), Text: part('span'), ScrollView: part('main'), Modal: part('div'), ActivityIndicator: () => null,
  Image: (props) => React.createElement('img', { alt: props.accessibilityLabel }),
  TextInput: (props) => { inputs.push(props); return React.createElement('input', { 'aria-label': props.accessibilityLabel, placeholder: props.placeholder }); },
  Pressable: (props) => { pressables.push(props); return React.createElement('button', null, typeof props.children === 'function' ? props.children({ pressed: false }) : props.children); },
  StyleSheet: { create: (styles) => styles },
};
const fakeReact = { ...React,
  useState: (initial) => {
    const i = stateIndex++;
    if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
    return [states[i], (value) => { states[i] = typeof value === 'function' ? value(states[i]) : value; }];
  },
  useMemo: (compute) => compute(),
  useRef: (initial) => {
    const i = refIndex++;
    if (!(i in refs)) refs[i] = { current: initial };
    return refs[i];
  },
};
const ui = require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } });
const pickChannel = load('lib/items/pickChannel.ts');
const savedToast = load('lib/items/pickSavedToast.ts');
const service = load('services/storeFirstService.ts', {
  '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
  '@/lib/supabase/client': { supabase: {} },
});

let linkData, linkResponse, deferLink, finishLink;
let aiFailed = false, aiFetching = false;
let auth, results, menuOptions, aiResult, detail, calls, selectResult, registerRun, currentSlotRun, providerPrefill, storeSearchEnabled, routerBackCalls;
const mutation = (name, run) => ({ isPending: false, isError: false, error: null, reset() {},
  mutateAsync: async (input) => { calls.push([name, input]); return run(input); } });
const hooks = {
  useProviderStorePrefill: (providerId, enabled) => ({
    data: enabled && providerId ? providerPrefill : null,
    // TanStack Query v5: a never-run disabled query is pending, but not loading.
    isPending: !enabled,
    isLoading: false,
    isError: false,
  }),
  useStoreSearch: (channel, query, enabled) => {
    storeSearchEnabled = enabled;
    return { data: enabled && query.trim() ? results[channel] : [], valid: enabled && query.trim().length > 0,
      isWaiting: false, isFetching: false, isError: false, refetch() {} };
  },
  useMenuOptions: () => ({ data: menuOptions, isSuccess: true, isError: false, refetch() {} }),
  useMenuSuggestions: (store, key, menuName, enabled) => ({ data: enabled && menuName.trim() ? aiResult : undefined, isPending: !enabled, isFetching: aiFetching, isError: aiFailed, refetch: () => { calls.push(['reclassify', menuName]); } }),
  useSelectStoreItem: () => mutation('select', () => selectResult),
};

const { default: Screen } = load('app/pick/new.tsx', { '@/lib/navigation/swipeBack': { useSwipeBackHandler() {} },
  react: fakeReact, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: part('section'), useSafeAreaInsets: () => ({ bottom: 0 }) },
  'expo-crypto': { randomUUID: () => `request-${++uuidCounter}` },
  'expo-router': {
    useLocalSearchParams: () => routeParams,
    useRouter: () => ({ push: (route) => { destination = route; }, replace: (route) => { destination = route; }, back: () => { routerBackCalls += 1; }, canGoBack: () => true }),
  },
  '@/components/ui': ui, '@/errors/appError': { AppError },
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useItemDetail': { useItemDetail: (itemId) => ({ data: itemId ? detail : undefined, refetch: async () => {} }) },
  '@/hooks/useRegisterPick': {
    useChoosePhoto: () => mutation('choosePhoto', () => ({
      uri: 'data:image/jpeg;base64,eA==', base64: 'eA==', thumbnailBase64: 'eA==', uploadId: 'photo-1',
    })),
    useReadCurrentPickSlot: () => mutation('currentSlot', () => currentSlotRun()),
    useRegisterItemPick: () => mutation('register', (input) => registerRun(input)),
  },
  '@/hooks/useLinkCategorySuggestions': { useLinkCategorySuggestions: () => ({
    data: linkData, isPending: false, isError: false, isSuccess: linkData !== undefined, error: null,
    mutate: (input, options) => {
      calls.push(['link', input]);
      const result = linkResponse(input);
      const complete = () => { linkData = result; if (result) options?.onSuccess?.(result); };
      if (deferLink) finishLink = complete;
      else complete();
    },
    reset: () => { linkData = undefined; },
  }) },
  '@/hooks/useStoreFirst': hooks,
  '@/lib/items/pickChannel': pickChannel,
  '@/lib/items/pickSavedToast': savedToast,
  '@/lib/photos/photoFailure': { showPhotoFailure() {}, isPhotoFailure: () => false },
  // Draft persistence (#475) is covered by test-pick-draft-restore.cjs; in-memory here.
  '@/lib/pick/pickDraft': { pickDraftStore: () => ({ save: () => true, savePhoto: () => true, load: () => null, clear() {}, discardForOtherUser() {} }) },
  '@/services/storeFirstService': service,
});

const linkPlace = (catalogId, name, branchName) => ({ catalogId, name, branchName, roadAddress: '서울 강남구 테헤란로 1',
  address: null, region1: '서울', region2: '강남구', providerCategory: '카페' });
const linkResult = (url, resolvedName, places) => ({ kind: 'place', inputUrl: url, canonicalUrl: url, host: 'map.naver.com',
  title: resolvedName, description: null, resolvedName, needsName: !resolvedName, places, suggestions: [], categories: [] });
function reset() {
  aiFailed = false; aiFetching = false;
  linkData = undefined; linkResponse = () => undefined;
  deferLink = false; finishLink = undefined;
  states = []; refs = []; calls = []; destination = undefined; uuidCounter = 0; routeParams = {}; storeSearchEnabled = false; routerBackCalls = 0;
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
  selectResult = { itemId: 'item-1', categoryId: 'cat-naengmyeon', hasPhoto: false, pending: false };
  currentSlotRun = () => null;
  providerPrefill = {
    kind: 'place', catalogId: 'cat-prefill', name: '서울집', branchName: '성수점',
    region: '서울 성동구', address: '성수이로 1', providerCategory: '한식', mapUrl: 'https://naver.me/seoulzip',
  };
  registerRun = (input) => ({ itemId: input.itemId ?? 'created-item', pickId: 'pick-1', published: Boolean(input.itemId), replacedPickId: null, retried: false });
}
function render() {
  stateIndex = 0; refIndex = 0; pressables = []; inputs = [];
  return renderToStaticMarkup(React.createElement(Screen));
}
function press(label) {
  const found = pressables.find((props) => props.accessibilityLabel === label || textOf(props.children) === label || textOf(props.children).includes(label));
  assert.ok(found, `Expected control: ${label}`);
  assert.ok(!found.disabled, `Control is disabled: ${label}`);
  return found.onPress();
}
const input = (label) => { const found = inputs.find((props) => props.accessibilityLabel === label); assert.ok(found, `Expected input: ${label}`); return found; };
const step = (page) => /(\d) \/ 4/.exec(page)?.[1];
const openStoreSearch = () => {
  render();
  const fallback = pressables.find((props) => textOf(props.children) === 'URL 없음');
  if (fallback) { fallback.onPress(); render(); }
};

async function chooseExistingOffline(name = '을밀대', menu = '평양냉면', menuLabel = '면 › 평양냉면') {
  openStoreSearch(); input('매장명 검색').onChangeText(name); render(); press(`${name} 선택`); render();
  input('메뉴 이름').onChangeText(menu); render(); press('다음'); await flush();
}

async function main() {
  reset(); auth.user = null;
  let page = render();
  assert.match(page, /로그인하고 원픽을 등록해보세요/);
  press('로그인');
  assert.equal(destination.pathname, '/auth/login');
  assert.equal(destination.params.action, 'store_pick');
  assert.equal(destination.params.providerId, undefined);

  // Provider profile entry re-reads the ID and shows step 1 with a selected store until Next.
  reset();
  routeParams = { providerId: '11111111-1111-1111-1111-111111111111' };
  render(); // first render binds the account-owned draft scope
  page = render(); // validated provider context is available without asking for a link again
  assert.equal(input('매장명 검색').value, '서울집 성수점');
  assert.doesNotMatch(page, /네이버 지도 링크를 입력해주세요/);
  assert.match(page, /보고 있던 매장을 선택해 뒀어요/);
  assert.match(page, /서울집 · 성수점/);
  press('이전 단계'); page = render();
  assert.equal(routerBackCalls, 1, 'provider-context step 1 goes back to the provider profile');
  assert.doesNotMatch(page, /네이버 지도 링크를 입력해주세요/,
    'provider-context back does not insert the generic link-first screen');
  press('다음'); page = render();
  assert.equal(step(page), '2');

  // Clearing a validated provider prefill falls back to ordinary search.
  reset();
  routeParams = { providerId: '11111111-1111-1111-1111-111111111111' };
  render(); page = render();
  press('매장명 지우기'); page = render();
  input('매장명 검색').onChangeText('을밀대'); page = render();
  assert.equal(storeSearchEnabled, true, 'cleared provider prefill re-enables ordinary search');
  assert.match(page, /검색 결과 2개/);

  // Menu detail entry keeps step 1, then prefills menu/category after a store is chosen.
  reset();
  menuOptions = [
    { categoryId: '22222222-2222-2222-2222-222222222222', name: '라멘', groupName: '면', placeEnabled: true },
  ];
  selectResult = { itemId: 'item-ramen', categoryId: '22222222-2222-2222-2222-222222222222', hasPhoto: true, pending: false };
  routeParams = { menuName: '라멘', categoryId: '22222222-2222-2222-2222-222222222222' };
  openStoreSearch(); input('매장명 검색').onChangeText('을밀대'); render(); press('을밀대 선택'); page = render();
  assert.equal(step(page), '2');
  assert.equal(input('메뉴 이름').value, '라멘');
  assert.match(page, /매장 메뉴명으로 고쳐 써도 돼요/);
  assert.doesNotMatch(page, /카테고리는 앱이 자동으로 분류해요/);
  assert.match(page, /메뉴를 확인했어요/);
  input('메뉴 이름').onChangeText('쇼유라멘'); page = render();
  press('이전 단계'); page = render();
  input('매장명 검색').onChangeText('을밀대'); render(); press('을밀대 선택'); page = render();
  assert.equal(input('메뉴 이름').value, '쇼유라멘', 'edited prefilled menu survives back + reselecting the store');

  // Fresh menu-prefill path still accepts the validated category on first use.
  reset();
  menuOptions = [
    { categoryId: '22222222-2222-2222-2222-222222222222', name: '라멘', groupName: '면', placeEnabled: true },
  ];
  selectResult = { itemId: 'item-ramen', categoryId: '22222222-2222-2222-2222-222222222222', hasPhoto: true, pending: false };
  routeParams = { menuName: '라멘', categoryId: '22222222-2222-2222-2222-222222222222' };
  openStoreSearch(); input('매장명 검색').onChangeText('을밀대'); render(); press('을밀대 선택'); render();
  press('다음'); await flush();
  page = render(); assert.equal(step(page), '4', 'Existing photo skips the photo interaction from a valid menu prefill');

  // Public MVP starts at Naver link input; "URL 없음" is the explicit store-search fallback.
  // A disabled provider-prefill query is isPending=true in TanStack Query v5,
  // but that must not disable ordinary store search after the fallback.
  reset();
  page = render();
  assert.equal(step(page), '1');
  assert.match(page, /네이버 지도 링크를 입력해주세요/);
  assert.match(page, /오프라인 매장/);
  assert.ok(pressables.find((props) => textOf(props.children) === '매장명 가져오기')?.disabled, 'No link, no lookup');
  assert.ok(pressables.some((props) => textOf(props.children) === 'URL 없음'), 'Name search is an explicit fallback');
  assert.ok(!inputs.some((props) => props.accessibilityLabel === '매장명 검색'), 'Name search is not the default entry');
  assert.doesNotMatch(page, /온라인 판매처|레시피는 메뉴부터 찾기/);
  press('URL 없음'); page = render();
  input('매장명 검색').onChangeText('을밀대'); page = render();
  assert.equal(storeSearchEnabled, true, 'URL 없음 enables ordinary store search even while disabled prefill query is pending');
  assert.match(page, /검색 결과 2개 · 지점과 주소를 확인해주세요/);

  // Existing item: store -> menu -> photo -> review, then response ids.
  await chooseExistingOffline();
  page = render();
  assert.equal(step(page), '3');
  assert.doesNotMatch(page, /사진 없이 계속/);
  press('사진 고르기'); await flush(); render(); press('다음');
  page = render();
  assert.equal(step(page), '4');
  input('원픽 한줄평').onChangeText('육수가 깔끔해요'); render();
  press('원픽 등록하기'); await flush();
  const existingSave = calls.find(([name]) => name === 'register')[1];
  assert.equal(existingSave.itemId, 'item-1');
  assert.equal(existingSave.categoryId, 'cat-naengmyeon');
  assert.equal(existingSave.channel, 'offline');
  assert.equal(existingSave.requestId, 'request-1');
  assert.equal(existingSave.expectedPreviousPickId, null, 'an empty visible slot is sent explicitly');
  assert.ok(existingSave.photo);
  // #552: success replaces straight to the item detail, which shows the toast once.
  assert.equal(destination.pathname, '/item/[itemId]');
  assert.equal(destination.params.itemId, 'item-1');
  assert.equal(destination.params.pickId, 'pick-1');
  page = render();
  assert.doesNotMatch(page, /원픽을 정했어요|등록 요청|승인 대기/, 'no confirmation dialog is rendered');
  assert.equal(savedToast.consumePickSavedToast('other-pick'), false, 'the toast is bound to the saved Pick');
  assert.equal(savedToast.consumePickSavedToast('pick-1'), true);
  assert.equal(savedToast.consumePickSavedToast('pick-1'), false, 'the toast is shown only once');
  assert.ok(pressables.find((props) => textOf(props.children) === '원픽 등록하기').disabled, 'a saved flow cannot submit again');

  // A branded store pauses inside the menu step until the person chooses
  // this branch or the separate brand-wide product scope.
  reset();
  selectResult = {
    itemId: 'branch-item',
    categoryId: 'cat-naengmyeon',
    hasPhoto: true,
    pending: false,
    brand: {
      providerId: 'provider-1',
      brandId: 'brand-1',
      name: '을밀대',
      logoUrl: null,
      itemId: null,
      hasPhoto: false,
      pending: false,
    },
  };
  registerRun = () => ({ itemId: 'brand-pending', pickId: 'brand-pick', published: false, replacedPickId: null, retried: false });
  openStoreSearch(); input('매장명 검색').onChangeText('을밀대'); render(); press('을밀대 선택'); render();
  input('메뉴 이름').onChangeText('평양냉면'); render(); press('다음'); await flush();
  page = render();
  assert.equal(step(page), '2');
  assert.match(page, /원픽 범위/);
  assert.match(page, /이 지점/);
  assert.match(page, /을밀대 전체/);
  press('을밀대 전체'); render(); press('다음'); await flush();
  page = render(); assert.equal(step(page), '3', 'A new brand-wide product still needs its photo');
  press('사진 고르기'); await flush(); render(); press('다음'); render();
  input('원픽 한줄평').onChangeText('어느 지점이든 좋아요'); render(); press('원픽 등록하기'); await flush();
  const brandSave = calls.find(([name]) => name === 'register')[1];
  assert.equal(brandSave.brandId, 'brand-1');
  assert.equal(brandSave.itemId, undefined);
  assert.equal(brandSave.catalogId, undefined, 'Brand-wide registration must not also select the branch catalog');
  assert.equal(destination.params.itemId, 'brand-pending', 'brand-wide save opens the saved product');

  // AI recommendation remains inside the menu step.
  reset();
  selectResult = { itemId: 'item-ai', categoryId: 'cat-naengmyeon', hasPhoto: true, pending: false };
  openStoreSearch(); input('매장명 검색').onChangeText('우래옥'); render(); press('우래옥 선택'); render();
  input('메뉴 이름').onChangeText('평양물냉'); render(); input('메뉴 이름').onSubmitEditing(); page = render();
  assert.equal(step(page), '2');
  assert.match(page, /메뉴를 확인했어요/);
  assert.ok(!pressables.some((props) => props.accessibilityLabel?.startsWith('AI 추천')));
  press('다음'); await flush(); page = render();
  assert.equal(step(page), '4', 'Existing photo skips the photo interaction');
  input('원픽 한줄평').onChangeText('시원한 육수가 좋아요'); render(); press('원픽 등록하기'); await flush();
  assert.equal(calls.filter(([name]) => name === 'register').length, 1);

  // Unknown/uncertain menus keep the typed name and save independently, without
  // silently choosing an arbitrary category or reusing a catalog item's photo.
  for (const testCase of [
    { suggestions: [{ categoryId: 'cat-suyuk', confidence: 'low' }] },
    { suggestions: [{ categoryId: 'cat-naengmyeon', confidence: 'medium' }] },
    { suggestions: [{ categoryId: 'cat-naengmyeon', confidence: 'high' }, { categoryId: 'cat-suyuk', confidence: 'high' }] },
    { suggestions: [{ categoryId: 'cat-gomtang', confidence: 'high' }] },
    { suggestions: [{ categoryId: 'unknown-category', confidence: 'high' }] },
    { suggestions: [{ categoryId: 'cat-naengmyeon', confidence: 'high' }], needsNewCategory: true },
    { suggestions: [] },
    { suggestions: [], failed: true },
    { suggestions: [{ categoryId: 'cat-naengmyeon', confidence: 'high' }], fetching: true },
  ]) {
    reset(); aiResult = { needsNewCategory: false, ...testCase };
    openStoreSearch(); input('매장명 검색').onChangeText('을밀대'); render(); press('을밀대 선택'); render();
    input('메뉴 이름').onChangeText('비법 국수'); render(); input('메뉴 이름').onSubmitEditing();
    aiFailed = Boolean(testCase.failed); aiFetching = Boolean(testCase.fetching); page = render();
    assert.doesNotMatch(page, /메뉴를 분류하지 못했어요/);
    assert.ok(!inputs.some((props) => props.accessibilityLabel === '카테고리 검색'));
    press('다음'); await flush(); page = render();
    assert.equal(step(page), '3');
    assert.equal(calls.filter(([name]) => name === 'select' || name === 'current-slot').length, 0);
    press('사진 고르기'); await flush(); render(); press('다음'); render();
    input('원픽 한줄평').onChangeText('이 집만의 메뉴예요'); render();
    press('원픽 등록하기'); await flush();
    const saved = calls.find(([name]) => name === 'register')[1];
    assert.equal(saved.categoryId, null);
    assert.equal(saved.menuName, '비법 국수');
    assert.equal(saved.expectedPreviousPickId, null);
    assert.ok(saved.catalogId);
    assert.ok(saved.photo);
    assert.equal(saved.itemId, undefined);
    assert.equal(destination.pathname, '/item/[itemId]');
  }

  // Catalog-missing store identity is collected inside step 1, one input per
  // screen (#593): name, then Naver map link. No road address, no "다시 검색하기".
  reset();
  registerRun = () => ({ itemId: 'pending-place-item', pickId: 'needs-review-pick', published: false, replacedPickId: null, retried: false });
  // Starting over from search must not carry the previous store's link (Codex review on #596).
  openStoreSearch(); input('매장명 검색').onChangeText('옛 냉면집'); render(); press('찾는 매장이 없어요'); render();
  press('다음'); render(); input('네이버 지도 링크').onChangeText('https://naver.me/oldstore'); render();
  press('이전 단계'); render(); press('이전 단계'); render();
  input('매장명 검색').onChangeText('새 냉면집'); render(); press('찾는 매장이 없어요'); render();
  assert.equal(input('등록 요청 이름').value, '새 냉면집');
  press('다음'); render();
  assert.equal(input('네이버 지도 링크').value, '', 'A new direct registration starts without the previous link');
  assert.ok(pressables.find((props) => textOf(props.children) === '다음')?.disabled, 'No link, no next');
  press('이전 단계'); page = render();
  assert.equal(step(page), '1');
  assert.match(page, /매장명을 입력해주세요/);
  assert.doesNotMatch(page, /도로명 주소/);
  assert.doesNotMatch(page, /다시 검색하기/);
  assert.ok(!inputs.some((props) => props.accessibilityLabel === '네이버 지도 링크'), 'The link has its own screen');
  input('등록 요청 이름').onChangeText('새 냉면집');
  render(); press('다음'); page = render();
  assert.equal(step(page), '1');
  assert.match(page, /네이버 지도 링크를 입력해주세요/);
  assert.ok(!inputs.some((props) => props.accessibilityLabel === '등록 요청 이름'), 'The name input is not repeated on the link screen');
  press('이전 단계'); page = render();
  assert.match(page, /매장명을 입력해주세요/, 'Back from the link returns to the name');
  press('다음'); render();
  input('네이버 지도 링크').onChangeText('https://naver.me/newstore');
  render(); press('다음'); page = render();
  assert.equal(step(page), '2');
  input('메뉴 이름').onChangeText('평양냉면'); render(); press('다음'); await flush();
  page = render(); assert.equal(step(page), '3'); press('사진 고르기'); await flush(); render(); press('다음'); render();
  input('원픽 한줄평').onChangeText('면이 좋아요'); render(); press('원픽 등록하기'); await flush();
  const newSave = calls.find(([name]) => name === 'register')[1];
  assert.equal(newSave.channel, 'offline');
  assert.equal(newSave.requestId, 'request-1');
  assert.equal(newSave.newPlace.name, '새 냉면집');
  assert.equal(newSave.newPlace.roadAddress, undefined);
  assert.equal(newSave.newPlace.mapUrl, 'https://naver.me/newstore');
  assert.ok(newSave.photo);
  page = render();
  assert.doesNotMatch(page, /등록 요청을 보냈어요/);
  assert.equal(destination.params.itemId, 'pending-place-item');
  assert.equal(destination.params.pickId, 'needs-review-pick');

  // Own pending item is still a current Pick target, not a separate success mode.
  reset();
  selectResult = { itemId: 'item-1', categoryId: 'cat-suyuk', hasPhoto: true, pending: true };
  await chooseExistingOffline('우래옥', '수육', '고기 › 수육');
  page = render(); assert.equal(step(page), '4');
  input('원픽 한줄평').onChangeText('수육이 부드러워요'); render(); press('원픽 등록하기'); await flush();
  assert.equal(calls.find(([name]) => name === 'register')[1].itemId, 'item-1');
  assert.equal(destination.pathname, '/item/[itemId]');

  // Replacement copy does not expose history.
  reset();
  selectResult = { itemId: 'item-1', categoryId: 'cat-naengmyeon', hasPhoto: true, pending: false };
  detail.myPickStatus = { type: 'selected_other' };
  currentSlotRun = () => ({ id: 'visible-old-pick', channel: 'offline' });
  await chooseExistingOffline(); page = render();
  assert.match(page, /저장하면 이 메뉴의 매장 원픽이 바뀌어요/);
  assert.doesNotMatch(page, /기록으로 남아요/);
  input('원픽 한줄평').onChangeText('다시 먹고 싶은 맛'); render(); press('원픽 등록하기');
  page = render();
  assert.match(page, /기존 원픽을/);
  assert.equal(calls.filter(([name]) => name === 'register').length, 0, 'replacement requires confirmation');
  press('돌아가기'); render();
  assert.equal(input('원픽 한줄평').value, '다시 먹고 싶은 맛');
  press('원픽 등록하기'); render(); press('원픽 바꾸기'); await flush();
  assert.equal(calls.find(([name]) => name === 'register')[1].expectedPreviousPickId, 'visible-old-pick');

  // PICK_CHANGED_ELSEWHERE needs a second explicit submit with the same request id.
  reset();
  selectResult = { itemId: 'item-1', categoryId: 'cat-naengmyeon', hasPhoto: true, pending: false };
  let attempts = 0;
  let slotReads = 0;
  currentSlotRun = () => ({ id: ++slotReads === 1 ? 'visible-before-save' : 'changed-elsewhere', channel: 'offline' });
  registerRun = () => {
    attempts += 1;
    if (attempts === 1) throw new AppError('PICK_CHANGED_ELSEWHERE');
    return { itemId: 'item-1', pickId: 'pick-after-confirm', published: true, replacedPickId: 'changed-elsewhere', retried: false };
  };
  await chooseExistingOffline(); render(); input('원픽 한줄평').onChangeText('다시 확인'); render();
  press('원픽 등록하기'); render(); press('원픽 바꾸기'); await flush();
  assert.equal(destination, undefined, 'a failed save stays on the registration screen');
  assert.equal(savedToast.consumePickSavedToast('pick-after-confirm'), false);
  page = render();
  assert.match(page, /다른 기기에서 이 메뉴의 원픽이 바뀌었어요/);
  press('변경 확인 후 등록하기'); await flush();
  const registrationCalls = calls.filter(([name]) => name === 'register').map(([, value]) => value);
  assert.equal(registrationCalls.length, 2);
  assert.equal(registrationCalls[0].expectedPreviousPickId, 'visible-before-save',
    'first submit uses the Pick slot the person saw before confirmation');
  assert.equal(registrationCalls[1].expectedPreviousPickId, 'changed-elsewhere',
    'explicit reconfirmation refreshes the slot before retrying');
  assert.equal(slotReads, 2, 'the slot is read once at menu confirmation and once after explicit reconfirmation');
  assert.equal(registrationCalls[0].requestId, registrationCalls[1].requestId);
  assert.equal(registrationCalls[0].requestId, 'request-1');
  assert.equal(destination.params.pickId, 'pick-after-confirm');
  assert.equal(savedToast.consumePickSavedToast('pick-after-confirm'), true);

  // Link-first step 1: the Naver title (with 점) matches one catalog row's name + branch.
  reset();
  linkResponse = (input) => linkResult(input.url, '스타벅스 강남우성점', [
    linkPlace('cat-sb-1', '스타벅스', '강남우성'),
    linkPlace('cat-sb-2', '스타벅스', '강남역'),
  ]);
  render(); page = render();
  assert.match(page, /네이버 지도 링크를 입력해주세요/);
  assert.ok(pressables.find((props) => textOf(props.children) === '매장명 가져오기')?.disabled, 'No link, no lookup');
  input('매장 찾기 네이버 지도 링크').onChangeText('https://blog.naver.com/x'); page = render();
  assert.match(page, /네이버 지도 링크를 확인해주세요/);
  assert.ok(pressables.find((props) => textOf(props.children) === '매장명 가져오기')?.disabled, 'Only Naver map links are looked up');
  const naverShare = '[네이버지도]\n머시기쪽갈비 신림점\n서울 관악구 신림동길 23-1 1층 101, 102호\nhttps://naver.me/FvTtTqVA';
  input('매장 찾기 네이버 지도 링크').onChangeText(naverShare); page = render();
  assert.equal(input('매장 찾기 네이버 지도 링크').value, 'https://naver.me/FvTtTqVA',
    'Naver share text is normalized to its allowlisted map URL');
  assert.ok(!pressables.find((props) => textOf(props.children) === '매장명 가져오기')?.disabled,
    'A valid URL extracted from Naver share text enables lookup');
  assert.equal(service.extractNaverMapUrl(naverShare), 'https://naver.me/FvTtTqVA');

  input('매장 찾기 네이버 지도 링크').onChangeText('https://naver.me/starbucks'); render();
  press('매장명 가져오기'); page = render();
  assert.equal(calls.find(([name]) => name === 'link')[1].url, 'https://naver.me/starbucks');
  assert.match(page, /링크와 같은 매장을 찾았어요/);
  assert.match(page, /스타벅스 · 강남우성/);
  assert.doesNotMatch(page, /강남역/, 'Only the exact match is shown once it is unique');
  press('다음'); page = render();
  assert.equal(step(page), '2');
  assert.match(page, /2 \/ 4 · 스타벅스 · 강남우성/);
  press('이전 단계'); page = render();
  assert.match(page, /링크와 같은 매장을 찾았어요/, 'Back from step 2 keeps the link result');

  // Several similar rows and no exact one: the person picks, nothing is preselected.
  reset();
  linkResponse = (input) => linkResult(input.url, '스타벅스 리저브', [
    linkPlace('cat-sb-1', '스타벅스', '강남우성'),
    linkPlace('cat-sb-2', '스타벅스', '강남역'),
  ]);
  render();
  input('매장 찾기 네이버 지도 링크').onChangeText('https://naver.me/reserve'); render(); press('매장명 가져오기'); page = render();
  assert.match(page, /맞는 매장을 골라주세요/);
  assert.ok(!pressables.some((props) => textOf(props.children) === '다음'), 'No automatic choice without a unique match');
  press('스타벅스 선택'); page = render();
  assert.equal(step(page), '2');

  // No catalog row: the store is registered with the link's name and the link itself.
  reset();
  registerRun = () => ({ itemId: 'pending-link-item', pickId: 'link-pick', published: false, replacedPickId: null, retried: false });
  linkResponse = (input) => linkResult(input.url, '이고집만두', []);
  render();
  input('매장 찾기 네이버 지도 링크').onChangeText('[네이버지도]\n이고집만두\n충남 천안시 동남구 태조산길 258\nhttps://naver.me/x1uzYNK5'); render(); press('매장명 가져오기'); page = render();
  assert.equal(step(page), '2');
  assert.match(page, /2 \/ 4 · 이고집만두/);
  assert.match(page, /이고집만두 매장을 선택했어요\./);
  assert.doesNotMatch(page, /목록에 없어요|새 매장으로 등록/);
  assert.ok(!calls.some(([name]) => name === 'register' || name === 'select'), 'Lookup does not write a store or Pick');
  press('이전 단계'); page = render();
  assert.equal(step(page), '1', 'Back does not automatically bounce into the menu again');
  assert.match(page, /이고집만두의 메뉴를 등록할 수 있어요/);
  press('다음'); page = render();
  assert.equal(step(page), '2');
  input('메뉴 이름').onChangeText('평양냉면'); render(); press('다음'); await flush();
  render(); press('사진 고르기'); await flush(); render(); press('다음'); render();
  input('원픽 한줄평').onChangeText('면이 좋아요'); render(); press('원픽 등록하기'); await flush();
  const linkSave = calls.find(([name]) => name === 'register')[1];
  assert.equal(linkSave.newPlace.name, '이고집만두');
  assert.equal(linkSave.newPlace.mapUrl, 'https://naver.me/x1uzYNK5');

  // A slow response cannot advance after edit, back, cancel, fallback or account change.
  for (const abandon of ['edit', 'back', 'cancel', 'fallback', 'account', 'logout']) {
    reset(); deferLink = true;
    linkResponse = (input) => linkResult(input.url, '이고집만두', []);
    render(); render();
    input('매장 찾기 네이버 지도 링크').onChangeText('https://naver.me/x1uzYNK5'); render(); press('매장명 가져오기');
    if (abandon === 'edit') input('매장 찾기 네이버 지도 링크').onChangeText('https://naver.me/other');
    if (abandon === 'back') press('이전 단계');
    if (abandon === 'cancel') press('원픽 등록 취소');
    if (abandon === 'fallback') press('URL 없음');
    if (abandon === 'account') auth.user = { id: 'other-owner' };
    if (abandon === 'logout') auth.user = null;
    render(); finishLink(); page = render();
    assert.notEqual(step(page), '2', `${abandon}: stale lookup must not advance`);
    assert.ok(!calls.some(([name]) => name === 'register' || name === 'select'));
  }

  // The name could not be read: only the name is asked; the pasted link is not asked again.
  reset();
  linkResponse = (input) => linkResult(input.url, null, []);
  render();
  input('매장 찾기 네이버 지도 링크').onChangeText('https://naver.me/unknown'); render(); press('매장명 가져오기'); page = render();
  assert.match(page, /링크에서 매장 이름을 읽지 못했어요/);
  press('매장 이름 입력하기'); page = render();
  assert.match(page, /매장명을 입력해주세요/);
  press('이전 단계'); page = render();
  assert.match(page, /링크에서 매장 이름을 읽지 못했어요/, 'Back from the name returns to the link result');
  press('매장 이름 입력하기'); render();
  input('등록 요청 이름').onChangeText('이름 모를 집'); render(); press('다음'); page = render();
  assert.equal(step(page), '2', 'The link screen is not shown again');
  assert.ok(!inputs.some((props) => props.accessibilityLabel === '네이버 지도 링크'));
  assert.match(page, /2 \/ 4 · 이름 모를 집/);
  input('메뉴 이름').onChangeText('평양냉면'); render(); press('다음'); await flush();
  render(); press('사진 고르기'); await flush(); render(); press('다음'); render();
  input('원픽 한줄평').onChangeText('면이 좋아요'); render(); press('원픽 등록하기'); await flush();
  const namedSave = calls.find(([name]) => name === 'register')[1];
  assert.equal(namedSave.newPlace.name, '이름 모를 집');
  assert.equal(namedSave.newPlace.mapUrl, 'https://naver.me/unknown');

  // The ordinary "찾는 매장이 없어요" path still asks the name, then the link.
  reset();
  openStoreSearch(); input('매장명 검색').onChangeText('없는 집'); render(); press('찾는 매장이 없어요'); render();
  press('다음'); page = render();
  assert.match(page, /네이버 지도 링크를 입력해주세요/);

  for (const ok of ['https://naver.me/abc', 'https://map.naver.com/p/entry/place/1', 'https://m.place.naver.com/restaurant/1']) assert.ok(service.isNaverMapUrl(ok), ok);
  for (const bad of ['http://naver.me/abc', 'https://naver.me.evil.com/x', 'https://blog.naver.com/x', 'https://naver.me/a b']) assert.ok(!service.isNaverMapUrl(bad), bad);

  console.log('Store-first v6 checks passed: offline four-step flow, branch/brand scope, visible Pick snapshot, response-id navigation, and explicit concurrency reconfirmation.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
