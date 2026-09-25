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
const rows = Array.from({ length: 21 }, (_, i) => ({ kind: i % 2 ? 'pick_change' : 'comment', id: 'c'+i, pick_id: 'pick', created_at: '2026-09-17T00:00:00.123456Z', read_at: null }));
let preferenceRow = { followee_pick_change: false };
const chain = {
  update: (value) => { calls.push(['update', value]); return chain; },
  eq: (key, value) => { calls.push([key, value]); return chain; },
  is: async (key, value) => { calls.push([key, value]); return { error: failure }; },
  select: (columns) => { calls.push(['select', columns]); return chain; },
  maybeSingle: async () => ({ data: preferenceRow, error: failure }),
  upsert: async (value, options) => { calls.push(['upsert', value, options]); return { error: failure }; },
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
    props.data.length ? props.data.map((item) => React.createElement('div', { key: props.keyExtractor(item) }, props.renderItem({ item }))) : props.ListEmptyComponent, props.ListFooterComponent),
};
const countQuery = { data: 4, isError: false };
const imports = {
  'react-native': native, 'expo-router': { useRouter: () => ({ push: (route) => { destination = route; }, replace: () => {} }) },
  '@/constants/onepick': { OnePick: {} },
  '@/hooks/useNotifications': { useNotificationCount: () => countQuery },
};
const { NotificationButton } = load('components/notification-button.tsx', imports);
const auth = { user: { id: 'owner' }, isLoading: false, error: null };
const inbox = { data: { pages: [{ items: [
  { ...rows[0], username: 'friend', item_name: '신라면', body: '새 댓글' },
  { ...rows[1], id: 'p1', pick_id: 'pick-p1', username: 'jimin', item_name: '헤드폰', body: '음질이 좋아요' },
  { kind: 'seller_request', id: 'req-1', pick_id: null, username: null, body: '도가니탕', item_name: '○○곰탕 공식몰', created_at: '2026-09-26T00:00:00Z', read_at: null, item_id: 'online-item', category_id: 'dogani' },
] }] }, isError: false };
let readCalls = [];
const { default: Screen } = load('app/notifications.tsx', {
  ...imports,
  'react-native-safe-area-context': { SafeAreaView: part('section') },
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useNotifications': { useNotifications: () => inbox, useReadNotification: () => ({ isPending: false, mutateAsync: async (input) => { readCalls.push(input); } }) },
});
async function main() {
  const service = new NotificationService(client);
  assert.equal(await service.unreadCount('owner'), 4);
  assert.equal(calls[0][0], 'notification_count', 'Unified count RPC, no user id argument');
  const page = await service.page('owner', null);
  assert.equal(calls[1][0], 'notification_page');
  assert.equal(page.items.length, 20);
  assert.equal(page.nextCursor.id, 'c19');
  assert.equal(page.nextCursor.timestamp, rows[19].created_at, 'Keep microsecond cursor precision');
  await service.markRead('owner', 'comment', 'c0');
  assert.ok(calls.some(([key, value]) => key === 'table' && value === 'comment_notifications'));
  assert.ok(calls.some(([key, value]) => key === 'recipient_id' && value === 'owner'));
  assert.ok(calls.some(([key, value]) => key === 'comment_id' && value === 'c0'));
  calls.length = 0;
  await service.markRead('owner', 'pick_change', 'p1');
  assert.ok(calls.some(([key, value]) => key === 'table' && value === 'pick_change_notifications'), 'Pick changes are marked read on their own table');
  assert.ok(calls.some(([key, value]) => key === 'pick_id' && value === 'p1'));
  assert.ok(!calls.some(([key]) => key === 'comment_id'));
  calls.length = 0;
  await service.markRead('owner', 'seller_request', 'req-1');
  assert.ok(calls.some(([key, value]) => key === 'table' && value === 'item_request_notifications'), 'Seller-request notices are marked read on their own table');
  assert.ok(calls.some(([key, value]) => key === 'request_item_id' && value === 'req-1'));
  const sellerService = new NotificationService({ rpc: async () => ({ error: null, data: [
    { kind: 'seller_request', id: 'req-1', pick_id: null, username: null, body: '도가니탕', item_name: '○○곰탕 공식몰', created_at: '2026-09-26T00:00:00Z', read_at: null, item_id: 'online-item', category_id: 'dogani' },
    { kind: 'seller_request', id: 'req-2', pick_id: null, username: null, body: null, item_name: 'x', created_at: '2026-09-26T00:00:00Z', read_at: null, item_id: null, category_id: 'dogani' },
    { kind: 'future_kind', id: 'f1', pick_id: 'p', created_at: '2026-09-26T00:00:00Z' },
  ] }) });
  const sellerPage = await sellerService.page('owner', null);
  assert.deepEqual(sellerPage.items.map((item) => item.id), ['req-1'], 'Seller notices need their item/category; unknown kinds are dropped');
  assert.equal(sellerPage.items[0].pick_id, null); assert.equal(sellerPage.items[0].item_id, 'online-item');
  assert.equal(JSON.stringify(await service.preferences('owner')), JSON.stringify({ followeePickChange: false }));
  preferenceRow = null;
  assert.equal(JSON.stringify(await service.preferences('owner')), JSON.stringify({ followeePickChange: true }), 'No row means on');
  calls.length = 0;
  await service.setFolloweePickChange('owner', false);
  const upsert = calls.find(([key]) => key === 'upsert');
  assert.equal(upsert[1].user_id, 'owner'); assert.equal(upsert[1].followee_pick_change, false); assert.equal(upsert[2].onConflict, 'user_id');
  failure = new Error('offline');
  await assert.rejects(() => service.unreadCount('owner'), /offline/);
  await assert.rejects(() => service.markRead('owner', 'comment', 'c0'), /offline/);
  await assert.rejects(() => service.setFolloweePickChange('owner', true), /offline/);
  buttons = [];
  assert.match(renderToStaticMarkup(React.createElement(NotificationButton, { userId: 'owner' })), /4/);
  buttons[0].onPress(); assert.equal(destination, '/notifications');
  buttons = [];
  const inboxHtml = renderToStaticMarkup(React.createElement(Screen));
  assert.match(inboxHtml, /새 댓글/);
  assert.match(inboxHtml, /새 원픽/); assert.match(inboxHtml, /@jimin/); assert.match(inboxHtml, /헤드폰을\(를\) 원픽으로 골랐어요/); assert.match(inboxHtml, /“음질이 좋아요”/);
  const open = buttons.find((button) => button.accessibilityLabel?.includes('@friend'));
  open.onPress(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(destination.params.pickId, 'pick');
  assert.equal(JSON.stringify(readCalls.at(-1)), JSON.stringify({ kind: 'comment', id: 'c0' }));
  const openPick = buttons.find((button) => button.accessibilityLabel?.includes('@jimin'));
  openPick.onPress(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(destination.params.pickId, 'pick-p1', 'Pick-change rows open the new pick');
  assert.equal(JSON.stringify(readCalls.at(-1)), JSON.stringify({ kind: 'pick_change', id: 'p1' }));
  assert.match(inboxHtml, /원픽 운영팀/); assert.match(inboxHtml, /요청 완료/);
  assert.match(inboxHtml, /요청한 온라인 판매처 ○○곰탕 공식몰이\(가\) 등록됐어요/); assert.match(inboxHtml, /도가니탕 · 온라인/);
  assert.doesNotMatch(inboxHtml, /@null/, 'Seller notices have no fake sender');
  const openSeller = buttons.find((button) => button.accessibilityLabel?.includes('요청한 온라인 판매처'));
  openSeller.onPress(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(destination.pathname, '/pick/choose', 'A resolved request opens the choose screen for the new seller');
  assert.equal(destination.params.itemId, 'online-item'); assert.equal(destination.params.categoryId, 'dogani');
  assert.equal(JSON.stringify(readCalls.at(-1)), JSON.stringify({ kind: 'seller_request', id: 'req-1' }));
  auth.user = null;
  const publicPage = renderToStaticMarkup(React.createElement(Screen));
  assert.match(publicPage, /로그인/); assert.doesNotMatch(publicPage, /@friend|신라면/, 'No cached private data on logout');
  auth.user = { id: 'owner' }; auth.error = new Error('session');
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(Screen)), /@friend/);
  auth.error = null; inbox.isError = true;
  const staleInbox = renderToStaticMarkup(React.createElement(Screen));
  assert.match(staleInbox, /@friend/, 'A refresh error keeps the last successful inbox visible');
  assert.match(staleInbox, /갱신하지 못했어요/, 'A refresh error is shown as a non-blocking warning');
  inbox.data.pages[0].items = [];
  assert.match(renderToStaticMarkup(React.createElement(Screen)), /알림을 불러오지 못했어요/);
  inbox.isError = false;
  assert.match(renderToStaticMarkup(React.createElement(Screen)), /아직 알림이 없어요/);
  console.log('Notification checks passed: unified inbox cursor, per-kind read marks, cached-data refresh resilience, preferences, errors, navigation, badge and private UI states.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
