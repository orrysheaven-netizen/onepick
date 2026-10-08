const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { QueryClient } = require('@tanstack/react-query');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, setTimeout, clearTimeout, require: (name) => {
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name === '@/components/ui/dialog-labels') return require('./dialog-labels.cjs');
    if (name in imports) return imports[name];
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    assert.fail(`Unexpected dependency ${name}`);
  } });
  return exports;
}
const part = (tag) => ({ children }) => React.createElement(tag, null, children);
const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';
const flush = () => new Promise((resolve) => setImmediate(resolve));
const uuid = 'a1111111-1111-4111-8111-111111111111';
const poster = 'https://image.tmdb.org/t/p/w342/example.jpg';
let buttons = [], destination, image;
const native = {
  View: part('div'), Text: part('span'), TextInput: part('input'), ScrollView: part('main'), ActivityIndicator: () => null,
  Image: (props) => { image = props; return React.createElement('img', { src: props.source.uri, alt: props.accessibilityLabel }); },
  Pressable: (props) => { buttons.push(props); return React.createElement('button', null, props.children); },
  StyleSheet: { create: (styles) => styles },
};
const router = { push: (route) => { destination = route; }, replace() {}, back() {}, canGoBack: () => true, setParams() {} };
const expoImage = { Image: (props) => { image = props; return React.createElement('img', { src: props.source.uri, alt: props.accessibilityLabel }); } };
const { PickPhoto } = load('components/pick-photo.tsx', { 'expo-image': expoImage, 'expo-router': { useRouter: () => router }, 'react-native': native });
function renderPhoto(props) { buttons = []; image = null; return renderToStaticMarkup(React.createElement(PickPhoto, { label: '라면', itemId: uuid, ...props })); }

async function main() {
  assert.match(renderPhoto({ uri: null }), /사진 등록/);
  let stopped = false;
  buttons.find((b) => b.accessibilityLabel === '라면 사진 등록').onPress({ stopPropagation: () => { stopped = true; } });
  assert.ok(stopped, 'Upload action must not activate product selection');
  assert.equal(destination.pathname, '/item/[itemId]'); assert.equal(destination.params.itemId, uuid); assert.equal(destination.params.photo, '1');
  for (const uri of [poster, 'https://storage.test/photo.jpg']) {
    assert.doesNotMatch(renderPhoto({ uri }), /사진 등록/);
    assert.equal(image.source.uri, uri);
  }
  for (const itemStatus of ['pending', 'hidden', 'merged', 'rejected']) assert.doesNotMatch(renderPhoto({ itemStatus }), /사진 등록/);
  assert.match(renderPhoto({ itemStatus: 'discontinued' }), /사진 등록/);
  assert.doesNotMatch(renderPhoto({ itemId: undefined }), /사진 등록/, 'No upload target for draft or unimported external entry');
  assert.doesNotMatch(renderPhoto({ hasPhoto: true }), /사진 등록/, 'Missing display URL must not unlock existing image');
  const { PickPhoto: FailedPhoto } = load('components/pick-photo.tsx', {
    'expo-image': expoImage, 'expo-router': { useRouter: () => router }, 'react-native': native,
    react: { ...React, useState: () => [poster, () => {}] },
  });
  const failed = renderToStaticMarkup(React.createElement(FailedPhoto, { uri: poster, itemId: uuid, label: '영화' }));
  assert.match(failed, /사진을 불러올 수 없어요/); assert.doesNotMatch(failed, /사진 등록/, 'Loading failure is not a missing image');

  const authIntent = load('lib/auth/authIntent.ts');
  const intent = authIntent.getAuthIntent({ action: 'add_item_photo', itemId: uuid });
  assert.equal(intent.action, 'add_item_photo');
  assert.equal(authIntent.getPostAuthRoute(intent).params.photo, '1');
  assert.equal(authIntent.getPostAuthRoute(intent, true).params.itemId, uuid);
  assert.equal(authIntent.getAuthIntent({ action: 'add_item_photo', itemId: 'https://evil.test' }).action, 'home');
  assert.equal(authIntent.getAuthIntent({ action: 'add_item_photo', itemId: [uuid] }).action, 'home');

  const { AppError } = load('errors/appError.ts');
  const { RegistrationService } = load('services/registrationService.ts', {
    '@/errors/appError': { AppError }, '@/lib/items/itemIdentity': { canonicalItemName: (name) => name },
  });
  let item = { id: uuid, categoryId: 'cat', name: '라면', status: 'active' }, uploads = 0, attached = 0, registered;
  const photo = { uri: 'file://draft.jpg', base64: 'eA==', thumbnailBase64: 'eA==', uploadId: 'draft' };
  const service = new RegistrationService(
    { getOpenCategories: async () => [{ id: 'cat', status: 'open', isVisible: true, isPickable: true }] },
    { registerPick: async (value) => { registered = value; return { id: 'pick' }; } },
    { getById: async () => item, attachPhoto: async () => { attached++; return item; } },
    { upload: async () => { uploads++; return { imagePath: 'u/photo.jpg', thumbnailPath: 'u/thumb.jpg' }; }, cleanupUnused: async () => {}, removeUnused: async () => {} }, {},
  );
  for (const field of ['imagePath', 'imageUrl', 'thumbnailUrl', 'imageSourceUrl']) {
    item = { id: uuid, categoryId: 'cat', name: '라면', status: 'active', [field]: poster };
    assert.equal(await service.attachItemPhoto({ userId: 'u', itemId: uuid, photo }), item);
    await service.register({ userId: 'u', categoryId: 'cat', itemId: uuid, itemName: '라면', variant: '', oneLineReview: '좋아요', photo });
    assert.equal(registered.imagePath, undefined, 'Existing photo is not sent for replacement through registration');
  }
  assert.equal(uploads, 0); assert.equal(attached, 0);

  // Real component rendering with deterministic hook state: exercise the single shared uploader.
  let state = [], refs = [], stateIndex = 0, refIndex = 0, pickerResult = photo, pickerCalls = 0, savedCalls = 0, rejectSave = false;
  const auth = { user: { id: 'u' }, isLoading: false, error: null };
  const params = { itemId: uuid, photo: '1' };
  const blank = { id: uuid, categoryId: 'cat', name: '라면', status: 'active', imagePath: null, imageUrl: null, thumbnailUrl: null, imageSourceUrl: null };
  const query = { data: { item: blank, category: { name: '라면' }, picks: [], myPickStatus: { type: 'not_selected' }, canChoose: true }, isPending: false, isError: false, refetch: async () => {} };
  const picker = { isPending: false, isError: false, mutateAsync: async () => { pickerCalls++; return pickerResult; } };
  const attachment = { isPending: false, isError: false, error: null, reset() {}, mutateAsync: async () => {
    savedCalls++; if (rejectSave) throw new AppError('PHOTO_UPLOAD_FAILED');
    return { ...blank, imagePath: 'u/photo.jpg', imageUrl: 'https://storage.test/photo.jpg', thumbnailUrl: 'https://storage.test/thumb.jpg' };
  } };
  const { default: Detail } = load('app/item/[itemId].tsx', {
    react: { ...React,
      useState: (initial) => { const i = stateIndex++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
        return [state[i], (value) => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
      useRef: (initial) => { const i = refIndex++; if (!(i in refs)) refs[i] = { current: initial }; return refs[i]; },
      useEffect() {}, useCallback: (callback) => callback,
    },
    'expo-router': { useRouter: () => router, useLocalSearchParams: () => params },
    'react-native': native, 'react-native-safe-area-context': { SafeAreaView: part('section') },
    '@/hooks/useAuthSession': { useAuthSession: () => auth }, '@/hooks/useItemDetail': { useItemDetail: () => query },
    '@/hooks/useRegisterPick': {
      useChoosePhoto: () => picker,
      useAttachItemPhoto: () => attachment,
      useMyPendingItemPhoto: () => ({ data: null, isPending: false }),
      useRevisePendingItem: () => ({ isPending: false, mutateAsync: async () => ({}) }),
    },
    '@/hooks/useNotifications': { useReadNotificationGroup: () => ({ isPending: false, mutateAsync: async () => 0 }) },
    '@/services/storeFirstService': { isNaverMapUrl: () => true },
    '@/components/item-pick-count': { ItemPickCount: () => null }, '@/components/item-channel-links': { ItemChannelLinks: () => null }, '@/components/youtube-video-link': { YouTubeVideoLink: () => null }, '@/components/item-review-card': { ItemReviewCard: () => null },
    '@/components/pick-photo': { PickPhoto: ({ uri }) => React.createElement('span', null, uri || '사진 없음') }, '@/errors/appError': { AppError },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } }),
    '@/lib/photos/photoFailure': { showPhotoFailure() {}, isPhotoFailure: () => false },
    '@/lib/home/homeChannels': load('lib/home/homeChannels.ts'), '@/lib/items/itemTitle': load('lib/items/itemTitle.ts'), '@/lib/items/pickSavedToast': load('lib/items/pickSavedToast.ts'), '@/lib/categories/registrationRoute': load('lib/categories/registrationRoute.ts'),
    '@/services': { observabilityService: { captureProductEvent: async () => {} } },
  });
  const render = () => { buttons = []; stateIndex = 0; refIndex = 0; return renderToStaticMarkup(React.createElement(Detail)); };
  const button = (label) => buttons.find((b) => textOf(b.children) === label);
  assert.match(render(), /사진 올리기/);
  pickerResult = null; await button('사진 올리기').onPress(); await flush(); render();
  assert.equal(savedCalls, 0); assert.equal(button('이 사진 등록하기'), undefined, 'Cancelling picker makes no change');
  pickerResult = photo; button('사진 올리기').onPress(); button('사진 올리기').onPress(); await flush();
  assert.equal(pickerCalls, 2, 'Repeated picker taps are deduplicated');
  render(); assert.equal(button('이 사진 등록하기').disabled, false, 'A chosen photo can be registered without a separate consent step');
  assert.equal(buttons.find((b) => b.accessibilityRole === 'checkbox'), undefined, 'No consent checkbox is rendered');
  rejectSave = true; await button('이 사진 등록하기').onPress(); await flush();
  render(); assert.ok(button('이 사진 등록하기'), 'Retry preserves selected photo');
  assert.equal(image.source.uri, photo.uri);
  button('사진 빼기').onPress(); render(); assert.ok(button('사진 올리기')); assert.equal(button('이 사진 등록하기'), undefined);
  button('사진 올리기').onPress(); await flush(); render();
  rejectSave = false; const beforeSave = savedCalls;
  button('이 사진 등록하기').onPress(); button('이 사진 등록하기').onPress(); await flush();
  assert.equal(savedCalls, beforeSave + 1, 'Repeated upload taps are deduplicated');
  const savedMarkup = render(); assert.doesNotMatch(savedMarkup, /사진 올리기|이 사진 등록하기/); assert.match(savedMarkup, /storage.test\/photo.jpg/);
  state = []; refs = []; query.data.item = { ...blank, imageSourceUrl: poster, imageUrl: poster };
  assert.doesNotMatch(render(), /사진 올리기|이 사진 등록하기/);
  query.data.item = blank; auth.user = null;
  assert.match(render(), /사진 올리기/); button('사진 올리기').onPress();
  assert.equal(destination.params.action, 'add_item_photo'); assert.equal(destination.params.itemId, uuid);
  const anonymousKey = Detail().key; auth.user = { id: 'u' }; const userKey = Detail().key;
  assert.notEqual(anonymousKey, userKey, 'Account changes remount drafts');
  params.itemId = 'b2222222-2222-4222-8222-222222222222'; assert.notEqual(Detail().key, userKey, 'Item changes remount drafts'); params.itemId = uuid;
  auth.error = new Error('offline'); assert.doesNotMatch(render(), /사진 올리기|이 사진 등록하기/); auth.error = null;

  const { queryKeys } = load('lib/query/queryKeys.ts');
  const { invalidatePickData } = load('lib/query/invalidatePickData.ts', { './queryKeys': { queryKeys } });
  const cache = new QueryClient();
  const keys = [queryKeys.home.data('u'), queryKeys.explore.topItems('cat'), queryKeys.items.search('라면'), queryKeys.items.detail(uuid), queryKeys.picks.detail('p'), queryKeys.profiles.mine('u'), queryKeys.profiles.byUsername('other')];
  keys.forEach((key) => cache.setQueryData(key, { old: true }));
  const hooks = load('hooks/useRegisterPick.ts', {
    '@tanstack/react-query': { useMutation: (options) => options, useQuery: () => {}, useQueryClient: () => cache },
    '@/lib/query/invalidatePickData': { invalidatePickData }, '@/services': { registrationService: service },
  });
  await hooks.useAttachItemPhoto().onSuccess();
  keys.forEach((key) => assert.equal(cache.getQueryState(key).isInvalidated, true, 'Successful upload refreshes all product surfaces'));
  cache.clear();
  const homeFeedCardSource = fs.readFileSync(path.join(__dirname, '../src/components/home-feed-card.tsx'), 'utf8');
  assert.match(homeFeedCardSource, /photo=\{\{[\s\S]*?itemId:\s*pick\.itemId/, 'Home people feed passes the real catalog target through the shared PickCard');
  for (const file of ['app/(tabs)/explore.tsx', 'app/(tabs)/(profile)/profile.tsx', 'app/pick/find.tsx', 'app/pick/choose.tsx', 'components/item-search.tsx']) {
    assert.match(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), /<PickPhoto[^>]*itemId=/s, `${file} passes a real catalog target`);
  }
  const publicProfileSource = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/(profile)/u/[username].tsx'), 'utf8');
  assert.match(publicProfileSource, /function PublicProfilePickRow[\s\S]*?<PickPhoto[\s\S]*?itemId=\{item\.item\?\.id\}/, 'public Figma 40 row forwards the real catalog target to PickPhoto');
  const profilePickGroupsSource = fs.readFileSync(path.join(__dirname, '../src/components/profile-pick-groups.tsx'), 'utf8');
  assert.match(profilePickGroupsSource, /<ProfilePickCard[\s\S]*?itemId=\{item\.item\?\.id\}/, 'profile groups pass the real catalog target to the shared card');
  const profilePickCardSource = fs.readFileSync(path.join(__dirname, '../src/components/profile-pick-card.tsx'), 'utf8');
  assert.match(profilePickCardSource, /<PickPhoto[\s\S]*?itemId=\{itemId\}/, 'shared profile card forwards the real catalog target to PickPhoto');
  console.log('Shared photo actions passed: visibility, source/failure protection, scoped navigation, login return, consent, cancel/retry, double taps, remount isolation, service guards and all-surface cache invalidation.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
