// Module-level component/hook tests with doubles, not a browser or model test.
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
    const requireLocal = (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      let target = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      if (!existsSync(target)) target += '.ts';
      return load(target);
    };
    new Function('module', 'exports', 'require', code)(local, local.exports, requireLocal);
    return local.exports;
  }
  return load;
}
const A = '11111111-1111-4111-8111-111111111111';
const ID = '44444444-4444-4444-8444-444444444444';
const stamp = '2026-09-19T05:00:00.123456+00:00';
const tick = () => new Promise((resolve) => setImmediate(resolve));
function card({ visible = false, stale = false, count = 10, configured = true, conflict = false } = {}) {
  const calls = [], messages = [];
  let generated = 0, statusReads = 0;
  const review = { id: ID, profileId: A, summary: '선택의 공통점', body: '선택 이유를 함께 읽었어요.',
    keywords: ['선택', '기록', '취향'], actor: { displayName: 'OnePick AI' },
    generatedAt: stamp, isVisible: visible, isStale: stale };
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props: props ?? {} };
  const read = loader({
    react: { useEffect: (fn) => { fn(); }, useRef: (current) => ({ current }), useState: (value) => [value, (next) => messages.push(next)] },
    'expo-router': { useIsFocused: () => true },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'view', Text: 'text', Pressable: 'button', ActivityIndicator: 'loading', StyleSheet: { create: (x) => x } },
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: A }, isLoading: false, error: null }) },
    '@/hooks/useProfileAiReview': {
      useProfileAiReview: () => ({ data: review, isPending: false, isError: false }),
      useGenerateProfileAiReview: () => ({ isPending: false, mutateAsync: async () => { generated++; return review; } }),
      useSetProfileAiReviewVisibility: () => ({ isPending: false, mutateAsync: async (change) => {
        calls.push(change);
        if (conflict) { const { AppError } = read(path.join(root, 'errors/appError.ts')); throw new AppError('AI_REVIEW_STALE'); }
        return { ...review, isVisible: change.isVisible };
      } }),
    },
    '@/hooks/useProfileAiEligibility': { useProfileAiEligibility: () => ({ data: count, isError: false,
      isPending: false, isFetching: false, refetch: async () => ({ data: count, isError: false }) }) },
    '@/hooks/useProfileAiStatus': { useProfileAiStatus: () => ({ data: { configured }, isError: false,
      isPending: false, isFetching: false, refetch: async () => { statusReads++; return { data: { configured }, isError: false }; } }) },
  });
  const { ProfileAiReviewCard } = read(path.join(root, 'components/profile-ai-review-card.tsx'));
  const tree = ProfileAiReviewCard({ profileUserId: A, pickCount: count, isMine: true });
  const buttons = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'button') buttons.push(node);
    visit(node.props.children);
  }
  visit(tree);
  return { action: buttons.at(-1), calls, messages, review, generationCount: () => generated, statusCount: () => statusReads };
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
(async () => {
  await test('publish click carries the displayed id and exact microsecond timestamp', async () => {
    const view = card(); view.action.props.onPress();
    view.review.generatedAt = '2026-09-19T06:00:00.000000+00:00';
    await tick();
    assert.deepEqual(view.calls, [{ isVisible: true, expectedReview: { id: ID, generatedAt: stamp } }]);
    assert.equal(view.generationCount(), 0); assert.equal(view.statusCount(), 0);
  });
  await test('hide remains available below ten and while AI configuration is missing', async () => {
    const view = card({ visible: true, count: 0, configured: false });
    assert.equal(view.action.props.disabled, false);
    view.action.props.onPress(); await tick();
    assert.deepEqual(view.calls, [{ isVisible: false }]);
    assert.equal(view.statusCount(), 0); assert.equal(view.generationCount(), 0);
  });
  await test('stale private card cannot publish even by invoking its handler', async () => {
    const view = card({ stale: true });
    assert.equal(view.action.props.disabled, true); view.action.props.onPress(); await tick();
    assert.equal(view.calls.length, 0);
  });
  await test('version conflict asks for a fresh review and never retries publication', async () => {
    const view = card({ conflict: true }); view.action.props.onPress(); await tick();
    assert.equal(view.calls.length, 1);
    assert.ok(view.messages.includes('원픽이나 AI 댓글이 바뀌었어요. 최신 내용을 확인한 뒤 공개해주세요.'));
  });
  await test('actual visibility hook forwards captured variables and refreshes without retrying', async () => {
    let options; const writes = [], invalidations = [];
    const read = loader({
      '@tanstack/react-query': {
        useQuery: () => ({}), useMutation: (value) => { options = value; return value; },
        useQueryClient: () => ({ setQueryData() {}, invalidateQueries: async (value) => { invalidations.push(value); } }),
      },
      '@/lib/query/queryKeys': { queryKeys: { profiles: { aiReview: (...args) => ['profiles', 'ai-review', ...args] } } },
      '@/services': { profileAiReviewService: { setVisibility: async (...args) => { writes.push(args); return {}; } } },
    });
    read(path.join(root, 'hooks/useProfileAiReview.ts')).useSetProfileAiReviewVisibility(A, A);
    const expectedReview = { id: ID, generatedAt: stamp };
    await options.mutationFn({ isVisible: true, expectedReview });
    await options.onSettled();
    assert.equal(options.retry, false);
    assert.deepEqual(writes, [[A, true, expectedReview]]);
    assert.deepEqual(invalidations, [{ queryKey: ['profiles', 'ai-review', A] }]);
  });
  console.log(`${passed} publication component/hook tests passed with mocked transports.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
