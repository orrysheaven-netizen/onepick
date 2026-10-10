// #874: the saved item detail is shown before the user acknowledges completion.
// This regression fixture runs the real detail screen with stubbed data/actions.
// There are no network calls, writes, or paid services in this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { exports, module: { exports }, require: (name) => {
    if (name === 'react/jsx-runtime') return require(name);
    if (name in imports) return imports[name];
    throw new Error('Unexpected dependency: ' + name);
  } });
  return exports;
}
const savedToast = load('lib/items/pickSavedToast.ts');
const part = (tag) => ({ children }) => React.createElement(tag, null, children);
const textOf = (v) => typeof v === 'string' ? v : Array.isArray(v) ? v.map(textOf).join('') : v?.props ? textOf(v.props.children) : '';
let states = [], refs = [], stateIndex = 0, refIndex = 0, pressables = [], destination, params = { itemId: 'item-1', pickId: 'pick-1' };
const native = {
  View: part('div'), Text: part('span'), ScrollView: part('main'), Image: part('img'),
  TextInput: part('input'),
  Pressable: (props) => {
    pressables.push(props);
    return React.createElement('button', null, typeof props.children === 'function' ? props.children({ pressed: false }) : props.children);
  },
  StyleSheet: { create: (styles) => styles, absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } },
};
const hooks = {
  ...React,
  useState: (initial) => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
  },
  useRef: (initial) => {
    const index = refIndex++;
    if (!(index in refs)) refs[index] = { current: initial };
    return refs[index];
  },
  useEffect() {},
  useCallback: (fn) => fn,
};
const Button = (props) => {
  pressables.push(props);
  return React.createElement('button', null, props.label);
};
const detail = {
  item: {
    id: 'item-1', name: '미역국', categoryId: 'category-1',
    status: 'active', channels: ['offline'], imageUrl: 'https://example.test/photo.jpg',
  },
  category: { id: 'category-1', name: '미역국' },
  brand: null,
  isRestaurant: true,
  myPickStatus: { type: 'selected_this' },
  pickChannel: 'offline',
  picks: [{ pick: { id: 'pick-1', userId: 'owner', channel: 'offline', status: 'active', isCurrent: true }, profile: null }],
  canChoose: false,
};
const noop = () => null;
const mutation = () => ({ isPending: false, isError: false, mutateAsync: async () => null, reset() {} });
const constants = require('./design-tokens.cjs');
const { default: Screen } = load('app/item/[itemId].tsx', {
  react: hooks,
  'react-native': native,
  'react-native-safe-area-context': { SafeAreaView: part('section') },
  'expo-router': {
    Redirect: part('div'),
    useLocalSearchParams: () => params,
    useRouter: () => ({
      canGoBack: () => true,
      back: () => { destination = 'back'; },
      replace: (to) => { destination = to; },
      push: (to) => { destination = to; },
      setParams() {},
    }),
  },
  '@/errors/appError': { AppError: class AppError extends Error {} },
  '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: 'owner' }, isLoading: false, error: null }) },
  '@/hooks/useItemDetail': { useItemDetail: () => ({ data: detail, isPending: false, isError: false, isFetching: false, refetch: async () => {} }) },
  '@/hooks/useRegisterPick': {
    useAttachItemPhoto: mutation, useChoosePhoto: mutation,
    useMyPendingItemPhoto: () => ({ data: null, isPending: false }),
    useRevisePendingItem: mutation,
  },
  '@/hooks/useNotifications': { useReadNotificationGroup: mutation },
  '@/components/item-channel-links': { ItemChannelLinks: noop },
  '@/components/item-pick-count': { ItemPickCount: noop },
  '@/components/item-review-card': { ItemReviewCard: noop },
  '@/components/youtube-video-link': { YouTubeVideoLink: noop },
  '@/components/pick-photo': { PickPhoto: noop },
  '@/components/ui': { Button, Icon: noop, StateCard: noop },
  '@/lib/photos/photoFailure': { showPhotoFailure() {} },
  '@/lib/home/homeChannels': { categoryWithChannels: (name) => name, homeChannelLabel: () => '오프라인 맛집' },
  '@/lib/items/itemTitle': { itemTitle: (name) => name },
  '@/lib/items/pickSavedToast': savedToast,
  '@/services/storeFirstService': { isNaverMapUrl: () => true },
  '@/services': { observabilityService: { captureProductEvent: async () => {} } },
  '@/constants/onepick': constants,
});
function resetState() { states = []; refs = []; destination = undefined; }
function render() {
  stateIndex = 0; refIndex = 0; pressables = [];
  return renderToStaticMarkup(React.createElement(Screen));
}
function press(label) {
  const button = pressables.find((p) => p.accessibilityLabel === label || p.label === label || textOf(p.children) === label);
  assert.ok(button, 'Expected control: ' + label);
  button.onPress();
}

// An unrelated Pick cannot consume someone else's saved completion token.
savedToast.armPickSavedToast('pick-1');
params = { itemId: 'other-item', pickId: 'other-pick' };
resetState();
assert.doesNotMatch(render(), /원픽 등록 완료|원픽을 등록했어요\./);

// The first saved-detail render shows the item and an explicit completion CTA,
// but never triggers the completion toast before the click.
params = { itemId: 'item-1', pickId: 'pick-1' };
resetState();
const before = render();
assert.match(before, /미역국/, 'The final detail is visible first');
assert.match(before, /완료/, 'Only a saved registration shows completion CTA');
assert.doesNotMatch(before, /원픽을 등록했어요\./, 'The toast must not appear on entry');
assert.ok(pressables.some((p) => p.accessibilityLabel === '홈으로 이동'), 'The saved detail has a reliable Home exit');
press('원픽 등록 완료');
const after = render();
assert.match(after, /원픽을 등록했어요\./, 'The click shows the toast');
assert.doesNotMatch(after, />완료</, 'Completion cannot be submitted twice');
assert.ok(pressables.some((p) => p.accessibilityLabel === '홈으로 이동'));
press('홈으로 이동');
assert.equal(destination, '/', 'Home exit replaces the registration detail route');

// Reload/direct link cannot replay completion state or the toast.
resetState();
const revisited = render();
assert.doesNotMatch(revisited, /원픽을 등록했어요\./);
assert.doesNotMatch(revisited, />완료</);
assert.ok(pressables.some((p) => p.accessibilityLabel === '뒤로 가기'), 'Ordinary detail navigation stays unchanged');

// Timing/position are guarded separately from the render-based state checks.
const screen = fs.readFileSync(path.join(__dirname, '../src/app/item/[itemId].tsx'), 'utf8');
assert.match(screen, /setTimeout\(\(\) => setPickSavedToast\(false\), 2000\)/);
assert.match(screen, /toastOverlay:\s*\{[\s\S]*?justifyContent: 'center',\s*alignItems: 'center'/);
assert.match(screen, /if \(!arrivedFromRegistration && params\.photo !== '1'/,
  'A registration handoff must not jump immediately down to a focused review');
console.log('Registration completion QA passed: final detail first, one-click centered toast, Home exit and no replay.');
