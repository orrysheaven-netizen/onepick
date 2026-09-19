// Run real eligibility service, hook and card modules with transport/UI doubles.
// No provider requests, user credentials or remote database writes.
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
      let target = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      if (!existsSync(target)) target += '.ts';
      return load(target);
    };
    new Function('module', 'exports', 'require', code)(local, local.exports, resolve);
    return local.exports;
  }
  return load;
}
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const rows = (n) => Array.from({ length: n }, (_, i) => ({
  id: String(i).padStart(3, '0'), user_id: A, status: 'active', one_line_review: '구체적인 선택 이유',
  categories: { name: `분야 ${i}`, is_visible: true, status: 'open' },
  items: { name: `항목 ${i}`, status: 'active' },
}));
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeClient(source = [], options = {}) {
  const queries = [];
  const client = { from(table) {
    const q = { table, filters: [], columns: '', limit: null, order: null, signal: null }; queries.push(q);
    const execute = async () => {
      if (options.hangTable === table) return new Promise(() => {});
      if (q.signal?.aborted) return { data: null, error: { code: 'CANCELLED' } };
      if (options.errorTable === table) return { data: null, error: { code: '42501' } };
      if (table === 'profiles') return { data: options.missingProfile ? null : { id: A }, error: null };
      assert.equal(table, 'picks');
      // Stand-in for the existing public RLS and inner joins. This does NOT
      // purport to test PostgreSQL itself; it exercises the emitted query.
      let data = source.filter((r) => r.categories && r.items &&
        r.categories.is_visible && ['open', 'paused', 'closed'].includes(r.categories.status) &&
        ['active', 'discontinued'].includes(r.items.status));
      for (const [op, key, expected] of q.filters) {
        data = data.filter((r) => {
          const value = key.split('.').reduce((x, k) => x?.[k], r);
          return op === 'eq' ? value === expected : expected.includes(value);
        });
      }
      data = [...data].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, q.limit);
      return { data: options.badRows ? null : data, error: null };
    };
    const query = {
      select(value) { q.columns = value; return query; },
      eq(key, value) { q.filters.push(['eq', key, value]); return query; },
      in(key, value) { q.filters.push(['in', key, value]); return query; },
      order(key, value) { q.order = [key, value]; return query; },
      limit(n) { q.limit = n; return query; },
      abortSignal(signal) { q.signal = signal; return query; },
      maybeSingle: execute,
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    return query;
  } };
  const read = loader({
    '@/lib/supabase/client': { publicCountClient: client },
    '@/errors/mapSupabaseError': { mapSupabaseError: (error) => Object.assign(new Error('Database read failed'), { code: error.code }) },
  });
  const service = read(path.join(root, 'services/profileAiEligibilityService.ts'));
  return { client, queries, service };
}

function card({ listCount = 10, eligibleCount = 10, nextCount = eligibleCount,
  error = false, pending = false, nextError = false, visible = false, isMine = true, configured = true } = {}) {
  const calls = [], messages = [], enabled = [];
  let recounts = 0;
  const review = visible ? { id: '44444444-4444-4444-8444-444444444444', profileId: A,
    summary: '선택의 공통점', body: '선택 이유를 함께 읽었어요.', keywords: ['선택', '기록', '취향'],
    actor: { displayName: 'OnePick AI' }, generatedAt: '2026-09-19T05:00:00.123456+00:00', isVisible: true, isStale: false } : null;
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props: props ?? {} };
  const read = loader({
    react: { useEffect: (fn) => fn(), useRef: (current) => ({ current }), useState: (value) => [value, (next) => messages.push(next)] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'view', Text: 'text', Pressable: 'button', ActivityIndicator: 'loading', StyleSheet: { create: (x) => x } },
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: isMine ? A : B }, isLoading: false, error: null }) },
    '@/hooks/useProfileAiReview': {
      useProfileAiReview: () => ({ data: review, isPending: false, isError: false }),
      useGenerateProfileAiReview: () => ({ isPending: false, mutateAsync: async (count) => { calls.push(['generate', count]); return { isVisible: false }; } }),
      useSetProfileAiReviewVisibility: () => ({ isPending: false, mutateAsync: async (change) => { calls.push(['visibility', change]); return { isVisible: change.isVisible }; } }),
    },
    '@/hooks/useProfileAiEligibility': { useProfileAiEligibility: (id, active, hint) => {
      enabled.push([id, active, hint]);
      return { data: eligibleCount, isError: error, isPending: pending, isFetching: false,
        refetch: async () => { recounts++; return { data: nextCount, isError: nextError }; } };
    } },
    '@/hooks/useProfileAiStatus': { useProfileAiStatus: () => ({ data: { configured }, isError: false,
      isPending: false, isFetching: false, refetch: async () => ({ data: { configured }, isError: false }) }) },
  });
  const tree = read(path.join(root, 'components/profile-ai-review-card.tsx')).ProfileAiReviewCard({ profileUserId: A, pickCount: listCount, isMine });
  const text = (node) => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node)
    : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
  const buttons = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'button') buttons.push(node);
    visit(node.props?.children);
  };
  visit(tree);
  return { text: text(tree), buttons, button: (label) => buttons.find((b) => text(b) === label), calls, messages, enabled, recounts: () => recounts };
}

let passed = 0;
async function test(name, action) { await action(); passed++; console.log(`PASS ${name}`); }
const originalFetch = global.fetch;
global.fetch = async () => { throw new Error('Network forbidden in eligibility tests'); };
(async () => {
  await test('public service emits the Edge visibility filters, ordering and bound', async () => {
    const f = fakeClient(rows(10)); assert.equal(await f.service.profileAiEligibilityService.get(A), 10);
    assert.equal(f.queries.length, 2);
    assert.deepEqual(f.queries[1].filters, [['eq', 'user_id', A], ['eq', 'status', 'active'],
      ['eq', 'categories.is_visible', true], ['in', 'items.status', ['active', 'discontinued']]]);
    assert.deepEqual(f.queries[1].order, ['id', { ascending: true }]);
    assert.equal(f.queries[1].limit, 50);
    assert.ok(f.queries[1].columns.includes('categories!picks_category_id_fkey!inner(name)'));
    assert.ok(f.queries[1].columns.includes('items!picks_item_category_fk!inner(name)'));
  });
  await test('nine public picks do not become ten from a private category', async () => {
    const data = rows(10); data[9].categories.is_visible = false;
    const f = fakeClient(data); assert.equal(await f.service.profileAiEligibilityService.get(A), 9);
  });
  for (const state of ['pending', 'hidden', 'rejected', 'merged']) {
    await test(`owner-readable ${state} item is excluded`, async () => {
      const data = rows(10); data[9].items.status = state;
      const f = fakeClient(data); assert.equal(await f.service.profileAiEligibilityService.get(A), 9);
    });
  }
  for (const state of ['needs_review', 'removed', 'hidden', 'replaced']) {
    await test(`${state} pick is not a current public source`, async () => {
      const data = rows(10); data[9].status = state;
      const f = fakeClient(data); assert.equal(await f.service.profileAiEligibilityService.get(A), 9);
    });
  }
  await test('paused/closed public categories and discontinued items match server reads', async () => {
    const data = rows(10); data[8].categories.status = 'paused'; data[9].categories.status = 'closed'; data[9].items.status = 'discontinued';
    const f = fakeClient(data); assert.equal(await f.service.profileAiEligibilityService.get(A), 10);
  });
  for (const alter of [(r) => { r.items = null; }, (r) => { r.categories = null; },
    (r) => { r.categories.status = 'draft'; }, (r) => { r.user_id = B; },
    (r) => { r.one_line_review = '  '; }, (r) => { r.items.name = '  '; }, (r) => { r.categories.name = ''; }]) {
    await test('unreadable or unusable tenth source stays below minimum', async () => {
      const data = rows(10); alter(data[9]); const f = fakeClient(data);
      assert.equal(await f.service.profileAiEligibilityService.get(A), 9);
    });
  }
  await test('array relationships use the same first-element rule as Edge snapshots', () => {
    const data = rows(1); data[0].items = [data[0].items]; data[0].categories = [data[0].categories];
    assert.equal(fakeClient().service.countProfileAiSourceRows(data), 1);
  });
  await test('missing public profile returns zero without reading its picks', async () => {
    const f = fakeClient(rows(10), { missingProfile: true });
    assert.equal(await f.service.profileAiEligibilityService.get(A), 0); assert.equal(f.queries.length, 1);
  });
  for (const errorTable of ['profiles', 'picks']) {
    await test(`${errorTable} failure is not turned into a successful count`, async () => {
      const f = fakeClient(rows(10), { errorTable });
      await assert.rejects(f.service.profileAiEligibilityService.get(A));
    });
  }
  await test('malformed rows fail closed', async () => {
    const f = fakeClient(rows(10), { badRows: true });
    await assert.rejects(f.service.profileAiEligibilityService.get(A));
    for (const value of [null, {}, rows(51)]) assert.throws(() => f.service.countProfileAiSourceRows(value));
  });
  await test('50-source cap follows the server and does not mutate row order', async () => {
    const data = rows(51).reverse(); const first = data[0].id;
    const f = fakeClient(data); assert.equal(await f.service.profileAiEligibilityService.get(A), 50); assert.equal(data[0].id, first);
  });
  await test('cancellation signal reaches both public reads; pre-cancelled reads do not start', async () => {
    const f = fakeClient(rows(10)), controller = new AbortController();
    await f.service.profileAiEligibilityService.get(A, controller.signal);
    assert.ok(f.queries.every((q) => q.signal === f.queries[0].signal && !q.signal.aborted));
    controller.abort(); const g = fakeClient(rows(10));
    await assert.rejects(g.service.profileAiEligibilityService.get(A, controller.signal)); assert.equal(g.queries.length, 0);
  });
  await test('a stalled eligibility read times out and aborts its transport', async () => {
    const f = fakeClient(rows(10), { hangTable: 'picks' });
    await assert.rejects(f.service.readProfileAiEligibleCount(f.client, A, undefined, 15), (e) => e.code === 'NETWORK_ERROR');
    assert.ok(f.queries.every((q) => q.signal.aborted));
  });
  await test('account/screen cancellation interrupts a stalled public read', async () => {
    const f = fakeClient(rows(10), { hangTable: 'profiles' }), controller = new AbortController();
    const pending = f.service.profileAiEligibilityService.get(A, controller.signal);
    controller.abort();
    await assert.rejects(pending, (e) => e.code === 'NETWORK_ERROR');
    assert.equal(f.queries.length, 1); assert.equal(f.queries[0].signal.aborted, true);
  });
  await test('screen shows nine eligible picks even when owner list contains ten', () => {
    const view = card({ listCount: 10, eligibleCount: 9 });
    assert.ok(view.text.includes('분석 가능한 공개 원픽 9/10개'));
    assert.equal(view.button('원픽 10개부터 요청 가능').props.disabled, true);
    assert.equal(view.calls.length, 0);
  });
  await test('a refreshed eligible count, not an old owner count, controls the button', async () => {
    const view = card({ listCount: 9, eligibleCount: 10 });
    view.button('AI에게 내 취향 보여주기').props.onPress(); await tick();
    assert.deepEqual(view.calls, [['generate', 10]]);
  });
  await test('fresh recount below ten prevents a POST even after an enabled click', async () => {
    const view = card({ nextCount: 9 }); view.button('AI에게 내 취향 보여주기').props.onPress(); await tick();
    assert.equal(view.calls.length, 0); assert.equal(view.recounts(), 1);
    assert.ok(view.messages.some((m) => typeof m === 'string' && m.includes('1개 더 등록')));
  });
  await test('recount error does not reuse an earlier successful ten', async () => {
    const view = card({ nextError: true }); view.button('AI에게 내 취향 보여주기').props.onPress(); await tick();
    assert.equal(view.calls.length, 0);
  });
  for (const nextCount of [NaN, -1, undefined, '10']) {
    await test('invalid preflight result does not reach generation', async () => {
      const view = card({ nextCount: nextCount === undefined ? null : nextCount });
      view.button('AI에게 내 취향 보여주기').props.onPress(); await tick(); assert.equal(view.calls.length, 0);
    });
  }
  await test('query error exposes retry, not a misleading zero or condition met', () => {
    const view = card({ error: true });
    assert.ok(view.button('원픽 수 다시 확인'));
    assert.equal(view.button('원픽 수 확인 필요').props.disabled, true);
    assert.ok(!view.text.includes('등록 조건을 충족'));
  });
  await test('initial query pending never enables generation', () => {
    const view = card({ pending: true }); assert.equal(view.button('원픽 수 확인 중…').props.disabled, true);
  });
  await test('failed count and missing AI settings do not prevent hiding an existing result', async () => {
    const view = card({ error: true, visible: true, configured: false });
    const hide = view.button('프로필에서 숨기기'); assert.equal(hide.props.disabled, false);
    hide.props.onPress(); await tick(); assert.deepEqual(view.calls, [['visibility', { isVisible: false }]]);
    assert.equal(view.recounts(), 0);
  });
  await test('visitor does not enable the owner eligibility query or registration CTA', () => {
    const view = card({ visible: true, isMine: false });
    assert.equal(view.enabled[0][1], false); assert.ok(!view.text.includes('분석 가능한 공개 원픽'));
  });
  await test('actual hook passes AbortSignal and uses list count only as an invalidation hint', async () => {
    let options; const reads = [];
    const read = loader({ '@tanstack/react-query': { useQuery: (x) => { options = x; return x; } },
      '@/services/profileAiEligibilityService': { profileAiEligibilityService: { get: async (...args) => { reads.push(args); return 9; } } } });
    const hook = read(path.join(root, 'hooks/useProfileAiEligibility.ts')).useProfileAiEligibility;
    hook(A, true, 999);
    const signal = new AbortController().signal;
    assert.equal(await options.queryFn({ signal }), 9); assert.deepEqual(reads, [[A, signal]]);
    assert.equal(options.retry, false); assert.equal(options.refetchIntervalInBackground, false);
    hook(A, false, 10); assert.equal(options.enabled, false);
  });
  await test('generation hook forwards the count just confirmed by the public preflight', async () => {
    let options; const calls = [];
    const read = loader({ '@tanstack/react-query': { useMutation: (x) => { options = x; return x; }, useQueryClient: () => ({}) },
      '@/lib/query/queryKeys': { queryKeys: {} },
      '@/services': { profileAiReviewService: { generate: async (...args) => calls.push(args) } } });
    read(path.join(root, 'hooks/useProfileAiReview.ts')).useGenerateProfileAiReview(A, A);
    await options.mutationFn(11); assert.deepEqual(calls, [[A, 11]]);
  });
  console.log(`${passed} public AI eligibility/service/card/hook checks passed; all transports mocked.`);
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { global.fetch = originalFetch; });
