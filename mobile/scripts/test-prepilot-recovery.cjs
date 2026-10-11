const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient } = require('@tanstack/react-query');

const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function load(file, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(name) {
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name === '@/components/ui/dialog-labels') return require('./dialog-labels.cjs');
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name in imports) return imports[name];
    // Pure channel helpers of the choose screen load as-is.
    if (name === '@/lib/home/homeChannels') return load('lib/home/homeChannels.ts');
    if (name === '@/lib/items/pickChannel') return load('lib/items/pickChannel.ts');
    if (name === '@/services/onboardingService') return { onboardingService: { recordAction: async () => {} } };
    assert.fail(`Unexpected dependency: ${name}`);
  } });
  return exports;
}
const { AppError } = load('errors/appError.ts', {});
const flush = () => new Promise((resolve) => setImmediate(resolve));
const text = (value) => value == null || typeof value === 'boolean' ? ''
  : Array.isArray(value) ? value.map(text).join('')
  : typeof value === 'object' ? text(value.props?.children) : String(value);

// A deterministic component/hook runner, NOT a device or browser test. It keeps
// refs across renders, scopes state to real JSX keys, and drops unmounted scopes.
function harness(file, exportName, imports) {
  const instances = new Map();
  let active, used, nodes = [], tree;
  const hooks = {
    useState(initial) {
      const owner = active; const index = owner.index++;
      if (!(index in owner.slots)) owner.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [owner.slots[index], (value) => { owner.slots[index] = typeof value === 'function' ? value(owner.slots[index]) : value; }];
    },
    useRef(initial) {
      const owner = active; const index = owner.index++;
      if (!(index in owner.slots)) owner.slots[index] = { current: initial };
      return owner.slots[index];
    },
    useMemo: (compute) => compute(),
    useEffect: (effect) => { effect(); },
  };
  const native = { StyleSheet: { create: (value) => value, hairlineWidth: 1 } };
  for (const name of ['View', 'Text', 'TextInput', 'ScrollView', 'ActivityIndicator', 'Image', 'Pressable']) native[name] = name;
  const Screen = load(file, {
    react: hooks, 'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/errors/appError': { AppError }, '@/components/pick-photo': { PickPhoto: 'PickPhoto' }, '@/components/pick-photo-step': { PickPhotoStep: () => null },
    '@/components/current-pick-flag': { CurrentPickFlag: 'CurrentPickFlag' },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: 'PickPhoto' }, '@/components/pick-photo-step': { PickPhotoStep: () => null } }),
    '@/components/report-action': { ReportAction: 'ReportAction' }, ...imports,
  })[exportName];
  function walk(value, location) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((child, index) => walk(child, `${location}/${index}`));
    const scopeKey = `${location}:${value.key ?? ''}`;
    if (typeof value.type === 'function') {
      let scope = instances.get(scopeKey);
      if (!scope) { scope = { slots: [], index: 0 }; instances.set(scopeKey, scope); }
      used.add(scopeKey); scope.index = 0; active = scope;
      return walk(value.type(value.props), `${scopeKey}/render`);
    }
    const node = { ...value, props: { ...value.props, children: walk(value.props.children, `${scopeKey}/children`) } };
    nodes.push(node); return node;
  }
  return {
    render(props = {}) {
      used = new Set(); nodes = [];
      tree = walk(jsx(Screen, props), 'root');
      for (const key of instances.keys()) if (!used.has(key)) instances.delete(key);
      return text(tree);
    },
    button(label) {
      const node = nodes.find((n) => n.type === 'Pressable' && (n.props.accessibilityLabel === label || text(n) === label));
      assert.ok(node, `Missing button: ${label}`); return node.props;
    },
    input: () => nodes.find((n) => n.type === 'TextInput')?.props,
    nodes: () => nodes,
  };
}

const itemId = 'a1111111-1111-4111-8111-111111111111';
const categoryId = 'b2222222-2222-4222-8222-222222222222';
function choice() {
  const auth = { user: { id: 'owner' }, isLoading: false, error: null, retry() {} };
  const params = { itemId, categoryId };
  const data = { item: { id: itemId, categoryId, name: '라면', status: 'active', imageUrl: 'https://image.test/item.jpg' }, canChoose: true, myPickStatus: { type: 'not_selected' } };
  const query = { data, isPending: false, isError: false, isFetching: false, retries: 0, refetch: async () => { query.retries++; } };
  const result = { id: 'saved-pick', itemId, categoryId, userId: 'owner', oneLineReview: '나의 이유', status: 'active' };
  const writes = [], pending = [], destinations = [];
  // Deliberately do not flip isPending synchronously: React has not rendered the
  // mutation's pending state when two taps arrive in the same frame.
  const mutation = { isPending: false, isError: false, error: null,
    mutateAsync: (payload) => { writes.push(payload); return new Promise((resolve, reject) => pending.push({ resolve, reject })); } };
  const router = { canGoBack: () => false, back: () => destinations.push('BACK'), replace: (route) => destinations.push(route), push: (route) => destinations.push(route) };
  const view = harness('app/pick/choose.tsx', 'default', {
    'expo-router': { useRouter: () => router, useLocalSearchParams: () => params },
    '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/hooks/useItemDetail': { useItemDetail: () => query }, '@/hooks/useChoosePick': { useChoosePick: () => mutation, useRequestPendingPick: () => ({ isPending: false, error: null }) },
  });
  const draft = () => { view.render(); view.input().onChangeText('  나의 이유  '); view.render(); };
  return { view, auth, params, query, data, result, writes, pending, destinations, mutation, draft };
}
function replies() {
  const auth = { user: { id: 'owner' }, isLoading: false, error: null, retries: 0, retry: () => { auth.retries++; } };
  const detail = { isPending: false, isError: false, data: { pick: { id: 'pick', status: 'active' } }, refetch: async () => {} };
  const comments = { data: [{ comment: { id: 'c', body: 'CACHED_PRIVATE_COMMENT' }, author: null }], isPending: false, isError: false };
  const mutation = { isPending: false, mutateAsync: async () => {}, reset() {} };
  const reads = [], writes = [], pending = [], deletes = [];
  const removal = { isPending: false, isError: false, reset() { removal.isError = false; },
    mutateAsync: async (id) => { deletes.push(id); if (removal.fail) { removal.isError = true; throw new Error('offline'); } } };
  mutation.mutateAsync = (payload) => { writes.push(payload); return new Promise((resolve, reject) => pending.push({ resolve, reject })); };
  const view = harness('components/pick-replies.tsx', 'PickReplies', {
    '@/lib/profile/profileName': { profileDisplayName: (p) => p.nickname?.trim() || p.username, profileNickname: (p) => p.nickname?.trim() || null }, 
    'expo-router': { useRouter: () => ({ push() {} }) }, '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/hooks/usePickDetail': { usePickDetail: () => detail },
    '@/hooks/usePickComments': { usePickComments: (...args) => { reads.push(args); return comments; } },
    '@/hooks/useCreateComment': { useCreateComment: () => mutation },
    '@/hooks/useDeleteComment': { useDeleteComment: () => removal },
  });
  return { auth, view, comments, mutation, removal, deletes, writes, pending, reads };
}

let failures = 0, checks = 0;
async function check(name, run) {
  checks++;
  try { await run(); console.log(`ok: ${name}`); }
  catch (error) { failures++; console.error(`not ok: ${name}\n${error.stack}`); }
}
async function main() {
  await check('Pick saving blocks same-frame double taps and old success handlers', async () => {
    const c = choice(); c.draft(); const submit = c.view.button('내 원픽으로 고르기').onPress;
    submit(); submit(); assert.equal(c.writes.length, 1, 'Only one request before pending UI renders');
    c.pending[0].resolve(c.result); await flush();
    submit(); assert.equal(c.writes.length, 1, 'A stale handler cannot resubmit a confirmed save');
    assert.match(c.view.render(), /내 원픽 보기/);
  });
  await check('Pick retry retains the draft and unlocks after failure', async () => {
    const c = choice(); c.draft(); c.view.button('내 원픽으로 고르기').onPress();
    c.pending[0].reject(new Error('offline')); await flush(); c.view.render();
    assert.equal(c.view.input().value, '  나의 이유  ');
    c.view.button('내 원픽으로 고르기').onPress(); assert.equal(c.writes.length, 2);
    c.pending[1].resolve(c.result); await flush(); assert.match(c.view.render(), /내 원픽 보기/);
  });
  await check('Metadata failure offers a guarded retry without losing the reason', async () => {
    const c = choice(); c.draft(); c.query.isError = true; c.view.render();
    await c.view.button('정보 다시 불러오기').onPress(); assert.equal(c.query.retries, 1);
    c.query.isFetching = true; c.view.render();
    assert.equal(c.view.button('정보 다시 불러오기').disabled, true);
    await c.view.button('정보 다시 불러오기').onPress(); assert.equal(c.query.retries, 1);
    c.query.isFetching = false; c.query.isError = false; c.view.render();
    assert.equal(c.view.input().value, '  나의 이유  '); assert.equal(c.writes.length, 0);
  });
  await check('Direct-link back has a safe home fallback and pending saves block leaving', async () => {
    const c = choice(); c.query.isError = true; c.view.render(); c.view.button('돌아가기').onPress();
    assert.equal(c.destinations.at(-1), '/');
    c.query.isError = false; c.draft(); const back = c.view.button('돌아가기').onPress;
    c.view.button('내 원픽으로 고르기').onPress(); back();
    assert.equal(c.destinations.length, 1, 'Do not navigate away while a save is pending');
    c.mutation.isPending = true; c.view.render(); assert.equal(c.view.input().editable, false);
    c.pending[0].resolve(c.result); await flush();
  });
  await check('Comment pages are viewer-keyed and repeated page rows are deduplicated', async () => {
    const { queryKeys } = load('lib/query/queryKeys.ts', {});
    const { usePickComments } = load('hooks/usePickComments.ts', {
      '@tanstack/react-query': { useInfiniteQuery: (options) => options }, '@/lib/query/queryKeys': { queryKeys },
      '@/services': { commentService: {} },
    });
    const options = ['first', 'second', undefined].map((viewer) => usePickComments('pick', viewer));
    assert.equal(new Set(options.map((o) => JSON.stringify(o.queryKey))).size, 3, 'Do not share comment visibility between accounts');
    // Preserve the complete existing prefix, including its pagination marker.
    const prefix = queryKeys.comments.byPick('pick');
    for (const option of options) assert.equal(JSON.stringify(option.queryKey.slice(0, prefix.length)), JSON.stringify(prefix));
    const row = (id) => ({ comment: { id }, author: null });
    const selected = options[0].select({ pages: [{ items: [row('a'), row('b')] }, { items: [row('b'), row('c')] }] });
    assert.equal(selected.map((entry) => entry.comment.id).join(','), 'a,b,c');
    assert.equal(usePickComments(undefined, 'first').enabled, false);
    const cache = new QueryClient();
    try {
      for (const option of options) cache.setQueryData(option.queryKey, { previous: true });
      const unrelated = usePickComments('another-pick', 'first').queryKey;
      cache.setQueryData(unrelated, { previous: true });
      await cache.invalidateQueries({ queryKey: prefix });
      for (const option of options) assert.equal(cache.getQueryState(option.queryKey).isInvalidated, true, 'Existing write invalidation must refresh every viewer of this Pick');
      assert.equal(cache.getQueryState(unrelated).isInvalidated, false, 'Do not invalidate another Pick by accident');
    } finally { cache.clear(); }
  });
  await check('Comment loading and failed-session states do not expose cached replies or allow posting', async () => {
    const c = replies(); c.view.render({ pickId: 'pick' });
    c.view.input().onChangeText('my draft'); c.view.render({ pickId: 'pick' });
    c.auth.isLoading = true;
    assert.doesNotMatch(c.view.render({ pickId: 'pick' }), /CACHED_PRIVATE_COMMENT|my draft/); assert.equal(c.view.input(), undefined);
    c.auth.isLoading = false; c.auth.error = new Error('session');
    const page = c.view.render({ pickId: 'pick' }); assert.doesNotMatch(page, /CACHED_PRIVATE_COMMENT/);
    assert.match(page, /로그인 상태를 확인하지 못했어요/); c.view.button('로그인 상태 다시 확인').onPress(); assert.equal(c.auth.retries, 1);
    c.auth.error = null; c.view.render({ pickId: 'pick' }); assert.equal(c.view.input().value, 'my draft');
    assert.equal(c.reads.at(-1)[1], 'owner'); assert.equal(c.writes.length, 0);
  });
  await check('Reply drafts and late send results stay with their original account and Pick', async () => {
    const c = replies(); c.view.render({ pickId: 'pick' }); c.view.input().onChangeText('owner draft'); c.view.render({ pickId: 'pick' });
    c.view.button('댓글 남기기').onPress(); assert.equal(c.writes.length, 1);
    c.auth.user = { id: 'other' }; c.view.render({ pickId: 'pick' }); assert.equal(c.view.input().value, '');
    c.view.input().onChangeText('other draft'); c.view.render({ pickId: 'pick' });
    c.pending[0].resolve({}); await flush(); c.view.render({ pickId: 'pick' }); assert.equal(c.view.input().value, 'other draft');
    c.view.render({ pickId: 'another' }); assert.equal(c.view.input().value, '');
  });
  await check('Only the author sees a delete control, and it asks before deleting', async () => {
    const c = replies();
    c.comments.data = [
      { comment: { id: 'mine', userId: 'owner', body: 'MY_COMMENT' }, author: { id: 'owner', username: 'owner' } },
      { comment: { id: 'theirs', userId: 'other', body: 'THEIR_COMMENT' }, author: { id: 'other', username: 'other' } },
    ];
    c.view.render({ pickId: 'pick' });
    const deleteButtons = () => c.view.nodes().filter((n) => n.props?.accessibilityLabel === '내 댓글 삭제');
    assert.equal(deleteButtons().length, 1, 'Only my own comment is deletable');
    c.view.button('내 댓글 삭제').onPress(); assert.equal(c.deletes.length, 0, 'The first tap only asks for confirmation');
    assert.match(c.view.render({ pickId: 'pick' }), /이 댓글을 삭제할까요/);
    c.view.button('댓글 삭제 확인 닫기').onPress(); assert.doesNotMatch(c.view.render({ pickId: 'pick' }), /이 댓글을 삭제할까요/);
    c.view.button('내 댓글 삭제').onPress(); c.view.render({ pickId: 'pick' });
    c.removal.fail = true; c.view.button('댓글 삭제하기').onPress(); await flush();
    assert.deepEqual(c.deletes, ['mine']);
    assert.match(c.view.render({ pickId: 'pick' }), /댓글을 삭제하지 못했어요/, 'A failed delete keeps the confirmation and says so');
    c.removal.fail = false; c.view.button('댓글 삭제하기').onPress(); await flush();
    assert.deepEqual(c.deletes, ['mine', 'mine']);
    assert.doesNotMatch(c.view.render({ pickId: 'pick' }), /이 댓글을 삭제할까요/);
    c.auth.user = null; c.view.render({ pickId: 'pick' });
    assert.equal(deleteButtons().length, 0, 'Signed-out readers cannot delete');
  });
  console.log(`Pre-pilot recovery: ${checks - failures}/${checks} checks passed.`);
  if (failures) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
