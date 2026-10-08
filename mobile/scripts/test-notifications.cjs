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
  }).outputText, { exports, require: (name) => {
    if (name === '@/lib/home/homeChannels') return load('lib/home/homeChannels.ts');
    if (name in imports) return imports[name];
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    assert.fail(name);
  } });
  return exports;
}

const calls = [];
let failure = null;
const group = (i, kind = 'comment') => ({
  group_id: `${kind}:group-${i}`,
  kind,
  latest_at: `2026-09-29T00:00:${String(i % 60).padStart(2, '0')}.123456Z`,
  snapshot: `2026-09-29T00:00:${String(i % 60).padStart(2, '0')}.123456Z`,
  unread_count: i === 0 ? 2 : 1,
  total_count: i === 0 ? 3 : 1,
  actor_count: i === 0 ? 2 : 1,
  actor: kind === 'fix_needed' ? null : { user_id: `u-${i}`, username: i === 0 ? 'friend' : `user${i}`, profile_image_url: null },
  target: {
    item_id: `item-${i}`,
    item_name: i === 0 ? '신라면' : `메뉴${i}`,
    category_id: 'cat',
    category_name: '라면',
    channel: 'offline',
    pick_id: kind === 'fix_needed' ? null : `pick-${i}`,
    comment_id: kind === 'comment' || kind === 'reply' ? `comment-${i}` : null,
    root_comment_id: kind === 'reply' ? `root-${i}` : null,
    user_id: kind === 'followee_pick' ? `u-${i}` : null,
  },
  reason: kind === 'fix_needed' ? '지도 링크를 다시 확인해주세요.' : null,
});
let rows = Array.from({ length: 21 }, (_, i) => group(i, i % 2 ? 'followee_pick' : 'comment'));
let preferenceRow = { followee_pick_change: false };
const chain = {
  select: (columns) => { calls.push(['select', columns]); return chain; },
  eq: (key, value) => { calls.push([key, value]); return chain; },
  maybeSingle: async () => ({ data: preferenceRow, error: failure }),
  upsert: async (value, options) => { calls.push(['upsert', value, options]); return { error: failure }; },
};
const client = {
  rpc: async (name, args) => {
    calls.push([name, args]);
    if (failure) return { data: null, error: failure };
    if (name === 'notification_unread_count') return { data: 4, error: null };
    if (name === 'mark_notification_group_read') return { data: 2, error: null };
    return { data: rows, error: null };
  },
  from: (name) => { calls.push(['table', name]); return chain; },
};

const { NotificationService } = load('services/notificationService.ts', {
  '@/lib/supabase/client': { supabase: client },
  '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
  '@/lib/profile/profileImage': load('lib/profile/profileImage.ts', {
    '@/repositories/mappers/profileMapper': load('repositories/mappers/profileMapper.ts'),
  }),
});
const service = new NotificationService(client);

let destination;
let buttons = [];
const part = (tag) => ({ children }) => React.createElement(tag, null, children);
const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';
const native = {
  View: part('div'), Text: part('span'), ActivityIndicator: () => null, RefreshControl: () => null,
  Pressable: (props) => { buttons.push(props); return React.createElement('button', null, props.children); },
  StyleSheet: { create: (styles) => styles },
  FlatList: (props) => React.createElement('main', null, props.ListHeaderComponent,
    props.data.length ? props.data.map((item) => React.createElement('div', { key: props.keyExtractor(item) }, props.renderItem({ item }))) : props.ListEmptyComponent,
    props.ListFooterComponent),
};

const auth = { user: { id: 'owner' }, isLoading: false, error: null };
const inbox = {
  data: { pages: [{ items: [
    group(0, 'comment'),
    group(1, 'reply'),
    group(2, 'pick_review'),
    group(3, 'followee_pick'),
    group(4, 'fix_needed'),
  ] }] },
  isPending: false, isFetching: false, isRefetching: false, isFetchingNextPage: false,
  isError: false, hasNextPage: false,
  refetch: async () => {}, fetchNextPage: async () => {},
};

const { default: Screen } = load('app/(tabs)/notifications.tsx', {
  'react-native': native,
  'react-native-safe-area-context': { SafeAreaView: part('section') },
  'expo-router': { useRouter: () => ({ push: (route) => { destination = route; } }) },
  '@/constants/onepick': require('./design-tokens.cjs'),
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useNotifications': { useNotifications: () => inbox },
  '@/services': { commentService: { locateComment: async () => ({
    rootCommentId: 'root-1',
    pickId: 'pick-1',
    itemId: 'item-1',
    categoryId: 'cat',
    channel: 'offline',
    reviewIsCurrent: true,
    reviewIsDeleted: false,
    pageCursor: { timestamp: '2026-09-28T23:59:00Z', id: 'cursor-root' },
  }) } },
});

async function main() {
  assert.equal(await service.unreadCount('owner'), 4);
  assert.equal(calls[0][0], 'notification_unread_count');

  calls.length = 0;
  const page = await service.page('owner', null);
  assert.equal(calls[0][0], 'notification_group_page');
  assert.equal(calls[0][1].p_limit, 21);
  assert.equal(page.items.length, 20);
  assert.equal(page.nextCursor.groupId, rows[19].group_id);
  assert.equal(page.nextCursor.activity, rows[19].latest_at);

  calls.length = 0;
  assert.equal(await service.markGroupRead('owner', 'comment:pick', '2026-09-29T00:00:00Z'), 2);
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(['mark_notification_group_read', {
    p_group_id: 'comment:pick',
    p_until: '2026-09-29T00:00:00Z',
  }]));

  assert.equal(JSON.stringify(await service.preferences('owner')), JSON.stringify({ followeePickChange: false }));
  preferenceRow = null;
  assert.equal(JSON.stringify(await service.preferences('owner')), JSON.stringify({ followeePickChange: true }));
  calls.length = 0;
  await service.setFolloweePickChange('owner', false);
  const upsert = calls.find(([name]) => name === 'upsert');
  assert.equal(upsert[1].user_id, 'owner');
  assert.equal(upsert[1].followee_pick_change, false);

  failure = new Error('offline');
  await assert.rejects(() => service.unreadCount('owner'), /offline/);
  await assert.rejects(() => service.markGroupRead('owner', 'g', '2026-09-29T00:00:00Z'), /offline/);
  failure = null;

  buttons = [];
  const html = renderToStaticMarkup(React.createElement(Screen));
  assert.match(html, /새 댓글/);
  assert.match(html, /새 답글/);
  assert.match(html, /새 한줄평/);
  assert.match(html, /새 원픽/);
  assert.match(html, /수정 필요/);
  assert.match(html, /지도 링크를 다시 확인해주세요/);
  assert.doesNotMatch(html, /승인됐어요|등록 결과|승인 대기/, 'approval/merge lifecycle rows are not created by the grouped UI');

  const commentButton = buttons.find((button) => button.accessibilityLabel?.includes('신라면 내 한줄평에 댓글'));
  assert.ok(commentButton);
  await commentButton.onPress();
  assert.equal(destination.pathname, '/pick/[pickId]');
  assert.equal(destination.params.pickId, 'pick-0');
  assert.equal(destination.params.notificationGroupId, 'comment:group-0');
  assert.equal(destination.params.notificationSnapshot, group(0).snapshot);

  const replyButton = buttons.find((button) => button.accessibilityLabel?.includes('댓글에 답글'));
  assert.ok(replyButton);
  replyButton.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(destination.pathname, '/pick/[pickId]');
  assert.equal(destination.params.pickId, 'pick-1');
  assert.equal(destination.params.rootCommentId, 'root-1');
  assert.equal(destination.params.commentAfterTime, '2026-09-28T23:59:00Z');
  assert.equal(destination.params.commentAfterId, 'cursor-root');

  const fixButton = buttons.find((button) => button.accessibilityLabel?.includes('수정해주세요'));
  assert.ok(fixButton);
  await fixButton.onPress();
  assert.equal(destination.pathname, '/item/[itemId]');
  assert.equal(destination.params.itemId, 'item-4');
  assert.equal(destination.params.notificationKind, 'fix_needed');
  assert.equal(destination.params.notificationReason, '지도 링크를 다시 확인해주세요.');

  // Opening the inbox never acknowledges a group. The read mutation lives at
  // the successfully-loaded destination screen.
  const notificationSource = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/notifications.tsx'), 'utf8');
  assert.doesNotMatch(notificationSource, /useReadNotificationGroup|markGroupRead/, 'inbox open must not mark read');
  const itemSource = fs.readFileSync(path.join(__dirname, '../src/app/item/[itemId].tsx'), 'utf8');
  const conversationSource = fs.readFileSync(path.join(__dirname, '../src/app/pick/[pickId].tsx'), 'utf8');
  assert.match(conversationSource, /useReadNotificationGroup/);
  assert.match(conversationSource, /notificationKind === 'reply' && !replyTargetLoaded/);
  assert.match(itemSource, /useRevisePendingItem/);
  assert.match(itemSource, /수정 내용 보내기/);

  auth.user = null;
  buttons = [];
  destination = undefined;
  const loggedOut = renderToStaticMarkup(React.createElement(Screen));
  assert.match(loggedOut, /로그인/);
  assert.doesNotMatch(loggedOut, /신라면|지도 링크를 다시 확인해주세요/);
  const loginButton = buttons.find((button) => textOf(button.children) === '로그인');
  assert.ok(loginButton, 'signed-out inbox exposes a login action');
  loginButton.onPress();
  assert.equal(destination.pathname, '/auth/login');
  assert.equal(destination.params.action, 'notifications', 'login must return to the notification inbox');

  console.log('Notification checks passed: grouped RPCs, cursor/snapshot read contract, grouped UI, lifecycle exclusion, destination receipt, fix-needed revision entry and signed-out return intent.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
