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
  View: part('div'), Text: part('span'), ScrollView: part('main'), ActivityIndicator: () => null,
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
    useMenuSuggestions: (store, key, menuName, enabled) => ({ data: enabled && menuName.trim() ? aiResult : undefined, isPending: false, isError: false }),
    useSelectStoreItem: () => mutation('select', () => selectResult),
    useSuggestMapLink: () => mutation('link', () => undefined),
    useSetMenuHint: () => mutation('menuHint', () => undefined),
  },
};
const { default: Screen } = load('app/pick/new.tsx', {
  react: fakeReact, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: part('section') },
  'expo-router': { useRouter: () => ({ push: (route) => { destination = route; }, replace: (route) => { destination = route; }, back() {}, canGoBack: () => true }) },
  '@/components/pick-photo-step': { PickPhotoStep: (props) => { photoSteps.push(props); return React.createElement('aside', null, 'PHOTO-STEP'); } },
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
  // Signed out: one login card that returns to this flow.
  reset(); auth.user = null;
  let page = render();
  assert.match(page, /로그인하고 원픽을 등록해보세요/);
  press('로그인');
  assert.equal(destination.pathname, '/auth/login');
  assert.equal(destination.params.action, 'store_pick');

  // 1 → 2 → 3 → 4 → 5 → 6 for a catalog store without a map link or photo.
  reset();
  page = render();
  assert.equal(step(page), '1');
  assert.match(page, /매장명 검색: 을밀대, 우래옥/, 'Step 1 asks for the store name, not a menu');
  assert.doesNotMatch(page, /메뉴 검색: 도가니탕/);
  input('매장명 검색').onChangeText('을밀대');
  page = render();
  assert.match(page, /서울 마포구 · 국수\/칼국수/);
  press('을밀대 선택');
  page = render();
  assert.equal(step(page), '2');
  assert.match(page, /어떤 메뉴인가요/);
  assert.match(page, /같은 메뉴가 있으면 바로 보여드리고/);
  input('메뉴 이름').onChangeText('평양냉면');
  page = render();
  assert.doesNotMatch(page, /곰탕/, 'Menus without store search are not offered for a 매장');
  assert.doesNotMatch(page, /AI로 카테고리 추천받기/, 'An exact catalog menu must not offer an AI call');
  press('평양냉면');
  page = render();
  assert.doesNotMatch(page, /평양냉면으로 유명한 곳이에요/, 'An exact catalog menu skips the AI suggestion call');
  press('평양냉면(으)로 다음');
  await flush();
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(['select', { categoryId: 'cat-naengmyeon', store: results.offline[0] }]));
  page = render();
  assert.equal(step(page), '3', 'A store without a map link asks for one');
  input('네이버 지도 링크').onChangeText('https://example.com/place');
  render(); press('다음'); await flush();
  page = render();
  assert.match(page, /네이버 지도 링크\(naver\.me, map\.naver\.com\)만/, 'Only Naver map links pass');
  input('네이버 지도 링크').onChangeText('https://naver.me/eulmildae');
  render(); press('다음'); await flush();
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(['link', { itemId: 'item-1', url: 'https://naver.me/eulmildae' }]));
  page = render();
  assert.equal(step(page), '4');
  assert.equal(photoSteps.length, 1, 'An item without a photo offers the in-place photo step');
  assert.equal(photoSteps[0].itemId, 'item-1');
  press('사진 없이 계속');
  page = render();
  assert.equal(step(page), '5');
  assert.match(page, /을밀대 · 평양냉면/);
  input('원픽 한줄평').onChangeText('육수가 깔끔해요');
  render(); press('이전 단계'); page = render();
  assert.equal(step(page), '4');
  press('다음'); page = render();
  assert.equal(input('원픽 한줄평').value, '육수가 깔끔해요', 'Going back and forth keeps the review');
  press('원픽 등록'); await flush();
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(['choose', { categoryId: 'cat-naengmyeon', itemId: 'item-1', oneLineReview: '육수가 깔끔해요', channel: 'offline' }]));
  page = render();
  assert.equal(step(page), '6');
  assert.match(page, /원픽을 정했어요/);
  assert.match(page, /“육수가 깔끔해요”/);
  assert.match(page, /네이버 지도 링크는 확인 후 표시돼요/);
  press('내 원픽 보기');
  assert.equal(destination.pathname, '/item/[itemId]');
  assert.equal(destination.params.pickId, 'pick-1');

  // A store with an approved link and an item with a photo skips steps 3 and 4.
  reset();
  detail.item.imageUrl = 'https://img.example/w.jpg';
  selectResult = { itemId: 'item-1', categoryId: 'cat-suyuk', hasPhoto: true };
  render(); input('매장명 검색').onChangeText('우래옥'); render();
  press('우래옥 선택'); render();
  input('메뉴 이름').onChangeText('수육'); render();
  press('수육'); render(); press('수육(으)로 다음'); await flush();
  page = render();
  assert.equal(step(page), '5', 'Link and photo steps are skipped when already present');
  press('원픽 등록'); page = render();
  assert.match(page, /한줄평을 1~100자로 입력해주세요/, 'The review is required');
  assert.equal(calls.filter(([name]) => name === 'choose').length, 0);

  // Online seller: the shop link is already known, so step 3 is skipped.
  reset();
  selectResult = { itemId: 'item-1', categoryId: 'cat-gomtang', hasPhoto: false };
  render(); press('온라인'); page = render();
  assert.match(page, /판매처 이름 검색/);
  input('판매처 이름 검색').onChangeText('곰탕'); render();
  press('곰탕몰 선택'); page = render();
  input('메뉴 이름').onChangeText('곰탕'); page = render();
  assert.match(page, /곰탕/, 'Online sellers may pick any food menu');
  press('곰탕'); render(); press('곰탕(으)로 다음'); await flush();
  page = render();
  assert.equal(step(page), '4', 'Sellers skip the map link step');
  press('사진 없이 계속'); render();
  input('원픽 한줄평').onChangeText('택배로도 진해요'); render();
  press('원픽 등록'); await flush();
  assert.equal(calls.at(-1)[1].channel, 'online');

  // New store request: nothing is written until the review is saved.
  reset();
  render(); input('매장명 검색').onChangeText('새 냉면집'); render();
  press('매장 등록 요청'); page = render();
  assert.equal(input('등록 요청 이름').value, '새 냉면집', 'The searched name starts the request');
  press('다음'); render();
  input('메뉴 이름').onChangeText('평양냉면'); render();
  press('평양냉면'); render(); press('평양냉면(으)로 다음'); await flush();
  assert.equal(calls.filter(([name]) => name === 'select').length, 0, 'A request does not create an item before the review');
  page = render();
  assert.equal(step(page), '3');
  input('네이버 지도 링크').onChangeText('https://naver.me/newstore'); render();
  press('다음'); await flush();
  assert.equal(calls.filter(([name]) => name === 'link').length, 0, 'The link waits for the request');
  page = render();
  assert.equal(step(page), '4');
  press('사진 선택'); await flush(); page = render();
  assert.match(page, /선택한 대표 이미지 미리보기/);
  press('다음'); render();
  input('원픽 한줄평').onChangeText('면이 좋아요'); render();
  press('등록 요청하고 원픽 남기기'); await flush();
  const registered = calls.find(([name]) => name === 'register')[1];
  assert.equal(registered.categoryId, 'cat-naengmyeon');
  assert.equal(registered.itemName, '새 냉면집');
  assert.equal(registered.oneLineReview, '면이 좋아요');
  assert.equal(registered.channel, 'offline');
  assert.ok(registered.photo, 'The chosen photo is sent with the request');
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(['link', { itemId: 'pending-1', url: 'https://naver.me/newstore' }]));
  page = render();
  assert.match(page, /등록 요청을 보냈어요/);
  assert.match(page, /승인하면 이 한줄평으로 내 원픽에 자동 등록/);

  // New online seller request needs a non-delivery https link, attached after saving.
  reset();
  render(); press('온라인'); render(); press('판매처 등록 요청'); render();
  input('등록 요청 이름').onChangeText('새 곰탕몰');
  input('판매처 링크').onChangeText('https://s.baemin.com/store/1'); page = render();
  assert.match(page, /배달앱 주문은 매장으로 골라주세요/);
  input('판매처 링크').onChangeText('https://shop.example.com/gomtang'); render();
  press('다음'); render();
  input('메뉴 이름').onChangeText('곰탕'); render();
  press('곰탕'); render(); press('곰탕(으)로 다음'); await flush();
  page = render();
  assert.equal(step(page), '4', 'Online requests skip the map link step');
  press('사진 없이 계속'); render();
  input('원픽 한줄평').onChangeText('진한 국물'); render();
  press('등록 요청하고 원픽 남기기'); await flush();
  assert.equal(calls.find(([name]) => name === 'register')[1].channel, 'online');
  assert.equal(JSON.stringify(calls.find(([name]) => name === 'sellerLink')), JSON.stringify(['sellerLink', { itemId: 'pending-1', url: 'https://shop.example.com/gomtang' }]));

  // No menu fits a café: search "클래식 밀크티", then continue as a request.
  reset();
  render(); input('매장명 검색').onChangeText('을밀대'); render();
  press('을밀대 선택'); render();
  input('메뉴 이름').onChangeText('클래식 평양냉면'); page = render();
  assert.match(page, /평양냉면/, 'A longer typed name still finds the menu it contains');
  assert.match(page, /비슷한 기존 메뉴/, 'A longer typed name still surfaces the matching catalog menu');
  aiResult = { suggestions: [], needsNewCategory: true };
  input('메뉴 이름').onChangeText('클래식 밀크티'); page = render();
  assert.doesNotMatch(page, /클래식 밀크티(&#x27;|') 메뉴가 아직 없어요/, 'Admin fallback stays hidden until AI has been tried');
  assert.match(page, /AI로 카테고리 추천받기/, 'Unknown menus wait for explicit submit instead of calling AI on every keystroke');
  press('AI로 카테고리 추천받기'); page = render();
  assert.match(page, /클래식 밀크티(&#x27;|') 메뉴가 아직 없어요/, 'After AI finds no category, the admin fallback becomes available');
  press("'클래식 밀크티' 메뉴로 등록 요청"); page = render();
  assert.equal(step(page), '3', 'The request continues with the link step for a 매장');
  assert.equal(calls.filter(([name]) => name === 'select').length, 0, 'No store item is created for an unknown menu');
  press('건너뛰기'); render(); press('사진 없이 계속'); page = render();
  assert.match(page, /을밀대 · 클래식 밀크티/);
  input('원픽 한줄평').onChangeText('밀크티가 진해요'); render();
  press('등록 요청하고 원픽 남기기'); await flush();
  const menuRequest = calls.find(([name]) => name === 'register')[1];
  assert.equal(menuRequest.categoryId, undefined, 'The request is saved without a category');
  assert.equal(menuRequest.itemName, '을밀대');
  assert.equal(menuRequest.channel, 'offline');
  assert.equal(JSON.stringify(calls.find(([name]) => name === 'menuHint')), JSON.stringify(['menuHint', { userId: 'owner', itemId: 'pending-1', label: '클래식 밀크티' }]),
    'The typed menu goes to the administrator as the category hint');
  page = render();
  assert.match(page, /등록 요청을 보냈어요/);

  // A catalog store picked for the first time is a pending request: no photo
  // step, and the review is sent with the request instead of becoming a Pick.
  reset();
  selectResult = { itemId: 'item-1', categoryId: 'cat-suyuk', hasPhoto: false, pending: true };
  render(); input('매장명 검색').onChangeText('우래옥'); render();
  press('우래옥 선택'); render();
  input('메뉴 이름').onChangeText('수육'); render();
  press('수육'); render(); press('수육(으)로 다음'); await flush();
  page = render();
  assert.equal(step(page), '5', 'A pending store skips the photo step');
  assert.match(page, /관리자가 우래옥을\(를\) 확인해 승인하면/);
  input('원픽 한줄평').onChangeText('수육이 부드러워요'); render();
  press('등록 요청하고 원픽 남기기'); await flush();
  assert.equal(JSON.stringify(calls.find(([name]) => name === 'requestPick')), JSON.stringify(['requestPick', { itemId: 'item-1', oneLineReview: '수육이 부드러워요' }]));
  assert.equal(JSON.stringify(calls.find(([name]) => name === 'menuHint')), JSON.stringify(['menuHint', { userId: 'owner', itemId: 'item-1', label: '수육' }]), 'Pending requests retain the typed menu label');
  assert.equal(calls.filter(([name]) => name === 'choose').length, 0, 'A pending store is not picked directly');
  page = render();
  assert.match(page, /등록 요청을 보냈어요/);

  // The Naver link rule matches the database check.
  for (const ok of ['https://naver.me/abc', 'https://map.naver.com/p/entry/place/1', 'https://m.place.naver.com/restaurant/1']) assert.ok(service.isNaverMapUrl(ok), ok);
  for (const bad of ['http://naver.me/abc', 'https://naver.me.evil.com/x', 'https://blog.naver.com/x', 'https://naver.me/a b']) assert.ok(!service.isNaverMapUrl(bad), bad);

  console.log('Store-first pick checks passed: store-name search, AI and manual menus, link/photo steps skipped when present, review kept across steps, offline/online channels, new store requests saved only at the end, and pending catalog stores sent for review.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
