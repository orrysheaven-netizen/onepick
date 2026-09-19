// AI profile performance safeguards: all hooks/transports are mocked; no network.
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src');

function loader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const local = { exports: {} }; cache.set(file, local);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const resolve = (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      let target;
      if (name.startsWith('@/')) target = path.join(root, name.slice(2));
      else if (name.startsWith('.')) target = path.resolve(path.dirname(file), name);
      else throw new Error('Unexpected import: ' + name);
      if (!existsSync(target)) target += '.ts';
      return load(target);
    };
    new Function('module', 'exports', 'require', code)(local, local.exports, resolve);
    return local.exports;
  }
  return load;
}

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }

(async () => {
  await test('client performance events keep only bounded non-content fields', () => {
    const read = loader({ '@/lib/profileAiTone': {} });
    const perf = read(path.join(root, 'lib/profileAiPerformance.ts'));
    const secret = 'PRIVATE_REVIEW_TEXT_MUST_NOT_APPEAR';
    let line = '';
    const event = perf.logProfileAiClientPerformance({
      tone: 'warm', outcome: 'success', preflightMs: 12.6, generationMs: 20001.2, totalMs: 20020.9,
      userId: secret, review: secret,
    }, (message) => { line = message; });
    assert.deepEqual(Object.keys(event).sort(), ['event','generationMs','outcome','preflightMs','tone','totalMs']);
    assert.equal(event.preflightMs, 13); assert.equal(event.generationMs, 20001); assert.equal(event.totalMs, 20021);
    assert.ok(!line.includes(secret));
    assert.equal(perf.profileAiClientOutcomeFromCode('RATE_LIMITED'), 'rate_limited');
    assert.equal(perf.profileAiClientOutcomeFromCode('SOMETHING_ELSE'), 'failed');
  });

  await test('review polling runs only while the route is active', () => {
    let options;
    const read = loader({
      '@tanstack/react-query': { useQuery: (value) => { options = value; return value; }, useMutation() {}, useQueryClient() {} },
      '@/services': { profileAiReviewService: { get() {} } },
      '@/lib/query/queryKeys': { queryKeys: { profiles: { aiReview: () => ['review'] } } },
    });
    const { useProfileAiReview } = read(path.join(root, 'hooks/useProfileAiReview.ts'));
    useProfileAiReview('profile', 'viewer', false);
    assert.equal(options.enabled, false); assert.equal(options.refetchInterval, false);
    useProfileAiReview('profile', 'viewer', true);
    assert.equal(options.enabled, true); assert.equal(options.refetchInterval, 30000);
    assert.equal(options.staleTime, 30000); assert.equal(options.refetchOnWindowFocus, false);
  });

  await test('eligibility is event/preflight driven rather than continuously polled', () => {
    let options;
    const read = loader({
      '@tanstack/react-query': { useQuery: (value) => { options = value; return value; } },
      '@/services/profileAiEligibilityService': { profileAiEligibilityService: { get() {} } },
    });
    read(path.join(root, 'hooks/useProfileAiEligibility.ts')).useProfileAiEligibility('profile', true, 10);
    assert.equal(options.enabled, true); assert.equal(options.refetchInterval, false);
    assert.equal(options.staleTime, 30000); assert.equal(options.gcTime, 300000);
    assert.equal(options.refetchOnWindowFocus, false);
  });

  await test('server contract status is shared for five minutes and never profile-polled', () => {
    let options;
    const read = loader({
      '@tanstack/react-query': { useQuery: (value) => { options = value; return value; } },
      '@/services/profileAiStatusService': { profileAiStatusService: { get() {} } },
    });
    read(path.join(root, 'hooks/useProfileAiStatus.ts')).useProfileAiStatus(true);
    assert.equal(options.refetchInterval, false); assert.equal(options.staleTime, 300000);
    assert.equal(options.gcTime, 600000); assert.equal(options.refetchOnWindowFocus, false);
  });

  await test('generation completion never waits for a display refetch', async () => {
    let mutation, invalidationArgs, cache;
    let resolveInvalidation;
    const never = new Promise((resolve) => { resolveInvalidation = resolve; });
    const read = loader({
      '@tanstack/react-query': {
        useQuery() {},
        useMutation: (value) => { mutation = value; return value; },
        useQueryClient: () => ({
          setQueryData: (_key, value) => { cache = value; },
          invalidateQueries: (args) => { invalidationArgs = args; return never; },
        }),
      },
      '@/services': { profileAiReviewService: { generate: async () => ({ id: 'review' }) } },
      '@/lib/query/queryKeys': { queryKeys: { profiles: { aiReview: () => ['owner-review'] } } },
    });
    read(path.join(root, 'hooks/useProfileAiReview.ts')).useGenerateProfileAiReview('profile', 'viewer');
    const review = await mutation.mutationFn({ count: 10, tone: 'direct' });
    mutation.onSuccess(review);
    const settled = mutation.onSettled();
    assert.equal(settled, undefined);
    assert.deepEqual(cache, review);
    assert.deepEqual(invalidationArgs, { queryKey: ['profiles', 'ai-review', 'profile'], refetchType: 'none' });
    resolveInvalidation();
  });

  await test('AI card disables polling hooks when its route is not focused', () => {
    const calls = [];
    const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props: props ?? {} };
    const read = loader({
      'expo-router': { useIsFocused: () => false },
      react: { useEffect: (fn) => fn(), useRef: (current) => ({ current }), useState: (value) => [value, () => {}] },
      'react/jsx-runtime': { jsx, jsxs: jsx },
      'react-native': { View: 'view', Text: 'text', Pressable: 'button', ActivityIndicator: 'loading', StyleSheet: { create: (x) => x } },
      '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: 'p' }, isLoading: false }) },
      '@/hooks/useProfileAiReview': {
        useProfileAiReview: (_p, _v, active) => { calls.push(['review', active]); return { data: null, isPending: false, isError: false }; },
        useGenerateProfileAiReview: () => ({ isPending: false }),
        useSetProfileAiReviewVisibility: () => ({ isPending: false }),
      },
      '@/hooks/useProfileAiEligibility': { useProfileAiEligibility: (_p, active) => {
        calls.push(['eligibility', active]); return { data: 10, isPending: false, isError: false, isFetching: false };
      } },
      '@/hooks/useProfileAiStatus': { useProfileAiStatus: (active) => {
        calls.push(['status', active]); return { data: { configured: true, compatible: true }, isPending: false, isError: false, isFetching: false };
      } },
    });
    read(path.join(root, 'components/profile-ai-review-card.tsx')).ProfileAiReviewCard({ profileUserId: 'p', pickCount: 10, isMine: true });
    assert.deepEqual(calls, [['review', false], ['status', false], ['eligibility', false]]);
  });

  await test('background refresh flags do not disable a ready T/F button', () => {
    const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props: props ?? {} };
    const read = loader({
      'expo-router': { useIsFocused: () => true },
      react: { useEffect: (fn) => fn(), useRef: (current) => ({ current }), useState: (value) => [value, () => {}] },
      'react/jsx-runtime': { jsx, jsxs: jsx },
      'react-native': { View: 'view', Text: 'text', Pressable: 'button', ActivityIndicator: 'loading', StyleSheet: { create: (x) => x } },
      '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: 'p' }, isLoading: false }) },
      '@/hooks/useProfileAiReview': {
        useProfileAiReview: () => ({ data: null, isPending: false, isError: false, isFetching: false }),
        useGenerateProfileAiReview: () => ({ isPending: false }),
        useSetProfileAiReviewVisibility: () => ({ isPending: false }),
      },
      '@/hooks/useProfileAiEligibility': { useProfileAiEligibility: () => ({
        data: 10, isPending: false, isError: false, isFetching: true,
        refetch: async () => ({ data: 10, isError: false }),
      }) },
      '@/hooks/useProfileAiStatus': { useProfileAiStatus: () => ({
        data: { configured: true, compatible: true }, isPending: false, isError: false, isFetching: true,
        refetch: async () => ({ data: { configured: true, compatible: true }, isError: false }),
      }) },
    });
    const tree = read(path.join(root, 'components/profile-ai-review-card.tsx')).ProfileAiReviewCard({ profileUserId: 'p', pickCount: 10, isMine: true });
    const buttons = [];
    const visit = (node) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== 'object') return;
      if (node.type === 'button') buttons.push(node);
      visit(node.props?.children);
    };
    visit(tree);
    for (const tone of ['direct', 'warm']) {
      const button = buttons.find((b) => b.props.testID === 'ai-tone-' + tone);
      assert.ok(button); assert.equal(button.props.disabled, false);
    }
  });

  await test('native app background updates TanStack focus and cleans up', () => {
    const focus = [], listeners = []; let removed = 0, cleanup;
    const read = loader({
      '@tanstack/react-query': {
        focusManager: { setFocused: (value) => focus.push(value) },
        QueryClientProvider: ({ children }) => children,
      },
      react: { useEffect: (fn) => { cleanup = fn(); } },
      'react/jsx-runtime': { jsx: (type, props) => typeof type === 'function' ? type(props) : { type, props }, jsxs: (type, props) => ({ type, props }) },
      'react-native': {
        Platform: { OS: 'ios' },
        AppState: { currentState: 'active', addEventListener: (_name, fn) => {
          listeners.push(fn); return { remove() { removed++; } };
        } },
      },
      './queryClient': { queryClient: {} },
    });
    read(path.join(root, 'lib/query/appQueryProvider.tsx')).AppQueryProvider({ children: 'child' });
    assert.deepEqual(focus, [true]); assert.equal(listeners.length, 1);
    listeners[0]('background'); listeners[0]('active');
    assert.deepEqual(focus, [true, false, true]);
    cleanup(); assert.equal(removed, 1); assert.equal(focus.at(-1), undefined);
  });

  console.log(passed + ' AI profile performance safeguards passed. No network or database calls.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
