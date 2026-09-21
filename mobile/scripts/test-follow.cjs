const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

function loadSource(relativePath, imports = {}, jsx = false) {
  const file = path.join(root, 'src', relativePath);
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports,
    require: (name) => {
      if (name === '@/constants/onepick') return require('./design-tokens.cjs');
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      assert.ok(name in imports, 'Unexpected runtime dependency: ' + name);
      return imports[name];
    },
  });
  return exports;
}

async function main() {
  const { AppError } = loadSource('errors/appError.ts');

  // Service: guards run before the repository, feed reads go through ReadRepository.
  const calls = [];
  const followRepository = {
    isFollowing: async (...args) => { calls.push(['isFollowing', ...args]); return true; },
    follow: async (...args) => { calls.push(['follow', ...args]); },
    unfollow: async (...args) => { calls.push(['unfollow', ...args]); },
    getCounts: async (...args) => { calls.push(['counts', ...args]); return { followingCount: 2, followerCount: 1 }; },
  };
  const readRepository = {
    getFollowingPicks: async (cursor) => { calls.push(['feed', cursor]); return { items: [], nextCursor: null }; },
  };
  const { FollowService } = loadSource('services/followService.ts', { '@/errors/appError': { AppError } });
  const service = new FollowService(followRepository, readRepository);

  assert.throws(() => service.follow('', 'them'), (error) => error.code === 'AUTH_REQUIRED');
  assert.throws(() => service.follow('me', ''), (error) => error.code === 'PROFILE_NOT_FOUND');
  assert.throws(() => service.follow('me', 'me'), (error) => error.code === 'FOLLOW_SELF');
  assert.throws(() => service.unfollow('', 'them'), (error) => error.code === 'AUTH_REQUIRED');
  assert.throws(() => service.getCounts(''), (error) => error.code === 'AUTH_REQUIRED');
  assert.throws(() => service.getFollowingFeed(''), (error) => error.code === 'AUTH_REQUIRED');
  assert.throws(() => service.isFollowing('', 'them'), (error) => error.code === 'AUTH_REQUIRED');
  assert.equal(calls.length, 0, 'Guards never reach the repositories');

  assert.equal(await service.isFollowing('me', 'me'), false, 'Self state is false without a request');
  assert.equal(calls.length, 0);
  await service.follow('me', 'them');
  await service.unfollow('me', 'them');
  await service.isFollowing('me', 'them');
  await service.getCounts('me');
  await service.getFollowingFeed('me', { timestamp: 't', id: 'i' });
  same(calls, [
    ['follow', 'me', 'them'], ['unfollow', 'me', 'them'], ['isFollowing', 'me', 'them'],
    ['counts', 'me'], ['feed', { timestamp: 't', id: 'i' }],
  ]);

  // Auth intent: a guest pressing 팔로우 comes back to that profile after login.
  const { getAuthIntent, getPostAuthRoute } = loadSource('lib/auth/authIntent.ts');
  same(getPostAuthRoute(getAuthIntent({ action: 'view_profile', username: 'jimin_01' })), { pathname: '/u/[username]', params: { username: 'jimin_01' } });
  assert.equal(getPostAuthRoute(getAuthIntent({ action: 'view_profile', username: '../admin' })), '/');
  assert.equal(getPostAuthRoute(getAuthIntent({ action: 'view_profile', username: ['a', 'b'] })), '/');
  assert.equal(getPostAuthRoute(getAuthIntent({ action: 'view_profile' })), '/');
  const onboarding = getPostAuthRoute(getAuthIntent({ action: 'view_profile', username: 'jimin_01' }), true);
  assert.equal(onboarding.pathname, '/auth/username');
  same(getPostAuthRoute(getAuthIntent(onboarding.params)), { pathname: '/u/[username]', params: { username: 'jimin_01' } });

  // Follow button: guest → login handoff; member → optimistic toggle with rollback on failure.
  const presses = [];
  const native = {
    View: ({ children }) => React.createElement('div', null, children),
    Text: ({ children }) => React.createElement('span', null, children),
    ActivityIndicator: () => React.createElement('i', null, 'loading'),
    Pressable: (props) => { presses.push(props); return React.createElement('button', { disabled: props.disabled }, props.children); },
    StyleSheet: { create: (styles) => styles },
  };
  let state = { data: false, isPending: false };
  const mutations = { follow: { isPending: false, error: null, mutate: () => {}, reset: () => {} }, unfollow: { isPending: false, error: null, mutate: () => {}, reset: () => {} } };
  const { FollowButton } = loadSource('components/follow-button.tsx', {
    'react-native': native,
    '@/errors/appError': { AppError },
    '@/hooks/useFollow': { useFollowState: () => state, useFollowActions: () => mutations },
  }, true);
  const render = (props) => { presses.length = 0; return renderToStaticMarkup(React.createElement(FollowButton, props)); };

  let loginRequests = 0;
  let html = render({ viewerUserId: undefined, profileUserId: 'them', username: 'jimin', onRequireLogin: () => loginRequests++ });
  assert.match(html, /팔로우/);
  presses[0].onPress();
  assert.equal(loginRequests, 1, 'Guests are sent to login instead of a request');

  assert.equal(render({ viewerUserId: 'me', profileUserId: 'me', username: 'me' }), '', 'Own profile renders no button');

  let followCalls = 0, unfollowCalls = 0;
  mutations.follow.mutate = () => followCalls++;
  mutations.unfollow.mutate = () => unfollowCalls++;
  html = render({ viewerUserId: 'me', profileUserId: 'them', username: 'jimin' });
  assert.match(html, />팔로우</);
  assert.equal(presses[0].accessibilityState.selected, false);
  presses[0].onPress();
  assert.equal(followCalls, 1);
  state = { data: true, isPending: false };
  html = render({ viewerUserId: 'me', profileUserId: 'them', username: 'jimin' });
  assert.match(html, />팔로잉</);
  assert.equal(presses[0].accessibilityState.selected, true);
  presses[0].onPress();
  assert.equal(unfollowCalls, 1);
  mutations.unfollow.error = new AppError('FOLLOW_BLOCKED');
  html = render({ viewerUserId: 'me', profileUserId: 'them', username: 'jimin' });
  assert.match(html, /차단 관계에서는 팔로우할 수 없어요/);
  mutations.unfollow.error = null;
  mutations.follow.isPending = true;
  html = render({ viewerUserId: 'me', profileUserId: 'them', username: 'jimin' });
  assert.match(html, /loading/);
  assert.equal(presses[0].disabled, true, 'No double submit while pending');

  // Home: the 팔로잉 scope only exists for members and is a separate query from the public feed.
  const home = fs.readFileSync(path.join(root, 'src/app/(tabs)/index.tsx'), 'utf8');
  assert.match(home, /useFollowingFeed\(user\?\.id, showFollowing/);
  assert.match(home, /const showFollowing = OnePickFeatures\.follow && Boolean\(user\) && feedScope === 'following'/);
  assert.match(home, /OnePickFeatures\.follow && user \? <View style=\{styles\.scopeRow\}>/);
  assert.match(home, /아직 팔로잉 원픽이 없어요/);
  assert.doesNotMatch(home, /home_following_feed_page/, 'Screen never names the RPC');

  // Public profile: follow sits in the header for other people's profiles only.
  const publicProfile = fs.readFileSync(path.join(root, 'src/app/u/[username].tsx'), 'utf8');
  assert.match(publicProfile, /\{OnePickFeatures\.follow && !query\.data\.isMine \? <View style=\{styles\.followRow\}>/);
  const featureSource = fs.readFileSync(path.join(root, 'src/constants/onepick.ts'), 'utf8');
  assert.match(featureSource, /follow: false/, 'Follow stays dormant until the linked DB has the follow schema');
  assert.match(publicProfile, /action: 'view_profile'/);

  console.log('Follow checks passed: service guards, login return intent, button states, home scope and profile placement.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
