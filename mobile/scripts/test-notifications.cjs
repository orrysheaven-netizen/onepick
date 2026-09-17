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
    if (name in imports) return imports[name];
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    assert.fail(name);
  } });
  return exports;
}
const calls = [];
let failure = null;
const rows = Array.from({ length: 21 }, (_, i) => ({ comment_id: 'c'+i, pick_id: 'pick', created_at: '2026-09-17T00:00:00.123456Z', read_at: null }));
const chain = {
  update: (value) => { calls.push(['update', value]); return chain; },
  eq: (key, value) => { calls.push([key, value]); return chain; },
  is: async (key, value) => { calls.push([key, value]); return { error: failure }; },
};
const client = {
  rpc: async (name, args) => { calls.push([name, args]); return { data: name.includes('count') ? 4 : rows, error: failure }; },
  from: (name) => { calls.push(['table', name]); return chain; },
};
const { NotificationService } = load('services/notificationService.ts', {
  '@/lib/supabase/client': { supabase: client }, '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
});
let destination, buttons = [];
const part = (tag) => ({ children }) => React.createElement(tag, null, children);
const native = {
  View: part('div'), Text: part('span'), ActivityIndicator: () => null, RefreshControl: () => null,
  Pressable: (props) => { buttons.push(props); return React.createElement('button', null, props.children); },
  StyleSheet: { create: (styles) => styles },
  FlatList: (props) => React.createElement('main', null, props.ListHeaderComponent,
    props.data.length ? props.data.map((item) => React.createElement('div', { key: item.comment_id }, props.renderItem({ item }))) : props.ListEmptyComponent, props.ListFooterComponent),
};
const countQuery = { data: 4, isError: false };
const imports = {
  'react-native': native, 'expo-router': { useRouter: () => ({ push: (route) => { destination = route; }, replace: () => {} }) },
  '@/constants/onepick': { OnePick: {} },
  '@/hooks/useNotifications': { useNotificationCount: () => countQuery },
};
const { NotificationButton } = load('components/notification-button.tsx', imports);
const auth = { user: { id: 'owner' }, isLoading: false, error: null };
const inbox = { data: { pages: [{ items: [{ ...rows[0], username: 'friend', item_name: '신라면', body: '새 댓글' }] }] }, isError: false };
const { default: Screen } = load('app/notifications.tsx', {
  ...imports,
  'react-native-safe-area-context': { SafeAreaView: part('section') },
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useNotifications': { useNotifications: () => inbox, useReadNotification: () => ({ isPending: false, mutateAsync: async () => {} }) },
});
async function main() {
  const service = new NotificationService(client);
  assert.equal(await service.unreadCount('owner'), 4);
  assert.equal(calls[0][1].p_recipient_id, 'owner');
  const page = await service.page('owner', null);
  assert.equal(page.items.length, 20);
  assert.equal(page.nextCursor.id, 'c19');
  assert.equal(page.nextCursor.timestamp, rows[19].created_at, 'Keep microsecond cursor precision');
  await service.markRead('owner', 'c0');
  assert.ok(calls.some(([key, value]) => key === 'recipient_id' && value === 'owner'));
  assert.ok(calls.some(([key, value]) => key === 'comment_id' && value === 'c0'));
  failure = new Error('offline');
  await assert.rejects(() => service.unreadCount('owner'), /offline/);
  await assert.rejects(() => service.markRead('owner', 'c0'), /offline/);
  buttons = [];
  assert.match(renderToStaticMarkup(React.createElement(NotificationButton, { userId: 'owner' })), /4/);
  buttons[0].onPress(); assert.equal(destination, '/notifications');
  buttons = [];
  assert.match(renderToStaticMarkup(React.createElement(Screen)), /새 댓글/);
  const open = buttons.find((button) => button.accessibilityLabel?.includes('@friend'));
  open.onPress(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(destination.params.pickId, 'pick');
  auth.user = null;
  const publicPage = renderToStaticMarkup(React.createElement(Screen));
  assert.match(publicPage, /로그인/); assert.doesNotMatch(publicPage, /@friend|신라면/, 'No cached private data on logout');
  auth.user = { id: 'owner' }; auth.error = new Error('session');
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(Screen)), /@friend/);
  auth.error = null; inbox.isError = true;
  assert.match(renderToStaticMarkup(React.createElement(Screen)), /불러오지 못했어요/);
  inbox.isError = false; inbox.data.pages[0].items = [];
  assert.match(renderToStaticMarkup(React.createElement(Screen)), /아직 알림이 없어요/);
  console.log('Notification checks passed: cursor, scoped reads, errors, navigation, badge and private UI states.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
