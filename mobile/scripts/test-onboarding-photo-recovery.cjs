const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, setTimeout, clearTimeout, require(name) {
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
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
const { AppError } = load('errors/appError.ts');
const intents = load('lib/auth/authIntent.ts');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const text = (value) => value == null || typeof value === 'boolean' ? '' : Array.isArray(value) ? value.map(text).join('')
  : typeof value === 'object' ? text(value.props?.children) : String(value);
const id = 'a1111111-1111-4111-8111-111111111111';
const category = 'b2222222-2222-4222-8222-222222222222';
// Source-level deterministic hook runner. It models keyed state/refs/effect cleanup,
// not a physical keyboard, OAuth provider, browser history or a device file picker.
function harness(file, imports) {
  const instances = new Map(); let active, used, nodes, effects;
  const hooks = {
    useState(initial) {
      const owner = active, i = owner.index++;
      if (!(i in owner.slots)) owner.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [owner.slots[i], (v) => { owner.slots[i] = typeof v === 'function' ? v(owner.slots[i]) : v; }];
    },
    useRef(initial) {
      const owner = active, i = owner.index++;
      if (!(i in owner.slots)) owner.slots[i] = { current: initial };
      return owner.slots[i];
    },
    useMemo: (fn) => fn(), useCallback: (fn) => fn,
    useEffect(fn, deps) {
      const owner = active, i = owner.index++, prev = owner.slots[i];
      if (!prev || !deps || deps.some((v, n) => v !== prev.deps?.[n])) effects.push(() => {
        prev?.cleanup?.(); owner.slots[i] = { deps, cleanup: fn(), effect: true };
      });
    },
  };
  const native = { StyleSheet: { create: (s) => s, hairlineWidth: 1 }, Platform: { OS: 'ios' } };
  for (const n of ['View','Text','TextInput','ScrollView','ActivityIndicator','Image','Pressable','KeyboardAvoidingView']) native[n] = n;
  const Screen = load(file, {
    react: hooks, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/errors/appError': { AppError }, '@/lib/auth/authIntent': intents,
    '@/components/pick-photo': { PickPhoto: 'PickPhoto' }, '@/components/pick-photo-step': { PickPhotoStep: () => null }, '@/components/onepick-brand': { OnePickBrand: 'OnePickBrand' },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: 'PickPhoto' }, '@/components/pick-photo-step': { PickPhotoStep: () => null } }),
    '@/lib/photos/photoFailure': { showPhotoFailure() {}, isPhotoFailure: () => false },
    '@/lib/home/homeChannels': load('lib/home/homeChannels.ts'), '@/lib/items/itemTitle': load('lib/items/itemTitle.ts'), '@/lib/items/pickSavedToast': load('lib/items/pickSavedToast.ts'), '@/lib/categories/registrationRoute': load('lib/categories/registrationRoute.ts'),
    '@/services': { observabilityService: { captureProductEvent: async () => {} } }, ...imports,
  }).default;
  function walk(value, loc) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v, i) => walk(v, loc+'/'+i));
    const key = loc+':'+(value.key ?? '');
    if (typeof value.type === 'function') {
      let owner = instances.get(key);
      if (!owner) { owner = { slots: [], index: 0 }; instances.set(key, owner); }
      used.add(key); owner.index = 0; active = owner;
      return walk(value.type(value.props), key+'/render');
    }
    const node = { ...value, props: { ...value.props, children: walk(value.props.children, key+'/children') } };
    nodes.push(node); return node;
  }
  function dispose(scope) { for (const slot of scope.slots) if (slot?.effect) slot.cleanup?.(); }
  return {
    render() {
      used = new Set(); nodes = []; effects = [];
      const tree = walk(jsx(Screen, {}), 'root');
      for (const [k, v] of instances) if (!used.has(k)) { dispose(v); instances.delete(k); }
      effects.forEach((f) => f()); return text(tree);
    },
    unmount() { for (const scope of instances.values()) dispose(scope); instances.clear(); },
    button(label) {
      const b = nodes.find((n) => n.type === 'Pressable' && (n.props.accessibilityLabel === label || text(n) === label));
      assert.ok(b, `Missing button: ${label}`); return b.props;
    },
    input: () => nodes.find((n) => n.type === 'TextInput')?.props,
    nodes: () => nodes,
  };
}
function setup(file, extra = {}) {
  const auth = { user: { id: 'owner' }, isLoading: false, error: null, retry() {} };
  const params = { action: 'choose_pick', itemId: id, categoryId: category };
  const destinations = [], attempts = [], pending = [];
  const router = { push: (v) => destinations.push(v), replace: (v) => destinations.push(v), canGoBack: () => false, back() {}, setParams() {} };
  const mutation = { isPending: false, isError: false, error: null, reset() {}, mutateAsync: (payload) => {
    attempts.push(payload); return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  } };
  const query = { isPending: false, isError: false, isFetching: false, retries: 0, data: {
    item: { id, categoryId: category, status: 'active', name: '라면' },
    category: { name: '라면' }, myPickStatus: { type: 'not_selected' }, picks: [], canChoose: true,
  }, refetch: async () => { query.retries++; } };
  const picker = { isPending: false, isError: false, mutateAsync: async () => ({ uri: 'file://private-draft.jpg' }) };
  const view = harness(file, {
    'expo-router': { useRouter: () => router, useLocalSearchParams: () => params },
    '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/hooks/useItemDetail': { useItemDetail: () => query },
    '@/hooks/useChoosePick': { useChoosePick: () => mutation, useRequestPendingPick: () => ({ isPending: false, error: null }) },
    '@/hooks/useCreateProfile': { useCreateProfile: () => mutation },
    '@/hooks/useRegisterPick': {
      useChoosePhoto: () => picker,
      useAttachItemPhoto: () => mutation,
      useMyPendingItemPhoto: () => ({ data: null, isPending: false }),
      useRevisePendingItem: () => ({ isPending: false, mutateAsync: async () => ({}) }),
    },
    '@/hooks/useNotifications': { useReadNotificationGroup: () => ({ isPending: false, mutateAsync: async () => 0 }) },
    '@/services/storeFirstService': { isNaverMapUrl: () => true },
    '@/components/item-pick-count': { ItemPickCount: 'ItemPickCount' }, '@/components/item-channel-links': { ItemChannelLinks: 'ItemChannelLinks' }, '@/components/youtube-video-link': { YouTubeVideoLink: 'ItemChannelLinks' },
    '@/components/item-review-card': { ItemReviewCard: 'ItemReviewCard' }, ...extra,
  });
  return { auth, params, destinations, attempts, pending, mutation, query, picker, view };
}
let total = 0, failed = 0;
async function check(name, run) {
  total++;
  try { await run(); console.log('ok: '+name); }
  catch (e) { failed++; console.error('not ok: '+name+'\n'+e.stack); }
}
async function main() {
  await check('Choice has actionable username and expired-login recovery for the same item', async () => {
    const c = setup('app/pick/choose.tsx'); c.mutation.isError = true;
    c.mutation.error = new AppError('PROFILE_NOT_FOUND');
    assert.match(c.view.render(), /사용자명/);
    c.view.button('사용자명 만들고 계속').onPress();
    let dest = c.destinations.at(-1);
    assert.equal(dest.pathname, '/auth/username'); assert.equal(dest.params.action, 'choose_pick');
    assert.equal(dest.params.itemId, id); assert.equal(dest.params.categoryId, category);
    assert.equal(intents.getPostAuthRoute(intents.getAuthIntent(dest.params)).pathname, '/pick/choose');
    c.mutation.error = new AppError('AUTH_REQUIRED'); c.view.render();
    c.view.button('다시 로그인하고 계속').onPress(); dest = c.destinations.at(-1);
    assert.equal(dest.pathname, '/auth/login'); assert.equal(dest.params.itemId, id);
    assert.equal(c.attempts.length, 0, 'Recovery navigation must not create a Pick');
  });
  await check('Username saving blocks same-frame duplicates, freezes input, and preserves return target', async () => {
    const c = setup('app/auth/username.tsx'); c.view.render(); c.view.input().onChangeText('  valid_name  '); c.view.render();
    const save = c.view.button('이 아이디로 시작하기').onPress; save(); save();
    assert.equal(c.attempts.length, 1); assert.equal(c.attempts[0], 'valid_name');
    c.mutation.isPending = true; c.view.render(); assert.equal(c.view.input().editable, false);
    c.pending[0].resolve({ id: 'owner', username: 'valid_name' }); await flush(); save();
    assert.equal(c.attempts.length, 1); assert.equal(c.destinations.length, 1);
    assert.equal(c.destinations[0].params.itemId, id); assert.equal(c.destinations[0].pathname, '/pick/choose');
  });
  await check('Unverified sessions cannot display/submit a username draft and retry retains it', async () => {
    const c = setup('app/auth/username.tsx'); c.view.render(); c.view.input().onChangeText('my_name'); c.view.render();
    c.auth.error = new Error('offline'); c.view.render(); assert.equal(c.view.input(), undefined);
    assert.equal(c.attempts.length, 0); c.auth.error = null; c.auth.isLoading = true;
    c.view.render(); assert.equal(c.view.input(), undefined); c.auth.isLoading = false;
    c.view.render(); assert.equal(c.view.input().value, 'my_name');
    c.view.button('이 아이디로 시작하기').onPress(); c.pending[0].reject(new AppError('USERNAME_TAKEN')); await flush();
    c.view.render(); assert.equal(c.view.input().value, 'my_name');
    c.view.button('이 아이디로 시작하기').onPress(); assert.equal(c.attempts.length, 2);
    c.pending[1].resolve({ id: 'owner', username: 'my_name' }); await flush();
  });
  await check('Username drafts and late completions cannot navigate another account or an unmounted form', async () => {
    const c = setup('app/auth/username.tsx'); c.view.render(); c.view.input().onChangeText('owner_draft'); c.view.render();
    c.view.button('이 아이디로 시작하기').onPress(); c.auth.user = { id: 'other' };
    c.view.render(); assert.equal(c.view.input().value, '');
    c.pending[0].resolve({ id: 'owner', username: 'owner_draft' }); await flush(); assert.equal(c.destinations.length, 0);
    c.view.input().onChangeText('new_draft'); c.view.render(); c.view.button('이 아이디로 시작하기').onPress();
    c.view.unmount(); c.pending[1].resolve({ id: 'other', username: 'new_draft' }); await flush(); assert.equal(c.destinations.length, 0);
  });
  await check('Photo confirmation survives a later read failure without stale content or duplicate upload', async () => {
    const c = setup('app/item/[itemId].tsx'); c.params.photo = '1';
    c.view.render(); c.view.button('사진 올리기').onPress(); await flush(); c.view.render();
    c.view.button('이 사진 등록하기').onPress();
    c.pending[0].resolve({ ...c.query.data.item, imagePath: 'owner/photo.jpg', imageUrl: 'https://storage.test/photo.jpg' });
    await flush(); assert.equal(c.attempts.length, 1);
    c.query.isError = true; c.query.error = new Error('offline'); c.query.data = undefined;
    const page = c.view.render(); assert.match(page, /사진 등록 요청을 처리했어요/);
    assert.doesNotMatch(page, /이 사진 등록하기|사진 올리기/);
    assert.equal(c.view.nodes().some((n) => n.type === 'ItemReviewCard'), false);
    const before = c.query.retries; c.view.button('정보 다시 불러오기').onPress(); await flush();
    assert.equal(c.query.retries, before+1); assert.equal(c.attempts.length, 1, 'Only refetch, never upload again');
    c.query.isFetching = true; c.view.render(); assert.equal(c.view.button('정보 다시 불러오기').disabled, true);
    c.view.button('정보 다시 불러오기').onPress(); assert.equal(c.query.retries, before+1);
    c.auth.isLoading = true; assert.doesNotMatch(c.view.render(), /사진 등록 요청을 처리했어요|private-draft/);
    c.auth.isLoading = false; c.auth.user = { id: 'other' }; assert.doesNotMatch(c.view.render(), /사진 등록 요청을 처리했어요/);
  });
  await check('Invalid item links cannot spin forever and photo sessions show errors before disabled-query loading', async () => {
    const c = setup('app/item/[itemId].tsx'); delete c.params.itemId; c.query.data = undefined; c.query.isPending = true;
    assert.doesNotMatch(c.view.render(), /정보를 불러오고 있어요/);
    c.params.itemId = id; c.query.isPending = false; c.query.isError = true; c.query.error = new AppError('ITEM_NOT_FOUND');
    const missing = c.view.render(); assert.match(missing, /정보를 볼 수 없어요/); assert.doesNotMatch(missing, /정보를 불러오고 있어요/);
    c.auth.error = new Error('session');
    assert.match(c.view.render(), /로그인 상태를 확인하지 못했어요/);
  });
  await check('Profile creation retries acknowledge an already saved own profile but do not take another name', async () => {
    const { ProfileService } = load('services/profileService.ts', { '@/errors/appError': { AppError } });
    let own = null, writes = 0, taken = null;
    const repository = { getById: async () => own, getByUsername: async () => taken, create: async (input) => {
      writes++; assert.equal(input.expectedUserId, 'owner'); own = { id: 'owner', username: input.username };
      throw new Error('response lost');
    } };
    const service = new ProfileService(repository, {});
    await assert.rejects(() => service.createProfile('my_name', 'owner'), /response lost/);
    taken = own;
    assert.equal((await service.createProfile('my_name', 'owner')).id, 'owner'); assert.equal(writes, 1);
    own = null; taken = { id: 'someone-else', username: 'my_name' };
    await assert.rejects(() => service.createProfile('my_name', 'owner'), /USERNAME_TAKEN/); assert.equal(writes, 1);
    let args;
    const { useCreateProfile } = load('hooks/useCreateProfile.ts', {
      '@tanstack/react-query': { useMutation: (o) => o, useQueryClient: () => ({ invalidateQueries: async () => {} }) },
      '@/lib/query/queryKeys': { queryKeys: { profiles: { all: ['profiles'] } } },
      '@/services': { profileService: { createProfile: (...a) => { args = a; } } },
    });
    useCreateProfile('owner').mutationFn('my_name'); assert.equal(args[1], 'owner');
  });
  await check('Profile repository verifies expected account and handles acknowledged own-profile collisions', async () => {
    const { SupabaseProfileRepository } = load('repositories/supabase/supabaseProfileRepository.ts', {
      '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError: (e) => e },
      '@/repositories/mappers/profileMapper': { mapProfileRow: (r) => r },
    });
    let userId = 'other', writes = 0;
    const chain = { insert() { writes++; return chain; }, select: () => chain, single: async () => ({ data: null, error: { code: '23505' } }) };
    const repo = new SupabaseProfileRepository({ auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) }, from: () => chain });
    await assert.rejects(() => repo.create({ username: 'my_name', expectedUserId: 'owner' }), /AUTH_REQUIRED/);
    assert.equal(writes, 0, 'Account switch must be rejected before DB insert');
    userId = 'owner'; repo.getById = async () => ({ id: 'owner', username: 'already_saved' });
    assert.equal((await repo.create({ username: 'new_name', expectedUserId: 'owner' })).username, 'already_saved');
    repo.getById = async () => null;
    await assert.rejects(() => repo.create({ username: 'taken', expectedUserId: 'owner' }), /USERNAME_TAKEN/);
  });
  console.log(`Onboarding/photo recovery: ${total-failed}/${total} groups passed.`);
  if (failed) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
