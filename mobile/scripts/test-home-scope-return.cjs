// #762 review 6107698831: a Home-opened online Pick must stay readable on every in-app
// return path (no-history back, profile return), and nothing else may widen the scope.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { load, screen, names } = require('./mvp-screen-harness.cjs');
const constants = require('./design-tokens.cjs');
const scope = require('./public-food-scope.cjs');

const read = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

// 1. The scope helpers only ever carry the exact `home` value.
assert.deepEqual(plain(scope.publicFoodChannels('home')), ['offline', 'online']);
for (const other of [undefined, '', 'HOME', 'offline', 'online', 'recipe', ['home'], 'home ']) {
  assert.deepEqual(plain(scope.publicFoodChannels(other)), ['offline'], `scope ${JSON.stringify(other)} stays offline`);
  assert.deepEqual(plain(scope.homeScopeParams(other)), {}, `scope ${JSON.stringify(other)} is not carried`);
  assert.equal(scope.homeScopeQuery(other), '', `scope ${JSON.stringify(other)} adds no query`);
}
assert.deepEqual(plain(scope.homeScopeParams('home')), { scope: 'home' });
assert.equal(scope.homeScopeQuery('home'), '?scope=home');
assert.equal(scope.isPublicFoodChannel('recipe', scope.publicFoodChannels('home')), false, 'recipe never joins Home scope');

// 2. Public profile returnTo: a validated bare path, plus only Home's exact scope query.
const profileSource = read('app/(tabs)/(profile)/u/[username].tsx');
const fnSource = profileSource.match(/const SAFE_PROFILE_RETURN_PATH[\s\S]*?\nfunction profileReturnHref[\s\S]*?\n}\n/)[0];
const profileExports = {};
vm.runInNewContext(ts.transpileModule(`${fnSource}\nexports.profileReturnHref = profileReturnHref;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: profileExports, HOME_SCOPE_QUERY: scope.HOME_SCOPE_QUERY });
const returnHref = profileExports.profileReturnHref;
for (const ok of ['/', '/feed', '/item/abc', '/pick/p-1', '/menu/naengmyeon', '/item/abc?scope=home', '/pick/p-1?scope=home', '/menu/naengmyeon?scope=home']) {
  assert.equal(returnHref(ok), ok, `${ok} is an allowed return`);
}
for (const bad of ['/item/abc?scope=offline', '/item/abc?scope=home&x=1', '/item/abc?x=1&scope=home', '/item/abc?scope=home?scope=home',
  '/u/kim?scope=home', '/auth?scope=home', '/admin/x?scope=home', 'https://evil.test?scope=home', '//evil.test?scope=home', '?scope=home',
  '/item/abc?scope=HOME', ['/item/abc'], undefined]) {
  assert.equal(returnHref(bad), null, `${JSON.stringify(bad)} is rejected`);
}
assert.match(profileSource, /const returnHref = profileReturnHref\(returnTo\);/, 'Profile keeps the locked return contract');

// 3. Pick conversation: no-history back keeps Home scope on the item fallback (the reported counterexample).
function pickScreen(params, canGoBack) {
  const calls = { replace: [], back: 0, replies: [] };
  const router = { canGoBack: () => canGoBack, back: () => { calls.back++; }, replace: (to) => calls.replace.push(to), push() {} };
  const onlinePick = { id: 'pick-online', itemId: 'item-online', userId: 'other', channel: 'online', oneLineReview: '배달도 맛있어요',
    isCurrent: true, canComment: false };
  const view = screen('app/pick/[pickId].tsx', {
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => router },
    '@/lib/profile/profileName': { profileNickname: () => null },
    '@/components/current-pick-flag': { CurrentPickFlag: 'CurrentPickFlag' },
    '@/components/pick-replies': { PickReplies: (props) => { calls.replies.push(props); return null; } },
    '@/constants/onepick': constants,
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: null }) },
    '@/hooks/useItemDetail': { useItemDetail: () => ({ isPending: false, isError: false, data: {
      item: { id: 'item-online', name: '배달 냉면', imageSourceUrl: 'https://onepick.test/a.jpg' }, category: { name: '냉면' }, isRestaurant: true,
      picks: [{ pick: onlinePick, profile: { username: 'kim' } }],
    } }) },
    '@/hooks/useNotifications': { useReadNotificationGroup: () => ({ mutateAsync: async () => {} }) },
    '@/hooks/usePickDetail': { usePickDetail: () => ({ isPending: false, isError: false, data: { pick: onlinePick, item: { name: '배달 냉면' } } }) },
    '@/lib/items/itemTitle': { itemTitle: (name) => name },
    '@/services': { observabilityService: { captureProductEvent: async () => {} } },
    '@/components/ui': { Icon: 'Icon' },
  });
  const text = view.render();
  view.find('Pressable', (props) => props.accessibilityLabel === '이전 화면').onPress();
  return { text, calls };
}

const fromHome = pickScreen({ pickId: 'pick-online', scope: 'home' }, false);
assert.doesNotMatch(fromHome.text, /현재 공개 중인 원픽이 아니에요/, 'Home-scoped online Pick is readable');
assert.deepEqual(plain(fromHome.calls.replace), [{ pathname: '/item/[itemId]', params: { itemId: 'item-online', scope: 'home' } }],
  'No-history back reopens the item in Home scope');
assert.equal(fromHome.calls.replies[0].routeScope, 'home', 'Comment authors return to this Pick in Home scope');

const withHistory = pickScreen({ pickId: 'pick-online', scope: 'home' }, true);
assert.equal(withHistory.calls.back, 1, 'Real history still wins');
assert.deepEqual(withHistory.calls.replace, []);

for (const params of [{ pickId: 'pick-online' }, { pickId: 'pick-online', scope: 'online' }]) {
  const closed = pickScreen(params, false);
  assert.match(closed.text, /현재 공개 중인 원픽이 아니에요/, `${JSON.stringify(params)}: online Pick stays closed outside Home`);
  assert.deepEqual(plain(closed.calls.replace), [{ pathname: '/item/[itemId]', params: { itemId: 'item-online' } }],
    `${JSON.stringify(params)}: fallback carries no scope`);
}

// 4. Item review card and comment author links carry Home scope; anything else carries none.
function reviewCard(routeScope) {
  const pushes = [];
  const exports = load('components/item-review-card.tsx', {
    react: { useState: (initial) => [initial, () => {}] },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    'expo-router': { useRouter: () => ({ push: (to) => pushes.push(to) }) },
    'react-native': { ...names('Pressable Text View'), StyleSheet: { create: (value) => value, hairlineWidth: 1 } },
    '@/lib/profile/profileName': { profileDisplayName: () => 'kim' },
    '@/components/current-pick-flag': { CurrentPickFlag: 'CurrentPickFlag' },
    '@/components/pick-management': { PickManagement: 'PickManagement', PickManagementActions: 'PickManagementActions' },
    '@/components/pick-share-actions': { PickShareActions: 'PickShareActions' },
    '@/components/ui': { Avatar: 'Avatar' },
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: null, isLoading: false }) },
    '@/constants/onepick': constants,
    '@/lib/home/publicFoodScope': scope,
  });
  const tree = exports.ItemReviewCard({ pick: { id: 'pick-online', userId: 'other', oneLineReview: '좋아요', isCurrent: true },
    profile: { username: 'kim' }, categoryName: '냉면', itemName: '배달 냉면', itemId: 'item-online', highlighted: false,
    onRemoved() {}, routeScope });
  const pressables = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.type === 'Pressable') pressables.push(node.props);
    walk(node.props?.children);
  };
  walk(tree);
  pressables.forEach((props) => props.onPress());
  return plain(pushes);
}
assert.deepEqual(reviewCard('home'), [
  { pathname: '/u/[username]', params: { username: 'kim', returnTo: '/item/item-online?scope=home' } },
  { pathname: '/pick/[pickId]', params: { pickId: 'pick-online', itemId: 'item-online', scope: 'home' } },
  { pathname: '/pick/[pickId]', params: { pickId: 'pick-online', itemId: 'item-online', scope: 'home' } },
], 'Home review card keeps scope on profile return and conversation');
for (const other of [undefined, 'online', 'offline']) {
  assert.deepEqual(reviewCard(other), [
    { pathname: '/u/[username]', params: { username: 'kim', returnTo: '/item/item-online' } },
    { pathname: '/pick/[pickId]', params: { pickId: 'pick-online', itemId: 'item-online' } },
    { pathname: '/pick/[pickId]', params: { pickId: 'pick-online', itemId: 'item-online' } },
  ], `scope ${other} adds nothing`);
}

// 5. Remaining Home-scoped profile returns use the same validated suffix.
assert.match(read('components/pick-replies.tsx'), /returnTo: `\/pick\/\$\{pickId\}` \+ homeScopeQuery\(routeScope\)/);
assert.match(read('app/item/[itemId].tsx'), /returnTo: `\/item\/\$\{item\.id\}` \+ homeScopeQuery\(params\.scope\)/);
assert.match(read('app/menu/[slug].tsx'), /returnTo=\{`\/menu\/\$\{slug\}` \+ homeScopeQuery\(params\.scope\)\}/);
assert.match(read('components/dish-people-picks.tsx'), /params: \{ username: pick\.username, returnTo \}/,
  'Menu list hands the scoped menu path through unchanged');

console.log('home scope return paths OK');
