const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');

function loadSource(relativePath, imports = {}, jsx = false) {
  const file = path.join(root, 'src', relativePath);
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports,
    require: (name) => {
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name in imports) return imports[name];
      assert.fail('Unexpected runtime dependency: ' + name);
    },
  });
  return exports;
}

const presses = [];
const followProps = [];
const component = (tag) => ({ children }) => React.createElement(tag, null, children);
const native = {
  View: component('div'),
  Text: component('span'),
  ActivityIndicator: () => React.createElement('i', null, 'loading'),
  Pressable: (props) => {
    presses.push(props);
    return React.createElement('button', null, props.children);
  },
  FlatList: (props) => React.createElement(
    'main',
    null,
    props.data.length
      ? props.data.map((item) => React.createElement('div', { key: item.userId }, props.renderItem({ item })))
      : props.ListEmptyComponent,
    props.ListFooterComponent,
  ),
  StyleSheet: { create: (styles) => styles },
};

let unavailable = false;
const hooks = {
  usePublicFollowCounts: (_profileId, viewerId) => ({
    data: unavailable ? null : { followerCount: 3, followingCount: 2 },
    isPending: false,
    isError: false,
    viewerId,
  }),
  useFollowConnections: (_profileId, _direction, viewerId) => ({
    data: {
      items: [
        { userId: 'friend', username: 'mimi', profileImageUrl: null, bio: '국물 요리를 좋아해요.', viewerIsFollowing: true },
        { userId: 'me', username: 'me', profileImageUrl: null, bio: '내 소개', viewerIsFollowing: false },
      ],
    },
    isPending: false,
    isError: false,
    isFetching: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: async () => {},
    refetch: async () => {},
    viewerId,
  }),
};

const ui = {
  ...require('./icon-stub.cjs'),
  Avatar: ({ name }) => React.createElement('span', null, `avatar:${name}`),
  StateCard: ({ title, text }) => React.createElement('section', null, title, text),
};
const FollowButton = (props) => {
  followProps.push(props);
  return React.createElement('span', null, props.initialFollowing ? '팔로잉' : '팔로우');
};
const constants = {
  OnePick: {
    bgDefault: '#fff', borderDefault: '#eee', textPrimary: '#111', actionPrimary: '#111',
    bgSubtle: '#f6f6f8', onAction: '#fff', textSecondary: '#666',
  },
  OnePickRadius: { md: 12 },
  OnePickSpace: { sm: 8, md: 12, gutter: 16, xxl: 24 },
  OnePickType: { title: {}, headline: {}, bodyMedium: {}, caption: {} },
};

const { FollowConnectionsView } = loadSource('components/follow-connections-view.tsx', {
  'react-native': native,
  '@/components/follow-button': { FollowButton },
  '@/components/ui': ui,
  '@/lib/profile/profileAvatar': { profileAvatarUrl: (path) => (path ? `https://x/${path}` : null) },
  '@/constants/onepick': constants,
  '@/hooks/useFollow': hooks,
}, true);

let opened = null;
let loginTarget = null;
const props = {
  profileId: 'owner',
  ownerUsername: 'duck',
  viewerUserId: 'me',
  initialDirection: 'followers',
  onBack: () => {},
  onOpenProfile: (username) => { opened = username; },
  onRequireLogin: (username) => { loginTarget = username; },
};

let html = renderToStaticMarkup(React.createElement(FollowConnectionsView, props));

assert.match(html, /duck/);
assert.match(html, /팔로워 3/);
assert.match(html, /팔로잉 2/);
assert.match(html, /mimi/);
assert.match(html, /국물 요리를 좋아해요/);
assert.match(html, /avatar:mimi/);

assert.equal(followProps.length, 1, 'Own row does not render a follow button');
assert.equal(followProps[0].profileUserId, 'friend');
assert.equal(followProps[0].username, 'mimi');
assert.equal(followProps[0].initialFollowing, true, 'RPC viewer_is_following seeds the row button');
followProps[0].onRequireLogin();
assert.equal(loginTarget, 'mimi');

const followerTab = presses.find((p) => p.accessibilityRole === 'tab' && p.accessibilityLabel === '팔로워 3');
const followingTab = presses.find((p) => p.accessibilityRole === 'tab' && p.accessibilityLabel === '팔로잉 2');
assert.ok(followerTab);
assert.ok(followingTab);
assert.equal(followerTab.accessibilityState.selected, true);
assert.equal(followingTab.accessibilityState.selected, false);

const friendProfile = presses.find((p) => p.accessibilityLabel === '@mimi 프로필 보기');
assert.ok(friendProfile);
friendProfile.onPress();
assert.equal(opened, 'mimi');

unavailable = true;
presses.length = 0;
followProps.length = 0;
html = renderToStaticMarkup(React.createElement(FollowConnectionsView, props));
assert.match(html, /프로필을 볼 수 없어요/);
assert.doesNotMatch(html, /팔로워 3|팔로잉 2/, 'Unavailable profile is not presented as zero counts');
assert.equal(followProps.length, 0);

const source = fs.readFileSync(path.join(root, 'src/components/follow-connections-view.tsx'), 'utf8');
assert.match(source, /item\.bio \?/);
assert.match(source, /viewerUserId !== item\.userId/);
assert.match(source, /initialFollowing=\{item\.viewerIsFollowing\}/);
assert.match(source, /usePublicFollowCounts\(profileId, viewerUserId \?\? null\)/);
assert.match(source, /useFollowConnections\(profileId, direction, viewerUserId \?\? null\)/);
assert.match(source, /imageUrl=\{profileAvatarUrl\(item\.profileImageUrl\)\}/, 'Rows show the owned-storage profile photo (2026-10-11), never a raw URL');

const hookSource = fs.readFileSync(path.join(root, 'src/hooks/useFollow.ts'), 'utf8');
assert.match(hookSource, /initialFollowing\?: boolean/);
assert.match(hookSource, /initialData: initialFollowing/);
const followButtonSource = fs.readFileSync(path.join(root, 'src/components/follow-button.tsx'), 'utf8');
assert.match(followButtonSource, /initialFollowing\?: boolean/);
assert.match(followButtonSource, /useFollowState\(viewerUserId, profileUserId, initialFollowing\)/);
assert.match(followButtonSource, /setConfirmingUnfollow\(true\)/);
assert.match(followButtonSource, />팔로우 취소<\/Text>/);
assert.match(followButtonSource, /accessibilityLabel="팔로우 취소 확인 닫기"/);

console.log('Canonical follow connections view checks passed.');
