// 원픽 등록 6단계 (채널 → 상호 → 링크 → 메뉴 → 사진 → 한줄평) + 저장 성공 모달: the real screen
// with stubbed data hooks. Checks step order, required inputs, replacement confirmation,
// skipped steps, what each step sends, and that the draft survives moving between steps.
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

let states, index, pressables, inputs, destination;
const native = {
  View: part('div'), Text: part('span'), ScrollView: part('main'), ActivityIndicator: () => null,
  Modal: ({ visible, children }) => visible ? React.createElement('dialog', null, children) : null,
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
    useMenuOptions: () => ({ data: menuOptions, isError: false, refetch() {} }),
    useMenuSuggestions: (store, key, enabled) => ({ data: enabled ? aiResult : undefined, isPending: false, isError: false }),
    useSelectStoreItem: () => mutation('select', () => selectResult),
    useSuggestMapLink: () => mutation('link', () => undefined),
    useSetMenuHint: () => mutation('menuHint', () => undefined),
  },
};
const { default: Screen } = load('app/pick/new.tsx', {
  react: fakeReact, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: part('section') },
  'expo-router': { useRouter: () => ({ push: (route) => { destination = route; }, replace: (route) => { destination = route; }, back() {}, canGoBack: () => true }) },
  '@/components/ui': ui, '@/errors/appError': { AppError },
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useChoosePick': {
    useChoosePick: () => mutation('choose', (input) => ({ id: 'pick-1', itemId: input.itemId })),
    useRequestPendingPick: () => mutation('requestPick', (input) => input.oneLineReview),
  },
  '@/hooks/useItemDetail': { useItemDetail: (itemId) => ({ data: itemId ? detail : undefined, refetch: async () => {} }) },
  '@/hooks/useLinkCategorySuggestions': { useAttachPendingItemLink: () => mutation('sellerLink', () => undefined) },
  '@/hooks/useRegisterPick': {
    useChoosePhoto: () => mutation('choosePhoto', () => ({ uri: 'data:image/jpeg;base64,eA==', base64: 'eA==' })),
    useAttachItemPhoto: () => mutation('attachPhoto', () => ({ id: 'item-1', imagePath: 'owner/item.jpg', imageUrl: 'https://img.example/item.jpg' })),
    useRegisterPick: () => mutation('register', () => registerResult),
  },
  '@/hooks/useStoreFirst': hooks.store,
  '@/lib/items/pickChannel': pickChannel,
  '@/lib/photos/photoFailure': { showPhotoFailure() {}, isPhotoFailure: () => false },
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
  selectResult = { itemId: 'item-1', categoryId: 'cat-naengmyeon', hasPhoto: false, pending: false };
  registerResult = { type: 'pending_item', item: { id: 'pending-1', name: '새 냉면집' } };
}
function render() {
  index = 0; pressables = []; inputs = [];
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

  // Channel is its own first step. Store search starts only after choosing it.
  reset();
  page = render();
  assert.equal(step(page), '1');
  assert.match(page, /채널을 선택해 주세요/);
  assert.equal(inputs.find((entry) => entry.accessibilityLabel === '매장명 검색'), undefined);
  press('매장 채널 선택');
  page = render();
  assert.equal(step(page), '1', 'Selecting a channel does not advance until Next');
  press('다음');
  page = render();
  assert.equal(step(page), '2');
  assert.match(page, /매장명 검색: 을밀대, 우래옥/);

  // Recipe is the third channel and hands off to the dedicated YouTube flow.
  reset();
  render(); press('레시피 채널 선택'); render(); press('다음');
  assert.equal(destination, '/pick/recipe');

  // Offline: channel → store → required map link → menu → photo → review → success modal.
  reset();
  render(); press('매장 채널 선택'); render(); press('다음'); render();
  input('매장명 검색').onChangeText('을밀대');
  page = render();
  assert.match(page, /서울 마포구 · 국수\/칼국수/);
  press('을밀대 선택');
  page = render();
  assert.equal(step(page), '3');
  assert.match(page, /매장 지도 링크를 알려주세요/);
  press('다음');
  page = render();
  assert.match(page, /네이버 지도 링크\(naver\.me, map\.naver\.com\)를 입력해주세요/);
  input('네이버 지도 링크').onChangeText('https://example.com/place');
  render(); press('다음');
  page = render();
  assert.match(page, /네이버 지도 링크\(naver\.me, map\.naver\.com\)를 입력해주세요/);
  input('네이버 지도 링크').onChangeText('https://naver.me/eulmildae');
  render(); press('다음');
  page = render();
  assert.equal(step(page), '4');
  assert.equal(calls.filter(([name]) => name === 'link').length, 0, 'Link is only persisted after an item exists');
  assert.match(page, /을밀대의 어떤 메뉴가 원픽인가요/);
  press('AI 추천 면 › 평양냉면');
  render(); press('평양냉면(으)로 다음'); await flush();
  assert.deepEqual(calls.slice(-2).map(([name]) => name), ['select', 'link']);
  assert.equal(calls.at(-1)[1].url, 'https://naver.me/eulmildae');
  page = render();
  assert.equal(step(page), '5');
  let required = pressables.find((props) => textOf(props.children) === '사진을 등록해주세요');
  assert.ok(required?.disabled, 'Photo step cannot be bypassed when a photo is required');
  assert.equal(pressables.some((props) => textOf(props.children) === '사진 없이 계속'), false);
  press('사진 선택'); await flush();
  page = render();
  assert.match(page, /선택한 대표 이미지 미리보기/);
  assert.ok(pressables.some((props) => textOf(props.children) === '사진 삭제'), 'Selected photo remains editable before save');
  assert.ok(pressables.some((props) => textOf(props.children) === '사진 수정'), 'Selected photo can be replaced before save');
  press('사진 삭제'); page = render();
  required = pressables.find((props) => textOf(props.children) === '사진을 등록해주세요');
  assert.ok(required?.disabled, 'Deleting the draft makes the required photo incomplete again');
  press('사진 선택'); await flush(); render();
  press('다음');
  page = render();
  assert.equal(step(page), '6');
  input('원픽 한줄평').onChangeText('육수가 깔끔해요');
  render(); press('이전 단계'); page = render();
  assert.equal(step(page), '5');
  press('다음'); page = render();
  assert.equal(input('원픽 한줄평').value, '육수가 깔끔해요', 'Back/forward keeps the review');
  press('원픽 등록하기'); await flush();
  assert.deepEqual(calls.slice(-2).map(([name]) => name), ['attachPhoto', 'choose']);
  assert.equal(calls.at(-1)[1].channel, 'offline');
  page = render();
  assert.equal(step(page), '6', 'Completion is a modal, not a seventh step');
  assert.match(page, /저장 완료/);
  assert.match(page, /내 원픽으로 저장했어요/);
  press('확인');
  assert.equal(destination.pathname, '/item/[itemId]');
  assert.equal(destination.params.pickId, 'pick-1');

  // Existing verified store link and existing photo are reused, so those input screens are skipped.
  reset();
  detail.item.imageUrl = 'https://img.example/w.jpg';
  selectResult = { itemId: 'item-1', categoryId: 'cat-suyuk', hasPhoto: true, pending: false };
  render(); press('매장 채널 선택'); render(); press('다음'); render();
  input('매장명 검색').onChangeText('우래옥'); render(); press('우래옥 선택');
  page = render();
  assert.equal(step(page), '4', 'A verified place map link skips the link screen');
  press('수육'); render(); press('수육(으)로 다음'); await flush();
  page = render();
  assert.equal(step(page), '6', 'Existing item photo skips the photo screen');

  // Existing online provider uses its saved provider identity; channel remains online.
  reset();
  selectResult = { itemId: 'item-1', categoryId: 'cat-gomtang', hasPhoto: true, pending: false };
  render(); press('온라인 채널 선택'); render(); press('다음'); page = render();
  assert.equal(step(page), '2');
  input('판매처 이름 검색').onChangeText('곰탕'); render(); press('곰탕몰 선택');
  page = render();
  assert.equal(step(page), '4');
  press('곰탕'); render(); press('곰탕(으)로 다음'); await flush();
  page = render(); assert.equal(step(page), '6');
  input('원픽 한줄평').onChangeText('택배로도 진해요'); render(); press('원픽 등록하기'); await flush();
  assert.equal(calls.at(-1)[1].channel, 'online');

  // A new offline store requires both a map link and a representative photo.
  reset();
  render(); press('매장 채널 선택'); render(); press('다음'); render();
  input('매장명 검색').onChangeText('새 냉면집'); render(); press('새 매장 등록');
  page = render();
  assert.equal(input('새 매장 이름').value, '새 냉면집');
  press('다음'); page = render();
  assert.equal(step(page), '3');
  input('네이버 지도 링크').onChangeText('https://naver.me/newstore'); render(); press('다음');
  page = render(); assert.equal(step(page), '4');
  press('평양냉면'); render(); press('평양냉면(으)로 다음'); await flush();
  page = render(); assert.equal(step(page), '5');
  required = pressables.find((props) => textOf(props.children) === '사진을 등록해주세요');
  assert.ok(required?.disabled, 'A new product must have a photo');
  press('사진 선택'); await flush(); page = render();
  assert.match(page, /선택한 대표 이미지 미리보기/);
  press('다음'); render();
  input('원픽 한줄평').onChangeText('면이 좋아요'); render();
  press('원픽 저장'); await flush();
  const registered = calls.find(([name]) => name === 'register')[1];
  assert.equal(registered.categoryId, 'cat-naengmyeon');
  assert.equal(registered.itemName, '새 냉면집');
  assert.equal(registered.oneLineReview, '면이 좋아요');
  assert.equal(registered.channel, 'offline');
  assert.ok(registered.photo);
  assert.equal(calls.find(([name]) => name === 'link')[1].url, 'https://naver.me/newstore');

  // A new online seller moves purchase URL to the dedicated link step and rejects delivery-app URLs.
  reset();
  render(); press('온라인 채널 선택'); render(); press('다음'); render(); press('새 판매처 등록'); render();
  input('새 판매처 이름').onChangeText('새 곰탕몰'); render(); press('다음');
  page = render(); assert.equal(step(page), '3'); assert.match(page, /구매 링크를 알려주세요/);
  input('구매 링크').onChangeText('https://s.baemin.com/store/1'); render(); press('다음');
  page = render(); assert.match(page, /배달앱 주문은 매장으로 골라주세요/);
  input('구매 링크').onChangeText('https://shop.example.com/gomtang'); render(); press('다음');
  page = render(); assert.equal(step(page), '4');
  press('곰탕'); render(); press('곰탕(으)로 다음'); await flush();
  render(); press('사진 선택'); await flush(); render(); press('다음'); render();
  input('원픽 한줄평').onChangeText('진한 국물'); render(); press('원픽 저장'); await flush();
  assert.equal(calls.find(([name]) => name === 'register')[1].channel, 'online');
  assert.equal(JSON.stringify(calls.find(([name]) => name === 'sellerLink')), JSON.stringify(['sellerLink', { itemId: 'pending-1', url: 'https://shop.example.com/gomtang' }]));

  // Replacement requires an explicit confirmation. Cancel does not write and keeps the draft.
  reset();
  detail.item.imageUrl = 'https://img.example/w.jpg';
  detail.myPickStatus = { type: 'selected_other', pickId: 'old-pick', itemId: 'old-item' };
  selectResult = { itemId: 'item-1', categoryId: 'cat-suyuk', hasPhoto: true, pending: false };
  render(); press('매장 채널 선택'); render(); press('다음'); render(); input('매장명 검색').onChangeText('우래옥'); render(); press('우래옥 선택');
  render(); press('수육'); render(); press('수육(으)로 다음'); await flush();
  page = render(); assert.match(page, /현재 매장 원픽이 이 선택으로 바뀝니다/);
  input('원픽 한줄평').onChangeText('이번에는 이 집'); render(); press('원픽 변경');
  page = render(); assert.match(page, /이 원픽으로 변경할까요/);
  assert.equal(calls.filter(([name]) => name === 'choose').length, 0);
  press('원픽 변경 취소'); page = render();
  assert.equal(input('원픽 한줄평').value, '이번에는 이 집');
  press('원픽 변경'); render(); press('원픽 변경 확인'); await flush();
  assert.equal(calls.filter(([name]) => name === 'choose').length, 1);
  assert.equal(calls.find(([name]) => name === 'choose')[1].oneLineReview, '이번에는 이 집');

  // Pending catalog items still follow the legacy server path until the atomic registration RPC replaces it.
  reset();
  selectResult = { itemId: 'item-1', categoryId: 'cat-suyuk', hasPhoto: false, pending: true };
  render(); press('매장 채널 선택'); render(); press('다음'); render(); input('매장명 검색').onChangeText('우래옥'); render(); press('우래옥 선택');
  render(); press('수육'); render(); press('수육(으)로 다음'); await flush();
  page = render(); assert.equal(step(page), '6');
  input('원픽 한줄평').onChangeText('수육이 부드러워요'); render(); press('원픽 저장'); await flush();
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(['requestPick', { itemId: 'item-1', oneLineReview: '수육이 부드러워요' }]));

  // Naver link validation stays aligned with the database check.
  for (const ok of ['https://naver.me/abc', 'https://map.naver.com/p/entry/place/1', 'https://m.place.naver.com/restaurant/1']) assert.ok(service.isNaverMapUrl(ok), ok);
  for (const bad of ['http://naver.me/abc', 'https://naver.me.evil.com/x', 'https://blog.naver.com/x', 'https://naver.me/a b']) assert.ok(!service.isNaverMapUrl(bad), bad);

  console.log('Store-first pick checks passed: 6-step channel/store/link/menu/photo/review flow, success modal, required links/photos, reuse skips, replacement confirmation, draft preservation and legacy pending compatibility.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
