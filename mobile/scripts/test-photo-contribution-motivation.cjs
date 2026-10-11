const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient } = require('@tanstack/react-query');
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, setTimeout, clearTimeout, require(name) {
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    // The choose screen imports these only for comment-origin registration;
    // preserve every existing test hook while rejecting unexpected new writes.
    if (name === 'expo-crypto') return { randomUUID: () => '11111111-1111-4111-8111-111111111111' };
    if (name === '@/hooks/useRegisterPick') {
      const hooks = imports[name] ?? {};
      return { ...hooks, useRegisterItemPick: hooks.useRegisterItemPick ?? (() => ({
        isPending: false, error: null,
        mutateAsync: async () => { throw new Error('unexpected comment-origin registration'); },
      })) };
    }
    if (name in imports) return imports[name];
    // The choose screen reads its originating comment thread only for a
    // comment-origin entry; ordinary entries keep the lookup disabled.
    if (name === '@/hooks/usePickDetail') return { usePickDetail: (pickId) => {
      if (pickId) throw new Error('unexpected comment-thread lookup');
      return { data: undefined, isPending: true, isError: false, isFetching: false };
    } };
    // Pure channel helpers of the choose screen load as-is.
    if (name === '@/lib/home/homeChannels') return load('lib/home/homeChannels.ts');
    if (name === '@/lib/items/pickChannel') return load('lib/items/pickChannel.ts');
    if (name === '@/services/onboardingService') return { onboardingService: { recordAction: async () => {} } };
    assert.fail(`Unexpected import: ${name}`);
  } });
  return exports;
}
const { AppError } = load('errors/appError.ts');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const text = (v) => v == null || typeof v === 'boolean' ? '' : Array.isArray(v) ? v.map(text).join('')
  : typeof v === 'object' ? text(v.props?.children) : String(v);
function harness(file, imports) {
  const instances = new Map(); let active, nodes, used, tree; const scrolls = [];
  const hooks = {
    useState(initial) {
      const owner = active, i = owner.index++;
      if (!(i in owner.slots)) owner.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [owner.slots[i], (next) => { owner.slots[i] = typeof next === 'function' ? next(owner.slots[i]) : next; }];
    },
    useRef(initial) {
      const owner = active, i = owner.index++;
      if (!(i in owner.slots)) owner.slots[i] = { current: initial };
      return owner.slots[i];
    },
    useMemo: (fn) => fn(), useCallback: (fn) => fn, useEffect() {},
  };
  const native = { StyleSheet: { create: (s) => s } };
  for (const n of ['View','Text','TextInput','ScrollView','ActivityIndicator','Image','Pressable']) native[n] = n;
  const Screen = load(file, { react: hooks, 'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '@/errors/appError': { AppError },
    '@/components/pick-photo': { PickPhoto: 'PickPhoto' }, '@/components/pick-photo-step': { PickPhotoStep: () => null }, '@/components/item-pick-count': { ItemPickCount: 'ItemPickCount' }, '@/components/item-channel-links': { ItemChannelLinks: 'ItemChannelLinks' }, '@/components/youtube-video-link': { YouTubeVideoLink: 'ItemChannelLinks' },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: 'PickPhoto' }, '@/components/pick-photo-step': { PickPhotoStep: () => null } }),
    '@/components/item-review-card': { ItemReviewCard: 'ItemReviewCard' },
    '@/lib/photos/photoFailure': { showPhotoFailure() {}, isPhotoFailure: () => false },
    '@/lib/home/homeChannels': load('lib/home/homeChannels.ts'), '@/lib/items/itemTitle': load('lib/items/itemTitle.ts'), '@/lib/items/pickSavedToast': load('lib/items/pickSavedToast.ts'), '@/lib/categories/registrationRoute': load('lib/categories/registrationRoute.ts'),
    '@/services': { observabilityService: { captureProductEvent: async () => {} } }, ...imports }).default;
  function walk(v, location) {
    if (v == null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((c, i) => walk(c, `${location}/${i}`));
    const key = `${location}:${v.key ?? ''}`;
    if (typeof v.type === 'function') {
      let owner = instances.get(key);
      if (!owner) { owner = { slots: [], index: 0 }; instances.set(key, owner); }
      used.add(key); owner.index = 0; active = owner;
      return walk(v.type(v.props), `${key}/render`);
    }
    if (v.type === 'ScrollView' && v.props.ref) v.props.ref.current = { scrollTo: (p) => scrolls.push(p) };
    const node = { ...v, props: { ...v.props, children: walk(v.props.children, `${key}/children`) } };
    nodes.push(node); return node;
  }
  return {
    render() { used = new Set(); nodes = []; tree = walk(jsx(Screen, {}), 'root'); for (const key of instances.keys()) if (!used.has(key)) instances.delete(key); return text(tree); },
    button(label) { const n = nodes.find((n) => n.type === 'Pressable' && (n.props.accessibilityLabel === label || text(n) === label)); assert.ok(n, `Missing ${label}`); return n.props; },
    hasButton(label) { return nodes.some((n) => n.type === 'Pressable' && (n.props.accessibilityLabel === label || text(n) === label)); },
    nodes: () => nodes, scrolls,
  };
}
const itemId = 'a1111111-1111-4111-8111-111111111111';
const categoryId = 'b2222222-2222-4222-8222-222222222222';
const pickId = 'c3333333-3333-4333-8333-333333333333';
const baseItem = { id: itemId, name: '진라면', categoryId, status: 'active', imagePath: null, imageUrl: null, thumbnailUrl: null, imageSourceUrl: null };
function choice() {
  const auth = { user: { id: 'owner' }, isLoading: false, error: null };
  const params = { itemId, categoryId };
  // New picks of a photo-less item now need the photo first (test-choose-photo-first),
  // so the post-save invitation remains only for editing the review of an existing
  // pick whose item still has no photo.
  const query = { data: { item: { ...baseItem }, canChoose: true, myPickStatus: { type: 'selected_this', pickId, oneLineReview: '예전 이유' } }, isPending: false, isError: false, isFetching: false };
  const writes = [], destinations = [], pending = [];
  const mutation = { isPending: false, isError: false, mutateAsync: (p) => { writes.push(p); return new Promise((resolve, reject) => pending.push({ resolve, reject })); } };
  const view = harness('app/pick/choose.tsx', {
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ push: (r) => destinations.push(r), replace: (r) => destinations.push(r), canGoBack: () => true, back() {} }) },
    '@/hooks/useAuthSession': { useAuthSession: () => auth }, '@/hooks/useItemDetail': { useItemDetail: () => query },
    '@/hooks/useChoosePick': { useChoosePick: () => mutation, useRequestPendingPick: () => ({ isPending: false, error: null }) },
  });
  const start = () => { view.render(); view.nodes().find((n) => n.type === 'TextInput').props.onChangeText('나의 이유'); view.render(); view.button('한줄평 저장하기').onPress(); };
  const finish = async () => { pending[0].resolve({ id: pickId, itemId, categoryId, userId: 'owner', oneLineReview: '나의 이유', status: 'active' }); await flush(); return view.render(); };
  return { auth, params, query, mutation, view, writes, destinations, pending, start, finish };
}
async function main() {
  let c = choice(); assert.doesNotMatch(c.view.render(), /사진도 남겨볼까요/);
  c.start(); assert.doesNotMatch(c.view.render(), /사진도 남겨볼까요/);
  let page = await c.finish();
  assert.match(page, /내가 고른 진라면에 사진도 남겨볼까요/);
  assert.match(page, /같은 원픽을 고른 사람들의 카드/);
  assert.ok(c.view.hasButton('내 원픽 보기')); assert.ok(c.view.hasButton('다른 사람의 원픽 계속 보기'));
  assert.ok(page.indexOf('다른 사람의 원픽 계속 보기') < page.indexOf('사진도 남겨볼까요'), 'Primary browsing actions are not replaced by the optional task');
  const invitation = c.view.button('내 원픽 사진 등록하기').onPress;
  invitation(); invitation();
  assert.equal(c.destinations.length, 1); assert.equal(c.writes.length, 1, 'Invitation never saves the Pick again');
  assert.equal(c.destinations[0].pathname, '/item/[itemId]'); assert.equal(c.destinations[0].params.itemId, itemId); assert.equal(c.destinations[0].params.photo, '1');
  c = choice(); c.start(); await c.finish(); const old = c.view.button('내 원픽 사진 등록하기').onPress;
  c.view.button('지금은 넘어가기').onPress(); old(); page = c.view.render();
  assert.doesNotMatch(page, /사진도 남겨볼까요/); assert.equal(c.destinations.length, 0); assert.equal(c.writes.length, 1);
  assert.ok(c.view.hasButton('내 원픽 보기')); assert.ok(c.view.hasButton('다른 사람의 원픽 계속 보기'));
  assert.doesNotMatch(c.view.render(), /사진도 남겨볼까요/, 'Dismissed receipt does not nag on rerender');
  for (const patch of [{ imagePath: 'owner/full.jpg' }, { imageUrl: 'https://image.test/full.jpg' }, { thumbnailUrl: 'https://image.test/thumb.jpg' }, { imageSourceUrl: 'https://image.tmdb.org/t/p/w342/poster.jpg' }, { status: 'hidden' }]) {
    c = choice(); c.start(); await c.finish(); c.query.data.item = { ...baseItem, ...patch };
    assert.doesNotMatch(c.view.render(), /사진도 남겨볼까요/, 'Use latest item, never the saved empty snapshot');
  }
  for (const field of ['isError','isPending','isFetching']) {
    c = choice(); c.start(); await c.finish(); c.query[field] = true;
    assert.doesNotMatch(c.view.render(), /사진도 남겨볼까요/); assert.ok(c.view.hasButton('내 원픽 보기'), 'Metadata problems do not revoke the save receipt');
  }
  c = choice(); c.start(); c.pending[0].reject(new Error('offline')); await flush(); assert.doesNotMatch(c.view.render(), /사진도 남겨볼까요/);
  c = choice(); c.start(); await c.finish(); c.auth.user = { id: 'another' }; assert.doesNotMatch(c.view.render(), /사진도 남겨볼까요/);

  const good = { item_id: itemId, user_id: 'owner', username: 'photo_owner', image_path: 'owner/full.jpg', image_source_url: null };
  let response = good, failure = null, call;
  const client = { rpc: (name, args) => { call = { name, args }; return { maybeSingle: async () => ({ data: response, error: failure }) }; } };
  const { ItemPhotoCreditService } = load('services/itemPhotoCreditService.ts', {
    '@/lib/supabase/client': { supabase: client }, '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError: (e) => e },
  });
  const service = new ItemPhotoCreditService(client);
  const credit = await service.get(itemId);
  assert.equal(call.name, 'item_photo_credit'); assert.equal(call.args.p_item_id, itemId); assert.equal(Object.keys(call.args).length, 1);
  assert.equal(credit.username, 'photo_owner');
  response = null; assert.equal(await service.get(itemId), null);
  response = { ...good, item_id: 'wrong-item' }; await assert.rejects(() => service.get(itemId), /INTERNAL_ERROR/);
  response = { ...good, username: '<script>' }; await assert.rejects(() => service.get(itemId), /INTERNAL_ERROR/);
  response = good; failure = new Error('offline'); await assert.rejects(() => service.get(itemId), /offline/); failure = null;

  const { queryKeys } = load('lib/query/queryKeys.ts');
  const detail = { data: { item: { ...baseItem, imagePath: good.image_path } }, isPending: false, isError: false, isFetching: false };
  const creditQuery = { data: credit, isPending: false, isError: false, isFetching: false };
  let options = [], index = 0;
  const { useItemDetail } = load('hooks/useItemDetail.ts', {
    '@tanstack/react-query': {
      useQuery: (o) => { options.push(o); return index++ % 2 === 0 ? detail : creditQuery; },
      useQueryClient: () => ({ getQueryData: () => undefined }),
    },
    '@/errors/appError': { AppError },
    '@/lib/query/queryKeys': { queryKeys }, '@/services': { itemService: { getItemDetail: async () => detail.data } },
    '@/services/itemPhotoCreditService': { itemPhotoCreditService: service },
  });
  const read = (user = 'viewer', include = true, enabled = true) => { options = []; index = 0; return useItemDetail(itemId, user, pickId, include, enabled); };
  assert.equal(read().photoCredit, credit); assert.equal(options[1].enabled, true);
  assert.equal(typeof options[0].retry, 'function');
  assert.equal(options[0].retry(0, new AppError('ITEM_NOT_FOUND')), false, 'Missing item links must fail immediately instead of staying pending through a retry');
  assert.equal(options[0].retry(0, new AppError('NETWORK_ERROR')), true, 'Transient detail failures keep the existing single retry');
  assert.equal(options[0].retry(1, new AppError('NETWORK_ERROR')), false, 'Item detail must not retry transient failures more than once');
  const firstKey = JSON.stringify(options[1].queryKey);
  read('other'); assert.notEqual(JSON.stringify(options[1].queryKey), firstKey, 'Credit caches are viewer-specific');
  read(undefined, false); assert.equal(options[1].enabled, false, 'Non-detail callers do not fetch attribution');
  read('viewer', true, false);
  assert.equal(options[0].enabled, false, 'Session-gated detail reads stay disabled until auth resolves');
  assert.equal(options[1].enabled, false, 'Photo credit cannot start before the detail query is enabled');
  for (const field of ['isPending','isError','isFetching']) {
    creditQuery[field] = true; assert.equal(read().photoCredit, null); assert.equal(read().isError, false, 'Credit failure never fails the product'); creditQuery[field] = false;
    detail[field] = true; assert.equal(read().photoCredit, null); assert.equal(options[1].enabled, false); detail[field] = false;
  }
  detail.data.item.imagePath = 'other/new.jpg'; assert.equal(read().photoCredit, null, 'Never attach old credit to a replaced image');
  detail.data.item.imagePath = null; assert.equal(read().photoCredit, null); assert.equal(options[1].enabled, false);
  detail.data.item.imagePath = good.image_path; read();
  const cache = new QueryClient(); cache.setQueryData(options[1].queryKey, credit);
  await cache.invalidateQueries({ queryKey: queryKeys.items.all });
  assert.equal(cache.getQueryState(options[1].queryKey).isInvalidated, true); cache.clear();

  const auth = { user: { id: 'viewer' }, isLoading: false, error: null };
  let itemDetailArgs;
  const params = { itemId, pickId, photo: '1' }; const routes = [];
  const query = { ...detail, data: { item: { ...baseItem, imagePath: good.image_path, imageUrl: 'https://storage.test/full.jpg' }, category: { name: '라면' },
    picks: [{ pick: { id: pickId }, profile: null }], myPickStatus: { type: 'not_selected' }, canChoose: true }, photoCredit: credit };
  const view = harness('app/item/[itemId].tsx', {
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ push: (r) => routes.push(r), replace() {}, canGoBack: () => true, back() {} }) },
    '@/hooks/useAuthSession': { useAuthSession: () => auth }, '@/hooks/useItemDetail': { useItemDetail: (...args) => { itemDetailArgs = args; return query; } },
    '@/hooks/useRegisterPick': {
      useChoosePhoto: () => ({ isPending: false }),
      useAttachItemPhoto: () => ({ isPending: false }),
      useMyPendingItemPhoto: () => ({ data: null, isPending: false }),
      useRevisePendingItem: () => ({ isPending: false, mutateAsync: async () => ({}) }),
    },
    '@/hooks/useNotifications': { useReadNotificationGroup: () => ({ isPending: false, mutateAsync: async () => 0 }) },
    '@/services/storeFirstService': { isNaverMapUrl: () => true },
  });
  assert.match(view.render(), /사진 @photo_owner/);
  assert.equal(itemDetailArgs[3], true, 'Item detail screen requests photo attribution');
  assert.equal(itemDetailArgs[4], true, 'Resolved session enables the detail query');
  auth.isLoading = true; view.render();
  assert.equal(itemDetailArgs[4], false, 'Loading session keeps the detail query disabled');
  auth.isLoading = false; view.render();
  view.button('사진 등록자 @photo_owner 프로필 보기').onPress(); assert.equal(routes[0].params.username, 'photo_owner');
  assert.doesNotMatch(view.render(), /사진 올리기/);
  query.photoCredit = { ...credit, imagePath: 'stale.jpg' }; assert.doesNotMatch(view.render(), /@photo_owner/);
  query.photoCredit = null; assert.doesNotMatch(view.render(), /사진 등록 ·/);
  query.data.item = { ...baseItem };
  page = view.render(); assert.match(page, /사진을 올려주세요/, 'A missing photo is a one-line upload row');
  assert.doesNotMatch(page, /이름이 잘 보이는 사진이면|사진 없이도/, 'The upload row carries no extra guidance before a photo is chosen');
  assert.match(fs.readFileSync(path.join(__dirname, '../src/app/item/[itemId].tsx'), 'utf8'), /올린 사진은 관리자 검수 후 같은 걸 고른 사람들의 카드에 내 사용자명과 함께 표시돼요/, 'The chosen-photo preview keeps a one-line sharing notice (after admin review, L4)');
  view.nodes().find((n) => n.props.onLayout)?.props.onLayout({ nativeEvent: { layout: { y: 700 } } });
  assert.equal(view.scrolls.length, 0, 'Photo entry stays on uploader instead of jumping to the saved review');
  params.photo = undefined; view.render(); view.nodes().find((n) => n.props.onLayout)?.props.onLayout({ nativeEvent: { layout: { y: 700 } } });
  assert.equal(view.scrolls.length, 1, 'Normal discussion deep links still focus the review');
  query.isError = true; assert.doesNotMatch(view.render(), /사진 등록 ·|사진 올리기/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/app/item/[itemId].tsx'), 'utf8'), /case 'ITEM_NOT_ELIGIBLE': return '지금은 여기에 이미지를 추가할 수 없어요.'/);
  console.log('Photo contribution passed: optional post-save offer, skip and no duplicate write, current-photo exclusion, credit reads/cache isolation, profile link and uploader focus.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
