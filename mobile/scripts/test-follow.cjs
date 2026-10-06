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
      if (name === '@/components/ui/dialog-labels') return require('./dialog-labels.cjs');
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
    getFollowingPicks: async (...args) => { calls.push(['feed', ...args]); return { items: [], nextCursor: null }; },
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
  await service.getFollowingFeed('me', null, 'offline', 'food');
  same(calls, [
    ['follow', 'me', 'them'], ['unfollow', 'me', 'them'], ['isFollowing', 'me', 'them'],
    ['counts', 'me'], ['feed', { timestamp: 't', id: 'i' }, null, null],
    ['feed', null, 'offline', 'food'],
  ]);

  // Auth intent: return to the same profile without putting a mutation trigger in the URL.
  const { getAuthIntent, getPostAuthRoute } = loadSource('lib/auth/authIntent.ts');
  same(getPostAuthRoute(getAuthIntent({ action: 'follow_profile', username: 'jimin_01' })), { pathname: '/u/[username]', params: { username: 'jimin_01' } });
  assert.equal(getPostAuthRoute(getAuthIntent({ action: 'follow_profile', username: '../admin' })), '/');
  assert.equal(getPostAuthRoute(getAuthIntent({ action: 'follow_profile', username: ['a', 'b'] })), '/');
  assert.equal(getPostAuthRoute(getAuthIntent({ action: 'follow_profile' })), '/');
  const onboarding = getPostAuthRoute(getAuthIntent({ action: 'follow_profile', username: 'jimin_01' }), true);
  assert.equal(onboarding.pathname, '/auth/username');
  same(getPostAuthRoute(getAuthIntent(onboarding.params)), { pathname: '/u/[username]', params: { username: 'jimin_01' } });

  // Auto-follow is an explicit, one-time continuation. A URL alone cannot arm it.
  const followIntent = loadSource('lib/auth/followProfileIntent.ts');
  assert.equal(followIntent.consumeFollowProfileIntent('jimin_01', 1_000), false);
  assert.equal(followIntent.armFollowProfileIntent('jimin_01', 1_000), true);
  assert.equal(followIntent.consumeFollowProfileIntent('jimin_01', 1_001), true);
  assert.equal(followIntent.consumeFollowProfileIntent('jimin_01', 1_002), false, 'the continuation is consumed once');
  assert.equal(followIntent.armFollowProfileIntent('jimin_01', 2_000), true);
  assert.equal(followIntent.consumeFollowProfileIntent('other_01', 2_001), false, 'a different profile cannot consume the intent');
  assert.equal(followIntent.consumeFollowProfileIntent('jimin_01', 2_002), false, 'a mismatch also burns the marker');
  assert.equal(followIntent.armFollowProfileIntent('jimin_01', 3_000), true);
  assert.equal(followIntent.consumeFollowProfileIntent('jimin_01', 603_001), false, 'the continuation expires after ten minutes');

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
  assert.equal(unfollowCalls, 0, 'Pressing 팔로잉 only opens confirmation; it must not unfollow immediately');
  const followButtonSource = fs.readFileSync(path.join(root, 'src/components/follow-button.tsx'), 'utf8');
  assert.match(followButtonSource, /setConfirmingUnfollow\(true\)/);
  assert.match(followButtonSource, />팔로우 취소<\/Text>/);
  assert.match(followButtonSource, /accessibilityLabel="팔로우 취소 확인 닫기"/);
  assert.ok(
    followButtonSource.indexOf('if (isSelf) return null;') > followButtonSource.lastIndexOf('useEffect(() =>'),
    'Self-profile early return stays after hooks so hook order cannot change between renders',
  );
  assert.match(followButtonSource, /unfollow\.mutate\(undefined,[\s\S]*?onSuccess: \(\) => setConfirmingUnfollow\(false\)/,
    'Only the explicit confirmation action performs unfollow');
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
  assert.match(home, /useFollowingFeed\(user\?\.id, showFollowing[\s\S]*?mvpChannel, HOME_FEED_ROOT_SLUG\)/,
    'Following Home is scoped to the same MVP channel and food root');
  assert.match(home, /useFollowCounts\(followCountUserId\)/,
    'Home reads the signed-in viewer follow count before choosing the default scope');
  assert.match(home, /followingCount \?\? 0\) > 0 \? 'following' : 'all'/,
    'Members with follows default to Following while zero follows defaults to All');
  assert.match(home, /feedScopeChoice && feedScopeChoice\.userId === user\?\.id \? feedScopeChoice\.scope : defaultFeedScope/,
    'A manual scope choice is isolated to the current account');
  assert.match(home, /const showFollowing = Boolean\(followCountUserId\) && !followDefaultPending && feedScope === 'following'/);
  assert.match(home, /\(\['following', 'all'\] as const\)\.map/,
    'Following appears before the public feed in the preserved member scope switcher');
  assert.match(home, /OnePickFeatures\.followingFeed && user && !followDefaultPending \? <View style=\{styles\.scopeRow\}>/);
  assert.match(home, /아직 팔로잉 원픽이 없어요/);
  assert.doesNotMatch(home, /home_following_feed_page/, 'Screen never names the RPC');

  // Public profile: follow sits in the header for other people's profiles only.
  const publicProfile = fs.readFileSync(path.join(root, 'src/app/(tabs)/(profile)/u/[username].tsx'), 'utf8');
  assert.match(publicProfile, /\{OnePickFeatures\.profileFollow && !query\.data\.isMine \? <View style=\{styles\.followActions\}>/);
  assert.match(publicProfile, /onRequireLogin=\{\(\) => openFollowLogin\(query\.data\.profile\.username\)\}[\s\S]*?fullWidth \/>/,
    'Figma 40 keeps the Follow relationship in the primary action');
  assert.match(publicProfile, /<Button[\s\S]*?variant="secondary"[\s\S]*?label="공유"[\s\S]*?accessibilityLabel="프로필 공유"/,
    'Figma 40 exposes Share beside Follow/Following');
  const featureSource = fs.readFileSync(path.join(root, 'src/constants/onepick.ts'), 'utf8');
  assert.match(featureSource, /profileFollow: true/, 'MVP exposes the public-profile follow relationship');
  assert.match(featureSource, /followingFeed: false/, 'MVP keeps the following feed hidden behind its own gate');
  assert.match(featureSource, /followNotifications: false/, 'MVP keeps follow-change notifications hidden behind their own gate');
  assert.match(featureSource, /followCounts: false/, 'Legacy own-profile count component remains separately hidden');
  const settings = fs.readFileSync(path.join(root, 'src/app/settings.tsx'), 'utf8');
  assert.match(settings, /useNotificationPreferences\(OnePickFeatures\.followNotifications \? user\?\.id : undefined\)/,
    'Hidden follow mode does not start the follow-notification preference query');
  assert.match(settings, /\{OnePickFeatures\.followNotifications \? <>[\s\S]*?팔로우한 사람의 원픽 변경/,
    'Follow notification settings remain implemented but hidden behind the same gate');
  const ownProfile = fs.readFileSync(path.join(root, 'src/app/(tabs)/(profile)/profile.tsx'), 'utf8');
  assert.match(ownProfile, /OnePickFeatures\.followCounts \? <ProfileFollowCounts userId=\{user\.id\} \/> : null/,
    'Own profile only renders follower/following numbers behind the dedicated count gate');
  assert.match(publicProfile, /action: 'follow_profile'/);
  assert.match(publicProfile, /consumeFollowProfileIntent\(username\)/);
  assert.match(publicProfile, /autoFollow=\{autoFollow && Boolean\(user\)\}/);
  assert.doesNotMatch(publicProfile, /follow === '1'/, 'a shareable query string cannot trigger a follow mutation');
  assert.match(publicProfile, /로그인하면 바로 팔로우되고 이 프로필로 돌아와요/);

  console.log('Follow checks passed: profile CTA is enabled while following feed and follow notifications remain separately gated.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
