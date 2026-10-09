// #475: an in-progress /pick/new draft survives a login round trip for the SAME
// account only, re-checks server state, never auto-submits, and is cleared on submit,
// explicit cancel, explicit sign-out and account switch. A photo that could not be
// kept is reported ("사진을 다시 선택해주세요") while the other input is restored.
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
  }).outputText, { exports, URL, setTimeout, clearTimeout, require: (name) => {
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name === '@/components/ui/dialog-labels') return require('./dialog-labels.cjs');
    if (name in imports) return imports[name];
    if (name === 'react/jsx-runtime') return require(name);
    assert.fail(`Unexpected dependency: ${name}`);
  } });
  return exports;
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const drafts = load('lib/pick/pickDraft.ts');

// Web-like storage with a byte quota; `failAll` simulates blocked storage.
function sessionBackend(limit = Infinity) {
  const values = new Map();
  const backend = {
    kind: 'session', failAll: false, values,
    getItem: (key) => { if (backend.failAll) throw new Error('blocked'); return values.get(key) ?? null; },
    setItem: (key, value) => {
      if (backend.failAll) throw new Error('blocked');
      const used = [...values].filter(([k]) => k !== key).reduce((sum, [, v]) => sum + v.length, 0);
      if (used + value.length > limit) throw new Error('QuotaExceededError');
      values.set(key, value);
    },
    removeItem: (key) => { values.delete(key); },
  };
  return backend;
}
const fields = (over = {}) => ({
  step: 5, query: '을밀대', requesting: false, requestPart: 'name', newName: '', mapLink: '',
  store: { kind: 'place', catalogId: 'cat-1', name: '을밀대' }, menuQuery: '평양냉면', manualCategory: false,
  categoryQuery: '', menu: { categoryId: 'cat-naengmyeon', name: '평양냉면' }, pickScope: null, review: '육수가 깔끔해요', ...over,
});
const photo = { uri: 'blob:web/1', base64: 'QUJD', thumbnailBase64: 'eA==', uploadId: 'photo-1' };

function unitTests() {
  let clock = 1_000;
  const now = () => clock;

  // Same account restores every field; another account never sees it and discards it.
  let backend = sessionBackend();
  let store = drafts.createPickDraftStore(backend, now);
  assert.equal(store.save('owner', fields()), true);
  const restored = store.load('owner');
  assert.equal(restored.review, '육수가 깔끔해요');
  assert.equal(restored.step, 5);
  assert.equal(restored.photo, null);
  assert.equal(restored.photoLost, false);
  assert.equal(store.load('other'), null, 'another account never receives the draft');
  assert.equal(store.load('owner'), null, 'and the draft was discarded');

  // Account switch outside the screen (auth event) discards; the owner keeps it.
  store.save('owner', fields());
  store.discardForOtherUser('owner');
  assert.ok(store.load('owner'));
  store.discardForOtherUser('other');
  assert.equal(store.load('owner'), null);

  // TTL bounds a restored browser session.
  store.save('owner', fields());
  clock += drafts.PICK_DRAFT_TTL_MS + 1;
  assert.equal(store.load('owner'), null);

  // Web photo: stored as base64, restored as a data URL (blob URLs die with the page).
  store.save('owner', fields());
  assert.equal(store.savePhoto('owner', photo), true);
  const withPhoto = store.load('owner');
  assert.equal(withPhoto.photo.uri, 'data:image/jpeg;base64,QUJD');
  assert.equal(withPhoto.photo.base64, 'QUJD');
  assert.equal(withPhoto.photo.uploadId, 'photo-1');
  assert.equal(withPhoto.photoLost, false);
  assert.equal(store.savePhoto('owner', null), true);
  assert.equal(store.load('owner').photo, null);
  assert.equal(store.load('owner').photoLost, false, 'removing the photo is not a loss');

  // Native memory keeps the original file URI for the running process.
  const memory = drafts.createPickDraftStore(drafts.memoryBackend(), now);
  memory.save('owner', fields());
  memory.savePhoto('owner', { ...photo, uri: 'file:///cache/photo.jpg' });
  assert.equal(memory.load('owner').photo.uri, 'file:///cache/photo.jpg');

  // Quota exceeded: the photo is reported lost, the rest of the draft is intact.
  backend = sessionBackend(2_000);
  store = drafts.createPickDraftStore(backend, now);
  store.save('owner', fields());
  assert.equal(store.savePhoto('owner', { ...photo, base64: 'A'.repeat(5_000) }), false);
  const lost = store.load('owner');
  assert.equal(lost.photo, null);
  assert.equal(lost.photoLost, true);
  assert.equal(lost.review, '육수가 깔끔해요');
  assert.equal(lost.menu.name, '평양냉면');

  // Unreadable / missing photo record is a loss, not a silent success.
  backend = sessionBackend();
  store = drafts.createPickDraftStore(backend, now);
  store.save('owner', fields());
  store.savePhoto('owner', photo);
  backend.values.set('onepick:pick-draft-photo:v1', '{not json');
  assert.equal(store.load('owner').photoLost, true);
  store.savePhoto('owner', photo);
  backend.values.delete('onepick:pick-draft-photo:v1');
  assert.equal(store.load('owner').photoLost, true);

  // Blocked storage: nothing is reported as saved or restorable.
  backend = sessionBackend();
  store = drafts.createPickDraftStore(backend, now);
  backend.failAll = true;
  assert.equal(store.save('owner', fields()), false);
  assert.equal(store.load('owner'), null);
  backend.failAll = false;

  // Tampered/invalid fields are discarded, not partially applied.
  store.save('owner', fields());
  const raw = JSON.parse(backend.values.get('onepick:pick-draft:v1'));
  raw.fields.step = 6;
  backend.values.set('onepick:pick-draft:v1', JSON.stringify(raw));
  assert.equal(store.load('owner'), null);
  assert.equal(backend.values.size, 0);

  nearQuotaTests(now);
}

// Sizes of the draft record ('stored' marker) and of the photo record, measured on
// unlimited storage so the quota boundaries below are exact.
function measure(now, draftFields, draftPhoto) {
  const backend = sessionBackend();
  const store = drafts.createPickDraftStore(backend, now);
  store.save('owner', draftFields);
  store.savePhoto('owner', draftPhoto);
  return { record: backend.values.get('onepick:pick-draft:v1').length, photo: backend.values.get('onepick:pick-draft-photo:v1').length };
}

function nearQuotaTests(now) {
  const bigPhoto = { ...photo, base64: 'B'.repeat(600) };
  const size = measure(now, fields(), bigPhoto);
  const KEY = 'onepick:pick-draft:v1';
  const PHOTO_KEY = 'onepick:pick-draft-photo:v1';

  // 1. The photo record fits, but the draft record's none→stored update does not
  //    ('stored' is 2 characters longer than 'none'). Not a success: the photo is
  //    reported lost so the restore asks for it, and the other input is intact.
  let backend = sessionBackend(size.record - 2 + size.photo + 1);
  let store = drafts.createPickDraftStore(backend, now);
  assert.equal(store.save('owner', fields()), true);
  assert.equal(store.savePhoto('owner', bigPhoto), false, 'a partial photo commit is not a success');
  let restored = store.load('owner');
  assert.equal(restored.photo, null);
  assert.equal(restored.photoLost, true, 'the person is asked to choose the photo again');
  assert.equal(restored.review, '육수가 깔끔해요');
  assert.equal(restored.step, 5);
  assert.equal(backend.values.has(PHOTO_KEY), false, 'the orphaned photo record is removed');

  // 2. The photo is stored, then a later field save (longer review, earlier step) no
  //    longer fits next to it. The latest fields win over the photo; the older draft
  //    is never restored as if it were current.
  const latest = fields({ step: 4, review: `${'새로 쓴 한줄평 '.repeat(4)}끝` });
  backend = sessionBackend(size.record + size.photo + 5);
  store = drafts.createPickDraftStore(backend, now);
  assert.equal(store.save('owner', fields()), true);
  assert.equal(store.savePhoto('owner', bigPhoto), true);
  assert.equal(store.save('owner', latest), true, 'the latest fields are saved by giving up the photo');
  restored = store.load('owner');
  assert.equal(restored.review, latest.review, 'the latest review, not the stale one');
  assert.equal(restored.step, 4);
  assert.equal(restored.photo, null);
  assert.equal(restored.photoLost, true);
  // A later photo change still gets a fresh attempt (and fails honestly here).
  assert.equal(store.savePhoto('owner', bigPhoto), false);
  assert.equal(store.load('owner').review, latest.review);

  // 2b. Even without the photo the latest fields do not fit: nothing is restorable,
  //     instead of the older draft coming back as a normal draft.
  backend = sessionBackend(size.record + size.photo + 5);
  store = drafts.createPickDraftStore(backend, now);
  store.save('owner', fields());
  store.savePhoto('owner', bigPhoto);
  assert.equal(store.save('owner', fields({ review: 'C'.repeat(size.record + size.photo) })), false);
  assert.equal(store.load('owner'), null, 'a stale draft is never restored');
  assert.equal(backend.values.has(KEY), false);
  assert.equal(backend.values.has(PHOTO_KEY), false);

  // 2c. Same for a draft that never had a photo.
  backend = sessionBackend(size.record + 10);
  store = drafts.createPickDraftStore(backend, now);
  store.save('owner', fields());
  assert.equal(store.save('owner', fields({ review: 'D'.repeat(size.record) })), false);
  assert.equal(store.load('owner'), null);
}

// ---------------------------------------------------------------------------
// Real screen with stubbed hooks; unlike the static store-first harness this one
// runs effects (hydration, persistence, resume re-check) after each render.
let states, refs, stateIndex, refIndex, effectIndex, effectDeps, pendingEffects, pressables, inputs, destination, uuidCounter, routeParams;
const part = (tag) => ({ children }) => React.createElement(tag, null, children);
const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';
const { AppError } = load('errors/appError.ts');
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
  useEffect: (effect, deps) => {
    const i = effectIndex++;
    const previous = effectDeps[i];
    if (!previous || !deps || deps.length !== previous.length || deps.some((dep, k) => !Object.is(dep, previous[k]))) {
      effectDeps[i] = deps;
      pendingEffects.push(effect);
    }
  },
};
const ui = require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } });
const pickChannel = load('lib/items/pickChannel.ts');
const service = load('services/storeFirstService.ts', {
  '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
  '@/lib/supabase/client': { supabase: {} },
});

let auth, calls, detail, selectResult, selectFails, choosePhotoResult, draftStore, menuOptionsQuery, aiQuery;
const mutation = (name, run) => ({ isPending: false, isError: false, error: null, reset() {},
  mutateAsync: async (input) => { calls.push([name, input]); return run(input); } });
const { default: Screen } = load('app/pick/new.tsx', { '@/lib/navigation/swipeBack': { useSwipeBackHandler() {} },
  react: fakeReact, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: part('section') },
  'expo-crypto': { randomUUID: () => `request-${++uuidCounter}` },
  'expo-router': {
    useLocalSearchParams: () => routeParams,
    useRouter: () => ({ push: (route) => { destination = route; }, replace: (route) => { destination = route; }, back() { destination = 'back'; }, canGoBack: () => true }),
  },
  '@/components/ui': ui, '@/errors/appError': { AppError },
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useItemDetail': { useItemDetail: (itemId) => ({ data: itemId ? detail : undefined, refetch: async () => {} }) },
  '@/hooks/useRegisterPick': {
    useChoosePhoto: () => mutation('choosePhoto', () => choosePhotoResult),
    useReadCurrentPickSlot: () => mutation('currentSlot', () => null),
    useRegisterItemPick: () => mutation('register', (input) => ({ itemId: input.itemId ?? 'created', pickId: 'pick-1', published: true, replacedPickId: null, retried: false })),
  },
  '@/hooks/useLinkCategorySuggestions': { useLinkCategorySuggestions: () => ({
    data: undefined, isPending: false, isError: false, isSuccess: false, error: null, mutate() {}, reset() {},
  }) },
  '@/hooks/useStoreFirst': {
    useProviderStorePrefill: () => ({ data: null, isPending: true, isLoading: false, isError: false }),
    useStoreSearch: (channel, query, enabled) => ({ data: enabled && query.trim() ? [
      { kind: 'place', catalogId: 'cat-1', name: '을밀대', branchName: null, region: '서울 마포구', address: '숭문길 24', providerCategory: '국수/칼국수', mapUrl: null },
    ] : [], valid: enabled && query.trim().length > 0, isWaiting: false, isFetching: false, isError: false, refetch() {} }),
    useMenuOptions: () => menuOptionsQuery,
    useMenuSuggestions: (store, key, menuName, enabled) => ({ ...aiQuery, data: enabled && menuName.trim() ? aiQuery.data : undefined }),
    useSelectStoreItem: () => mutation('select', () => { if (selectFails) throw new AppError('ITEM_NOT_FOUND'); return selectResult; }),
  },
  '@/lib/items/pickChannel': pickChannel,
  '@/lib/items/pickSavedToast': { armPickSavedToast() {} },
  '@/lib/photos/photoFailure': { showPhotoFailure() {}, isPhotoFailure: () => false },
  '@/lib/pick/pickDraft': { ...drafts, pickDraftStore: () => draftStore },
  '@/services/storeFirstService': service,
});

function mount() { states = []; refs = []; effectDeps = []; }
const menuList = [{ categoryId: 'cat-naengmyeon', name: '평양냉면', groupName: '면', placeEnabled: true }];
const menusLoaded = () => ({ data: menuList, isSuccess: true, isError: false, refetch() {} });
const menusLoading = () => ({ data: undefined, isSuccess: false, isError: false, refetch() {} });
const menusFailed = () => ({ data: undefined, isSuccess: false, isError: true, refetch() {} });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function reset(backend = sessionBackend()) {
  mount(); calls = []; destination = undefined; uuidCounter = 0; routeParams = {};
  auth = { user: { id: 'owner' }, isLoading: false, error: null };
  detail = { item: { id: 'item-1', imagePath: null, imageUrl: null, thumbnailUrl: null, imageSourceUrl: null }, myPickStatus: { type: 'not_selected' } };
  selectResult = { itemId: 'item-1', categoryId: 'cat-naengmyeon', hasPhoto: false, pending: false };
  selectFails = false;
  choosePhotoResult = { ...photo };
  menuOptionsQuery = menusLoaded();
  aiQuery = { data: undefined, isPending: true, isFetching: false, isError: false };
  draftStore = drafts.createPickDraftStore(backend);
  return backend;
}
async function render() {
  let page;
  for (let pass = 0; pass < 4; pass++) {
    stateIndex = 0; refIndex = 0; effectIndex = 0; pressables = []; inputs = []; pendingEffects = [];
    page = renderToStaticMarkup(React.createElement(Screen));
    const effects = pendingEffects;
    for (const effect of effects) effect();
    await flush();
    if (effects.length === 0) break;
  }
  return page;
}
function press(label) {
  const found = pressables.find((props) => props.accessibilityLabel === label || textOf(props.children) === label || textOf(props.children).includes(label));
  assert.ok(found, `Expected control: ${label}`);
  assert.ok(!found.disabled, `Control is disabled: ${label}`);
  return found.onPress();
}
const isDisabled = (label) => pressables.find((props) => textOf(props.children) === label)?.disabled;
const input = (label) => { const found = inputs.find((props) => props.accessibilityLabel === label); assert.ok(found, `Expected input: ${label}`); return found; };
const stepOf = (page) => /(\d) \/ 4/.exec(page)?.[1];
const count = (name) => calls.filter(([n]) => n === name).length;

// Store -> menu -> photo -> review typed on the last step (not submitted).
async function writeUntilReview() {
  await render(); press('URL 없음'); await render(); input('매장명 검색').onChangeText('을밀대'); await render(); press('을밀대 선택'); await render();
  input('메뉴 이름').onChangeText('평양냉면'); await render();
  press('다음'); await flush(); await render();
  press('사진 고르기'); await flush(); await render(); press('다음'); await render();
  input('원픽 한줄평').onChangeText('육수가 깔끔해요'); return render();
}

async function screenTests() {
  // 1. Same account after an OAuth full-page round trip (remount): nothing is shown
  //    while the session is checked, then the review step returns after the menu is
  //    re-checked on the server, with no automatic submit.
  reset();
  let page = await writeUntilReview();
  assert.equal(stepOf(page), '4');
  const selectsBefore = count('select');
  const slotsBefore = count('currentSlot');
  mount(); auth = { user: null, isLoading: true, error: null };
  page = await render();
  assert.match(page, /로그인 상태를 확인하고 있어요/);
  assert.doesNotMatch(page, /을밀대|육수가/);
  assert.ok(draftStore.load('owner'), 'the draft is not cleared while the session is unresolved');
  auth = { user: { id: 'owner' }, isLoading: false, error: null };
  page = await render(); page = await render();
  assert.equal(stepOf(page), '4', 'returns to the review step');
  assert.equal(input('원픽 한줄평').value, '육수가 깔끔해요');
  assert.equal(count('select'), selectsBefore + 1, 'item selection re-checked on the server');
  assert.equal(count('currentSlot'), slotsBefore + 1, 'current Pick slot re-read');
  assert.equal(count('register'), 0, 'no automatic submit');
  press('원픽 등록하기'); await flush(); page = await render();
  assert.equal(count('register'), 1);
  const saved = calls.find(([n]) => n === 'register')[1];
  assert.equal(saved.photo.base64, 'QUJD', 'restored photo used, rebuilt from base64');
  assert.equal(saved.oneLineReview, '육수가 깔끔해요');
  assert.equal(destination.pathname, '/item/[itemId]', 'save follows the current item-detail success contract');
  assert.equal(destination.params.itemId, 'item-1');
  assert.equal(destination.params.pickId, 'pick-1');
  assert.doesNotMatch(page, /원픽을 정했어요/, 'the registration screen no longer renders a success dialog');
  assert.equal(draftStore.load('owner'), null, 'submit success clears the draft');

  // 2. Another account after the round trip: empty form, draft discarded.
  reset();
  await writeUntilReview();
  mount(); auth = { user: { id: 'other' }, isLoading: false, error: null };
  page = await render();
  assert.equal(stepOf(page), '1');
  assert.doesNotMatch(page, /을밀대|육수가/);
  assert.equal(draftStore.load('owner'), null);

  // 3. Session expires while the screen stays mounted: login card, draft kept, same
  //    account re-login keeps the in-memory input (native OAuth hop).
  reset();
  await writeUntilReview();
  auth = { user: null, isLoading: false, error: null };
  page = await render();
  assert.match(page, /로그인하고 원픽을 등록해보세요/);
  assert.ok(draftStore.load('owner'), 'expiry keeps the draft');
  auth = { user: { id: 'owner' }, isLoading: false, error: null };
  page = await render();
  assert.equal(stepOf(page), '4');
  assert.equal(input('원픽 한줄평').value, '육수가 깔끔해요');

  // 4. Another account signs in on the same mounted screen: in-memory input dropped.
  auth = { user: null, isLoading: false, error: null }; await render();
  auth = { user: { id: 'other' }, isLoading: false, error: null };
  page = await render();
  assert.equal(stepOf(page), '1');
  assert.doesNotMatch(page, /육수가/);
  assert.equal(draftStore.load('owner'), null);

  // 5. Photo could not be kept (quota): other input restored, the person is asked to
  //    choose the photo again, and the required-photo gate still holds.
  reset(sessionBackend(3_000));
  choosePhotoResult = { ...photo, base64: 'A'.repeat(10_000) };
  await writeUntilReview();
  mount();
  page = await render(); page = await render();
  assert.equal(stepOf(page), '3', 'returns to the photo step, not the review step');
  assert.match(page, /사진을 다시 선택해주세요/);
  assert.equal(isDisabled('다음'), true, 'required photo cannot be skipped');
  assert.equal(count('register'), 0);
  choosePhotoResult = { ...photo };
  press('사진 고르기'); await flush(); page = await render();
  assert.doesNotMatch(page, /사진을 다시 선택해주세요/);
  press('다음'); page = await render();
  assert.equal(stepOf(page), '4');
  assert.equal(input('원픽 한줄평').value, '육수가 깔끔해요', 'review kept despite the photo loss');

  // 5b. The loss marker survives a second round trip before reselecting.
  reset(sessionBackend(3_000));
  choosePhotoResult = { ...photo, base64: 'A'.repeat(10_000) };
  await writeUntilReview();
  mount(); await render(); await render();
  mount(); page = await render(); page = await render();
  assert.match(page, /사진을 다시 선택해주세요/);

  // 6. Item already has a photo: no photo request, review step returns directly.
  reset();
  selectResult = { itemId: 'item-1', categoryId: 'cat-naengmyeon', hasPhoto: true, pending: false };
  await render(); press('URL 없음'); await render(); input('매장명 검색').onChangeText('을밀대'); await render(); press('을밀대 선택'); await render();
  input('메뉴 이름').onChangeText('평양냉면'); await render();
  press('다음'); await flush(); await render();
  input('원픽 한줄평').onChangeText('또 가고 싶어요'); await render();
  mount(); page = await render(); page = await render();
  assert.equal(stepOf(page), '4');
  assert.doesNotMatch(page, /사진을 다시 선택해주세요/);

  // 7. Server re-check fails: stay on the menu step (its error shows there), no submit,
  //    the draft is kept for another try.
  reset();
  await writeUntilReview();
  selectFails = true;
  mount();
  page = await render(); page = await render();
  assert.equal(stepOf(page), '2');
  assert.equal(count('register'), 0);
  assert.ok(draftStore.load('owner'));

  // 7b. While the session is still being checked, even a stale user object must not
  //     load (or discard) a draft: the owner resolves and still gets it back.
  reset();
  await writeUntilReview();
  mount(); auth = { user: { id: 'other' }, isLoading: true, error: null };
  page = await render();
  assert.match(page, /로그인 상태를 확인하고 있어요/);
  assert.ok(draftStore.load('owner'), 'no read/discard during the auth check');
  auth = { user: { id: 'owner' }, isLoading: false, error: null };
  page = await render(); page = await render();
  assert.equal(stepOf(page), '4');

  // 8. A restored step-1 draft still enables ordinary store search even though
  //    the disabled provider-prefill query reports isPending=true in Query v5.
  reset();
  draftStore.save('owner', fields({
    step: 1, query: '을밀대', store: null, menuQuery: '', menu: null, review: '',
  }));
  mount();
  page = await render(); page = await render();
  assert.equal(stepOf(page), '1');
  assert.equal(input('매장명 검색').value, '을밀대');
  assert.ok(pressables.some((props) => props.accessibilityLabel === '을밀대 선택'),
    'restored step-1 draft may search normally');

  // A legacy manual category is never trusted when restoring a later step.
  reset();
  draftStore.save('owner', fields({ manualCategory: true, categoryQuery: '잘못된 분류',
    menu: { categoryId: 'legacy-wrong-category', name: '평양냉면' } }));
  mount(); await render(); page = await render();
  assert.equal(calls.find(([name]) => name === 'select')[1].categoryId, 'cat-naengmyeon');
  assert.equal(count('register'), 0);
  assert.equal(draftStore.load('owner').review, '육수가 깔끔해요');

  // 9. Explicit cancel clears the draft.
  reset();
  await writeUntilReview();
  press('원픽 등록 취소');
  assert.equal(destination, 'back');
  assert.equal(draftStore.load('owner'), null);

  // 9. Early steps restore as they were (menu step keeps its selection).
  reset();
  await render(); press('URL 없음'); await render(); input('매장명 검색').onChangeText('을밀대'); await render(); press('을밀대 선택'); await render();
  input('메뉴 이름').onChangeText('평양냉면'); await render();
  mount(); page = await render(); page = await render();
  assert.equal(stepOf(page), '2');
  assert.equal(input('메뉴 이름').value, '평양냉면');
  press('이전 단계'); page = await render();
  assert.equal(stepOf(page), '1');
  assert.equal(input('매장명 검색').value, '을밀대',
    'restored name-search flow returns to the saved store query, not an empty link screen');
  assert.ok(pressables.some((props) => props.accessibilityLabel === '을밀대 선택'),
    'restored name-search results remain available after going back from 2/4');
  assert.equal(count('register'), 0);

  // 10. (#836 H1) Menu list still loading when a later step is restored: the
  //     unclassified fallback must not be auto-confirmed. The restore waits on the
  //     menu step, then resumes with the classified category once the list arrives.
  reset();
  await writeUntilReview();
  const selectsAtRestore = count('select'), slotsAtRestore = count('currentSlot');
  mount(); menuOptionsQuery = menusLoading();
  page = await render(); page = await render();
  assert.equal(stepOf(page), '2', 'restore waits for the menu list instead of confirming');
  assert.equal(count('select'), selectsAtRestore, 'no item selection before the menu list is known');
  assert.equal(count('currentSlot'), slotsAtRestore);
  assert.equal(count('register'), 0);
  assert.ok(draftStore.load('owner').photo, 'restored photo kept while waiting');
  menuOptionsQuery = menusLoaded();
  page = await render(); page = await render();
  assert.equal(stepOf(page), '4', 'resumes to the review step once the menu is classified');
  assert.equal(count('select'), selectsAtRestore + 1, 'resumed with the catalog category, not as unclassified');
  assert.equal(calls.filter(([name]) => name === 'select').at(-1)[1].categoryId, 'cat-naengmyeon');
  assert.equal(count('currentSlot'), slotsAtRestore + 1);
  assert.equal(input('원픽 한줄평').value, '육수가 깔끔해요');
  assert.equal(count('register'), 0, 'no automatic submit');
  press('원픽 등록하기'); await flush(); page = await render();
  let resumed = calls.find(([n]) => n === 'register')[1];
  assert.equal(resumed.itemId, 'item-1', 'saved against the classified catalog item');
  assert.equal(resumed.categoryId, 'cat-naengmyeon');
  assert.equal(resumed.photo.base64, 'QUJD', 'restored photo used');
  assert.equal(resumed.oneLineReview, '육수가 깔끔해요');

  // 10b. Same restore while the menu list is loading, then the list loads but the
  //      name is unknown: the AI pass is awaited too, and when it settles with no
  //      match nothing is confirmed by itself. The person's own "다음" keeps the
  //      quick unclassified registration with the restored photo and review.
  reset();
  draftStore.save('owner', fields({ menuQuery: '비법 국수', menu: { categoryId: null, name: '비법 국수' } }));
  draftStore.savePhoto('owner', photo);
  mount(); menuOptionsQuery = menusLoading();
  page = await render(); page = await render();
  assert.equal(stepOf(page), '2');
  menuOptionsQuery = menusLoaded();
  aiQuery = { data: undefined, isPending: false, isFetching: true, isError: false };
  page = await render(); await sleep(500); page = await render(); page = await render();
  assert.equal(stepOf(page), '2', 'still waiting while the AI classification is running');
  assert.equal(count('select'), 0);
  aiQuery = { data: { suggestions: [], needsNewCategory: false }, isPending: false, isFetching: false, isError: false };
  page = await render(); page = await render();
  assert.equal(stepOf(page), '2', 'an unclassified result never resumes on its own');
  assert.equal(input('메뉴 이름').value, '비법 국수');
  assert.equal(count('select'), 0);
  assert.equal(count('register'), 0);
  assert.ok(draftStore.load('owner').photo, 'restored photo kept for the manual confirmation');
  assert.equal(draftStore.load('owner').review, '육수가 깔끔해요');
  press('다음'); await flush(); page = await render();
  assert.equal(stepOf(page), '4', 'manual confirmation returns to the restored review with its photo');
  assert.equal(input('원픽 한줄평').value, '육수가 깔끔해요');
  assert.equal(count('select'), 0, 'unclassified registration selects no catalog item');
  press('원픽 등록하기'); await flush(); page = await render();
  resumed = calls.find(([n]) => n === 'register')[1];
  assert.equal(resumed.categoryId, null);
  assert.equal(resumed.menuName, '비법 국수');
  assert.equal(resumed.itemId, undefined);
  assert.equal(resumed.photo.base64, 'QUJD');
  assert.equal(resumed.oneLineReview, '육수가 깔끔해요');

  // 10c. Menu list fails to load: nothing is confirmed for the person; the manual
  //      path (fallback + retry card) stays available.
  reset();
  await writeUntilReview();
  const selectsAtFailedRestore = count('select');
  mount(); menuOptionsQuery = menusFailed();
  page = await render(); page = await render();
  assert.equal(stepOf(page), '2', 'a failed menu list never auto-confirms the restore');
  assert.equal(count('select'), selectsAtFailedRestore);
  assert.equal(count('register'), 0);
  assert.ok(!isDisabled('다음'), 'the person may still continue by hand');
  menuOptionsQuery = menusLoaded();
  page = await render(); page = await render();
  assert.equal(stepOf(page), '4', 'a later successful load still resumes the classified restore');
  assert.equal(count('select'), selectsAtFailedRestore + 1);
  assert.equal(calls.filter(([name]) => name === 'select').at(-1)[1].categoryId, 'cat-naengmyeon');
}

async function signOutTests() {
  const cleared = [];
  let signOutError = null;
  const signedOut = [];
  const hook = load('hooks/useSignOut.ts', {
    '@tanstack/react-query': { useMutation: (options) => options, useQueryClient: () => ({ cancelQueries: async () => {}, clear() {} }) },
    '@/services': { authService: { signOut: async () => { signedOut.push(true); if (signOutError) throw signOutError; } } },
    '@/lib/pick/pickDraft': { clearPickDraft: () => cleared.push(true) },
  });
  const options = hook.useSignOut();
  await options.mutationFn();
  assert.equal(signedOut.length, 1);
  assert.equal(cleared.length, 1, 'explicit sign-out clears the draft');
  signOutError = new Error('network');
  await assert.rejects(options.mutationFn());
  assert.equal(cleared.length, 1, 'a failed sign-out keeps the draft (session still active)');
}

async function main() {
  unitTests();
  await screenTests();
  await signOutTests();
  console.log('pick draft restore checks passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

