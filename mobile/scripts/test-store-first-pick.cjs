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
  }).outputText, { exports, URL, setTimeout: () => 0, clearTimeout() {}, require: (name) => {
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

let effectDeps, pendingEffects, effectIndex, scrollables, searchState, states, refs, stateIndex, refIndex, pressables, inputs, destination, uuidCounter, routeParams;
const native = {
  Keyboard: { dismiss() {} }, KeyboardAvoidingView: part('div'), View: part('div'), Text: part('span'), ScrollView: (props) => { scrollables.push(props); return React.createElement('main', { 'data-testid': props.testID }, props.children); }, Modal: part('div'), ActivityIndicator: () => null,
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
  useEffect: (effect, deps) => {
    const i = effectIndex++;
    const previous = effectDeps[i];
    if (!previous || deps.some((dep, k) => !Object.is(dep, previous[k]))) {
      effectDeps[i] = deps; pendingEffects.push(effect);
    }
  },
  useCallback: (fn) => fn,
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

let auth, results, menuOptions, aiResult, detail, calls, selectResult, registerRun, currentSlotRun, providerPrefill, storeSearchEnabled;
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
      isWaiting: false, isFetching: false, isError: false, hasNextPage: false, refetch() {}, fetchNextPage() {}, ...searchState };
  },
  useMenuOptions: () => ({ data: menuOptions, isSuccess: true, isError: false, refetch() {} }),
  useMenuSuggestions: (store, key, menuName, enabled) => ({ data: enabled && menuName.trim() ? aiResult : undefined, isPending: !enabled, isFetching: false, isError: false }),
  useSelectStoreItem: () => mutation('select', () => selectResult),
};

const { default: Screen } = load('app/pick/new.tsx', {
  react: fakeReact, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: part('section') },
  'expo-crypto': { randomUUID: () => `request-${++uuidCounter}` },
  'expo-router': {
    useLocalSearchParams: () => routeParams,
    useRouter: () => ({ push: (route) => { destination = route; }, replace: (route) => { destination = route; }, back() {}, canGoBack: () => true }),
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
  '@/hooks/useStoreFirst': hooks,
  '@/lib/items/pickChannel': pickChannel,
  '@/lib/items/pickSavedToast': savedToast,
  '@/lib/photos/photoFailure': { showPhotoFailure() {}, isPhotoFailure: () => false },
  // Draft persistence (#475) is covered by test-pick-draft-restore.cjs; in-memory here.
  '@/lib/pick/pickDraft': { pickDraftStore: () => ({ save: () => true, savePhoto: () => true, load: () => null, clear() {}, discardForOtherUser() {} }) },
  '@/services/storeFirstService': service,
});

function reset() {
  effectDeps = []; searchState = {}; states = []; refs = []; calls = []; destination = undefined; uuidCounter = 0; routeParams = {}; storeSearchEnabled = false;
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
  let page;
  for (let i = 0; i < 8; i++) {
    stateIndex = 0; refIndex = 0; effectIndex = 0; pressables = []; inputs = []; scrollables = []; pendingEffects = [];
    page = renderToStaticMarkup(React.createElement(Screen));
    for (const effect of pendingEffects) effect();
    if (!pendingEffects.length) break;
  }
  return page;
}
function press(label) {
  const found = pressables.find((props) => props.accessibilityLabel === label || textOf(props.children) === label || textOf(props.children).includes(label));
  assert.ok(found, `Expected control: ${label}`);
  assert.ok(!found.disabled, `Control is disabled: ${label}`);
  return found.onPress();
}
const input = (label) => { const found = inputs.find((props) => props.accessibilityLabel === label); assert.ok(found, `Expected input: ${label}`); return found; };
const step = (page) => /(\d) \/ 4/.exec(page)?.[1];

async function chooseExistingOffline(name = '을밀대', menu = '평양냉면', menuLabel = '면 › 평양냉면') {
  render(); input('매장명 검색').onChangeText(name); render(); press(`${name} ${name === '우래옥' ? '서울 중구' : '서울 마포구'} 선택`); render();
  input('메뉴 이름').onChangeText(menu); render(); press(menuLabel); render(); press('다음'); await flush();
}

async function main() {
  reset(); auth.user = null;
  let page = render();
  assert.match(page, /로그인하고 원픽을 등록해보세요/);
  press('로그인');
  assert.equal(destination.pathname, '/auth/login');
  assert.equal(destination.params.action, 'store_pick');
  assert.equal(destination.params.providerId, undefined);

  // A validated profile entry jumps directly to menu input. Back permits re-selection.
  reset();
  routeParams = { providerId: '11111111-1111-1111-1111-111111111111' };
  page = render();
  assert.equal(step(page), '2');
  assert.match(page, /2 \/ 4 메뉴 입력/);
  assert.doesNotMatch(page, /서울집 성수점/);
  input('메뉴 이름').onChangeText('작성 중 메뉴'); render();
  press('선택한 매장 확인'); page = render();
  assert.match(page, /서울집 성수점/);
  press('닫기'); page = render();
  assert.equal(input('메뉴 이름').value, '작성 중 메뉴');
  press('선택한 매장 확인'); render(); press('매장 변경'); page = render();
  assert.equal(step(page), '1');
  input('매장명 검색').onChangeText('을밀대'); render(); press('을밀대 서울 마포구 선택'); page = render();
  input('메뉴 이름');
  assert.ok(!inputs.some((p) => p.accessibilityLabel === '매장명 검색'));
  press('이전 단계'); page = render();
  assert.equal(step(page), '1');
  input('매장명 검색').onChangeText('을밀대'); page = render();
  assert.equal(storeSearchEnabled, true);
  assert.match(page, /을밀대/);

  // Menu detail entry keeps step 1, then prefills menu/category after a store is chosen.
  reset();
  menuOptions = [
    { categoryId: '22222222-2222-2222-2222-222222222222', name: '라멘', groupName: '면', placeEnabled: true },
  ];
  selectResult = { itemId: 'item-ramen', categoryId: '22222222-2222-2222-2222-222222222222', hasPhoto: true, pending: false };
  routeParams = { menuName: '라멘', categoryId: '22222222-2222-2222-2222-222222222222' };
  render(); input('매장명 검색').onChangeText('을밀대'); render(); press('을밀대 서울 마포구 선택'); page = render();
  assert.equal(step(page), '2');
  assert.equal(input('메뉴 이름').value, '라멘');
  assert.match(page, /라멘 메뉴에서 시작해 메뉴명을 미리 채웠어요/);
  assert.match(page, /면 › 라멘/);
  input('메뉴 이름').onChangeText('쇼유라멘'); page = render();
  press('이전 단계'); page = render();
  input('매장명 검색').onChangeText('을밀대'); render(); press('을밀대 서울 마포구 선택'); page = render();
  assert.equal(input('메뉴 이름').value, '쇼유라멘', 'edited prefilled menu survives back + reselecting the store');

  // Fresh menu-prefill path still accepts the validated category on first use.
  reset();
  menuOptions = [
    { categoryId: '22222222-2222-2222-2222-222222222222', name: '라멘', groupName: '면', placeEnabled: true },
  ];
  selectResult = { itemId: 'item-ramen', categoryId: '22222222-2222-2222-2222-222222222222', hasPhoto: true, pending: false };
  routeParams = { menuName: '라멘', categoryId: '22222222-2222-2222-2222-222222222222' };
  render(); input('매장명 검색').onChangeText('을밀대'); render(); press('을밀대 서울 마포구 선택'); render();
  press('다음'); await flush();
  page = render(); assert.equal(step(page), '4', 'Existing photo skips the photo interaction from a valid menu prefill');

  // Public MVP starts directly at offline store search: no channel chooser.
  // A disabled provider-prefill query is isPending=true in TanStack Query v5,
  // but that must not disable ordinary store search.
  reset();
  page = render();
  assert.equal(step(page), '1');
  assert.match(page, /어느 매장을 찾으세요/);
  assert.match(page, /매장 선택/);
  assert.doesNotMatch(page, /온라인 판매처|레시피는 메뉴부터 찾기/);
  input('매장명 검색').onChangeText('을밀대'); page = render();
  assert.equal(storeSearchEnabled, true, 'normal entry enables store search even while disabled prefill query is pending');
  assert.match(page, /등록할 매장을 선택해 주세요/);

  // Pagination: retain rows while loading/failing, retry the failed page, stop at the end.
  const nearEnd = () => scrollables.find((p) => p.testID === 'store-search-results').onScroll({
    nativeEvent: { layoutMeasurement: { height: 300 }, contentOffset: { y: 700 }, contentSize: { height: 1000 } },
  });
  let nextRequests = 0;
  searchState = { hasNextPage: true, fetchNextPage: () => { nextRequests++; } };
  page = render(); nearEnd(); assert.equal(nextRequests, 1);
  assert.doesNotMatch(page, /매장을 더 불러오는 중이에요/);
  searchState.isFetching = true; searchState.isFetchingNextPage = true;
  page = render(); nearEnd(); assert.equal(nextRequests, 1);
  assert.match(page, /매장을 더 불러오는 중이에요/); assert.match(page, /을밀대/);
  searchState.isFetching = false; searchState.isFetchingNextPage = false;
  searchState.isError = true; searchState.isFetchNextPageError = true;
  page = render(); nearEnd(); assert.equal(nextRequests, 1);
  assert.match(page, /을밀대/); press('다시 불러오기'); assert.equal(nextRequests, 2);
  searchState = { hasNextPage: false };
  page = render(); nearEnd(); assert.equal(nextRequests, 2);
  assert.match(page, /검색 결과를 모두 확인했어요/);
  assert.doesNotMatch(page, /상세 주소 표시|숭문길 24|지점과 주소/);
  searchState = {};

  // Existing item: store -> menu -> photo -> review, then response ids.
  await chooseExistingOffline();
  page = render();
  assert.equal(step(page), '3');
  press('선택한 매장 확인'); render(); press('닫기'); page = render();
  assert.doesNotMatch(page, /사진 없이 계속/);
  press('사진 선택'); await flush(); render(); press('다음');
  page = render();
  assert.equal(step(page), '4');
  input('원픽 한줄평').onChangeText('육수가 깔끔해요'); render(); press('선택한 매장 확인'); render(); press('닫기'); render(); assert.equal(input('원픽 한줄평').value, '육수가 깔끔해요'); render();
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
  render(); input('매장명 검색').onChangeText('을밀대'); render(); press('을밀대 서울 마포구 선택'); render();
  input('메뉴 이름').onChangeText('평양냉면'); render(); press('면 › 평양냉면'); render(); press('다음'); await flush();
  page = render();
  assert.equal(step(page), '2');
  assert.match(page, /원픽 범위/);
  assert.match(page, /이 지점/);
  assert.match(page, /을밀대 전체/);
  press('을밀대 전체'); render(); press('다음'); await flush();
  page = render(); assert.equal(step(page), '3', 'A new brand-wide product still needs its photo');
  press('사진 선택'); await flush(); render(); press('다음'); render();
  input('원픽 한줄평').onChangeText('어느 지점이든 좋아요'); render(); press('원픽 등록하기'); await flush();
  const brandSave = calls.find(([name]) => name === 'register')[1];
  assert.equal(brandSave.brandId, 'brand-1');
  assert.equal(brandSave.itemId, undefined);
  assert.equal(brandSave.catalogId, undefined, 'Brand-wide registration must not also select the branch catalog');
  assert.equal(destination.params.itemId, 'brand-pending', 'brand-wide save opens the saved product');

  // AI recommendation remains inside the menu step.
  reset();
  selectResult = { itemId: 'item-ai', categoryId: 'cat-naengmyeon', hasPhoto: true, pending: false };
  render(); input('매장명 검색').onChangeText('우래옥'); render(); press('우래옥 서울 중구 선택'); render();
  input('메뉴 이름').onChangeText('평양물냉'); render(); input('메뉴 이름').onSubmitEditing(); page = render();
  assert.equal(step(page), '2');
  assert.match(page, /카테고리 AI 추천/);
  assert.match(page, /평양냉면으로 유명한 곳이에요/);
  press('다음'); await flush(); page = render();
  assert.equal(step(page), '4', 'Existing photo skips the photo interaction');
  input('원픽 한줄평').onChangeText('시원한 육수가 좋아요'); render(); press('원픽 등록하기'); await flush();
  assert.equal(calls.filter(([name]) => name === 'register').length, 1);

  // Missing category cannot become a fake request-success state.
  reset();
  aiResult = { suggestions: [{ categoryId: 'cat-suyuk', label: '고기 › 저신뢰추천', reason: '확신이 낮아요', confidence: 'low' }], needsNewCategory: false };
  render(); input('매장명 검색').onChangeText('을밀대'); render(); press('을밀대 서울 마포구 선택'); render();
  input('메뉴 이름').onChangeText('할머니 비법 국수'); render(); input('메뉴 이름').onSubmitEditing(); page = render();
  assert.match(page, /카테고리를 추천하지 못했어요/);
  assert.match(page, /현재 등록 가능한 카테고리 중 하나를 골라주세요/);

  // Catalog-missing store identity is collected inside step 1, one input per
  // screen (#593): name, then Naver map link. No road address, no "다시 검색하기".
  reset();
  registerRun = () => ({ itemId: 'pending-place-item', pickId: 'needs-review-pick', published: false, replacedPickId: null, retried: false });
  // Starting over from search must not carry the previous store's link (Codex review on #596).
  render(); input('매장명 검색').onChangeText('옛 냉면집'); render(); press('찾는 매장이 없어요'); render();
  press('다음'); render(); input('네이버 지도 링크').onChangeText('https://naver.me/oldstore'); render();
  press('이전 단계'); render(); press('이전 단계'); render();
  input('매장명 검색').onChangeText('새 냉면집'); render(); press('찾는 매장이 없어요'); render();
  assert.equal(input('등록 요청 이름').value, '새 냉면집');
  press('다음'); render();
  assert.equal(input('네이버 지도 링크').value, '', 'A new direct registration starts without the previous link');
  assert.ok(pressables.find((props) => textOf(props.children) === '다음')?.disabled, 'No link, no next');
  press('이전 단계'); page = render();
  assert.equal(step(page), '1');
  assert.match(page, /매장 이름을 알려 주세요/);
  assert.doesNotMatch(page, /도로명 주소/);
  assert.doesNotMatch(page, /다시 검색하기/);
  assert.ok(!inputs.some((props) => props.accessibilityLabel === '네이버 지도 링크'), 'The link has its own screen');
  input('등록 요청 이름').onChangeText('새 냉면집');
  render(); press('다음'); page = render();
  assert.equal(step(page), '1');
  assert.match(page, /네이버 지도 링크를 붙여넣어 주세요/);
  assert.ok(!inputs.some((props) => props.accessibilityLabel === '등록 요청 이름'), 'The name input is not repeated on the link screen');
  press('이전 단계'); page = render();
  assert.match(page, /매장 이름을 알려 주세요/, 'Back from the link returns to the name');
  press('다음'); render();
  input('네이버 지도 링크').onChangeText('https://naver.me/newstore');
  render(); press('다음'); page = render();
  assert.equal(step(page), '2');
  input('메뉴 이름').onChangeText('평양냉면'); render(); press('면 › 평양냉면'); render(); press('다음'); await flush();
  page = render(); assert.equal(step(page), '3'); press('사진 선택'); await flush(); render(); press('다음'); render();
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
  assert.match(page, /저장하면 이 메뉴의 매장 원픽이 이걸로 바뀝니다/);
  assert.doesNotMatch(page, /기록으로 남아요/);

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
  press('원픽 등록하기'); await flush();
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

  for (const ok of ['https://naver.me/abc', 'https://map.naver.com/p/entry/place/1', 'https://m.place.naver.com/restaurant/1']) assert.ok(service.isNaverMapUrl(ok), ok);
  for (const bad of ['http://naver.me/abc', 'https://naver.me.evil.com/x', 'https://blog.naver.com/x', 'https://naver.me/a b']) assert.ok(!service.isNaverMapUrl(bad), bad);

  console.log('Store-first v6 checks passed: offline four-step flow, branch/brand scope, visible Pick snapshot, response-id navigation, and explicit concurrency reconfirmation.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
