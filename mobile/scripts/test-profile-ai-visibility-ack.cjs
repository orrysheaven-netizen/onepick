// Actual repository/receipt/hook/component modules; synthetic transports, no network.
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
      let fileName = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      if (!existsSync(fileName)) fileName += '.ts';
      return load(fileName);
    };
    new Function('module', 'exports', 'require', code)(local, local.exports, resolve);
    return local.exports;
  }
  return load;
}
const load = loader({
  '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
  '@/lib/profileAiReviewResponse': { parseProfileAiReview() { throw new Error('Full comment parsing must not run during a visibility write'); } },
});
const { AppError } = load(path.join(root, 'errors/appError.ts'));
const { ProfileAiVisibilityUnconfirmedError, parseProfileAiVisibilityReceipt, profileAiVisibilityErrorMessage } = load(path.join(root, 'lib/profileAiVisibility.ts'));
const { SupabaseProfileAiReviewRepository: Repository } = load(path.join(root, 'repositories/supabase/supabaseProfileAiReviewRepository.ts'));
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ID = '44444444-4444-4444-8444-444444444444';
const stamp = '2026-09-19T00:00:00.123456+00:00';
const seen = { id: ID, generatedAt: stamp };
const row = () => ({ id: ID, profile_id: A, generated_at: stamp, updated_at: stamp, is_visible: false, is_stale: false });
const isCode = (code) => (error) => error instanceof AppError && error.code === code;
function transport() {
  const f = { row: row(), requests: [], writes: 0, userId: A, listeners: new Set(), authReads: 0 };
  const session = () => ({ access_token: 'synthetic-only', user: { id: f.userId } });
  const client = {
    auth: {
      onAuthStateChange(fn) { f.listeners.add(fn); return { data: { subscription: { unsubscribe() { f.listeners.delete(fn); } } } }; },
      async getSession() { f.authReads++; return { data: { session: session() }, error: null }; },
      async getUser() { return { data: { user: { id: f.userId } }, error: null }; },
    },
    from(table) {
      assert.equal(table, 'profile_ai_reviews', 'Visibility must not load system_actors');
      const request = { table, filters: [] }; f.requests.push(request);
      const builder = {
        update(value) { request.value = value; return builder; },
        eq(key, value) { request.filters.push([key, value]); return builder; },
        select(columns) { request.columns = columns; return builder; },
        // Promise-like only, matching PostgREST; deliberately no .catch method.
        maybeSingle() { return { then(resolve, reject) { return (async () => {
          if (f.beforeWrite) await f.beforeWrite();
          if (f.error) return { data: null, error: f.error };
          if (!f.row || !request.filters.every(([key, value]) => f.row[key] === value)) return { data: null, error: null };
          f.writes++; f.row = { ...f.row, ...request.value };
          if (f.afterWrite) await f.afterWrite();
          const data = Object.fromEntries(request.columns.split(',').map((key) => [key, f.row[key]]));
          return { data: f.malformed ? f.malformed(data) : data, error: null };
        })().then(resolve, reject); } }; },
      };
      return builder;
    },
  };
  f.repo = new Repository(client);
  return f;
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
const tick = () => new Promise((resolve) => setImmediate(resolve));
function screen({ writeError = false, refreshError = false } = {}) {
  let cursor = 0, writes = 0, reads = 0;
  const states = [], refs = [], effects = [];
  const review = { id: ID, profileId: A, generatedAt: stamp, updatedAt: stamp,
    isVisible: false, isStale: false, summary: '선택의 공통점', body: '직접 적은 이유가 연결되어 있어요.',
    keywords: ['선택', '기록', '취향'], actor: { displayName: 'OnePick AI' } };
  const query = { data: review, isPending: false, isError: false, isFetching: false,
    refetch: async () => { reads++; return { isError: query.isError, data: query.data }; } };
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props: props ?? {} };
  const read = loader({
    react: {
      useState(value) { const i = cursor++; if (!(i in states)) states[i] = value; return [states[i], (next) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
      useRef(current) { const i = cursor++; return refs[i] ?? (refs[i] = { current }); },
      useEffect(fn) { const i = cursor++; if (!effects[i]) effects[i] = fn() || true; },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'view', Text: 'text', Pressable: 'button', ActivityIndicator: 'loading', StyleSheet: { create: (v) => v } },
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: A }, isLoading: false }) },
    '@/hooks/useProfileAiEligibility': { useProfileAiEligibility: () => ({ data: 10, isError: false, isPending: false, isFetching: false }) },
    '@/hooks/useProfileAiStatus': { useProfileAiStatus: () => ({ data: { configured: false }, isError: false, isPending: false }) },
    '@/lib/profileAiStatus': { canRequestProfileAiGeneration: () => false },
    '@/lib/profileAiCopy': { PROFILE_AI_PICK_GUIDANCE: '원픽이 많고 한줄평이 구체적일수록 취향의 공통점을 더 잘 발견할 수 있어요.' },
    '@/services/profileAiReviewService': { MIN_PROFILE_AI_PICKS: 10 },
    '@/hooks/useProfileAiReview': {
      useProfileAiReview: () => query,
      useGenerateProfileAiReview: () => ({ isPending: false, mutateAsync: () => { assert.fail('No AI call'); } }),
      useSetProfileAiReviewVisibility: () => ({ isPending: false, mutateAsync: async (change) => {
        writes++;
        const saved = { ...review, isVisible: change.isVisible };
        if (refreshError) query.isError = true;
        if (writeError) throw new Error('simulated-lost-response');
        return saved;
      } }),
    },
  });
  const { ProfileAiReviewCard } = read(path.join(root, 'components/profile-ai-review-card.tsx'));
  function render() {
    cursor = 0;
    const tree = ProfileAiReviewCard({ profileUserId: A, pickCount: 10, isMine: true });
    const buttons = [];
    const text = (node) => {
      if (typeof node === 'string') return node;
      if (Array.isArray(node)) return node.map(text).join(' ');
      return node && typeof node === 'object' ? text(node.props.children) : '';
    };
    const visit = (node) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== 'object') return;
      if (node.type === 'button') buttons.push(node);
      visit(node.props.children);
    };
    visit(tree);
    return { text: text(tree), button: (label) => buttons.find((b) => text(b) === label) };
  }
  return { render, query, writes: () => writes, reads: () => reads };
}
(async () => {
  for (const visible of [true, false]) await test(`committed ${visible ? 'publish' : 'hide'} has no author or body dependency`, async () => {
    const f = transport(); const receipt = await f.repo.setVisibility(A, visible, seen);
    assert.equal(receipt.isVisible, visible); assert.equal(f.row.is_visible, visible);
    assert.equal(f.requests.length, 1); assert.equal(f.writes, 1); assert.equal(f.listeners.size, 0);
    assert.equal(f.requests[0].columns, 'id,profile_id,is_visible,is_stale,generated_at,updated_at');
    assert.equal(receipt.actor, undefined); assert.equal(receipt.body, undefined);
  });
  await test('lost response after commit is uncertain, never retried', async () => {
    const f = transport(); f.afterWrite = () => { throw new Error('response lost'); };
    await assert.rejects(f.repo.setVisibility(A, true, seen), ProfileAiVisibilityUnconfirmedError);
    assert.equal(f.row.is_visible, true); assert.equal(f.writes, 1); assert.equal(f.listeners.size, 0);
  });
  await test('transport failure before commit is also uncertain', async () => {
    const f = transport(); f.beforeWrite = () => { throw new Error('offline'); };
    await assert.rejects(f.repo.setVisibility(A, true, seen), ProfileAiVisibilityUnconfirmedError);
    assert.equal(f.row.is_visible, false); assert.equal(f.writes, 0);
  });
  await test('gateway/unknown failure does not assert rollback', async () => {
    const f = transport(); f.error = { code: '', message: 'Bad gateway' };
    await assert.rejects(f.repo.setVisibility(A, true, seen), ProfileAiVisibilityUnconfirmedError);
  });
  await test('known permission rejection remains distinct', async () => {
    const f = transport(); f.error = { code: '42501', message: 'permission denied' };
    await assert.rejects(f.repo.setVisibility(A, true, seen), isCode('FORBIDDEN'));
    assert.equal(f.writes, 0);
  });
  await test('version conflict stays non-writing and never falls back to a latest version', async () => {
    const f = transport(); f.row.generated_at = '2026-09-19T01:00:00.000001+00:00';
    await assert.rejects(f.repo.setVisibility(A, true, seen), isCode('AI_REVIEW_STALE'));
    assert.equal(f.writes, 0); assert.equal(f.requests.length, 1);
  });
  await test('old screen can hide a newer result', async () => {
    const f = transport(); f.row.generated_at = '2026-09-19T01:00:00.000001+00:00'; f.row.is_visible = true;
    assert.equal((await f.repo.setVisibility(A, false, seen)).isVisible, false);
  });
  await test('account switch after commit is not returned as success for the new account', async () => {
    const f = transport(); f.afterWrite = () => { f.userId = B; for (const fn of f.listeners) fn('SIGNED_IN', { user: { id: B } }); };
    await assert.rejects(f.repo.setVisibility(A, true, seen), isCode('AUTH_REQUIRED'));
    assert.equal(f.row.is_visible, true); assert.equal(f.listeners.size, 0);
    assert.doesNotMatch(profileAiVisibilityErrorMessage(new AppError('AUTH_REQUIRED')), /저장되지|실패|바꾸지 못/);
  });
  for (const [name, alter] of [
    ['wrong account', (r) => ({ ...r, profile_id: B })],
    ['missing flag', (r) => ({ ...r, is_visible: undefined })],
    ['wrong flag', (r) => ({ ...r, is_visible: false })],
    ['invalid date', (r) => ({ ...r, generated_at: 'yesterday' })],
    ['public stale', (r) => ({ ...r, is_stale: true })],
  ]) await test('malformed receipt: ' + name, async () => {
    const f = transport(); f.malformed = alter;
    await assert.rejects(f.repo.setVisibility(A, true, seen), ProfileAiVisibilityUnconfirmedError);
    assert.equal(f.writes, 1);
  });
  await test('receipt preserves microseconds and drops extra private/display fields', () => {
    const receipt = parseProfileAiVisibilityReceipt({ ...row(), unexpected: 'private', body: 'not needed' }, A, false);
    assert.equal(receipt.generatedAt, stamp); assert.equal(receipt.unexpected, undefined); assert.equal(receipt.body, undefined);
  });
  for (const fail of ['reject', 'throw']) await test('display refresh ' + fail + ' cannot reject a write receipt', async () => {
    let mutation; let invalidated = 0;
    const read = loader({
      '@tanstack/react-query': { useQuery() {}, useMutation: (o) => (mutation = o),
        useQueryClient: () => ({ setQueryData() { assert.fail('Receipt is not a full comment'); },
          invalidateQueries() { invalidated++; if (fail === 'throw') throw new Error('read failed'); return Promise.reject(new Error('read failed')); } }) },
      '@/services': { profileAiReviewService: { setVisibility: async () => ({ isVisible: true }) } },
      '@/lib/query/queryKeys': { queryKeys: {} },
    });
    read(path.join(root, 'hooks/useProfileAiReview.ts')).useSetProfileAiReviewVisibility(A, A);
    assert.equal(mutation.retry, false);
    assert.deepEqual(await mutation.mutationFn({ isVisible: true, expectedReview: seen }), { isVisible: true });
    await mutation.onSettled(); await tick(); assert.equal(invalidated, 1);
  });
  await test('success message remains visible if subsequent comment display loading fails', async () => {
    const view = screen({ refreshError: true }); view.render().button('프로필에 공개하기').props.onPress(); await tick();
    const rendered = view.render();
    assert.ok(rendered.text.includes('AI 취향평가를 공개했어요.'));
    assert.ok(rendered.text.includes('AI 취향평가를 불러오지 못했어요.'));
    assert.ok(!rendered.text.includes('공개 설정을 바꾸지 못했어요.')); assert.equal(view.writes(), 1);
  });
  await test('uncertain response offers read-only recovery and never publishes automatically', async () => {
    const view = screen({ writeError: true }); view.render().button('프로필에 공개하기').props.onPress(); await tick();
    let rendered = view.render(); assert.match(rendered.text, /이미 반영됐을 수/);
    assert.equal(rendered.button('프로필에 공개하기').props.disabled, true);
    view.query.data = { ...view.query.data, isVisible: true };
    rendered.button('현재 공개 상태 확인').props.onPress(); await tick();
    rendered = view.render(); assert.match(rendered.text, /현재 AI 댓글은 공개된 상태/);
    assert.equal(view.writes(), 1); assert.equal(view.reads(), 1);
  });
  await test('failed state reread keeps uncertainty rather than inventing a private state', async () => {
    const view = screen({ writeError: true, refreshError: true }); view.render().button('프로필에 공개하기').props.onPress(); await tick();
    view.render().button('현재 공개 상태 확인').props.onPress(); await tick();
    assert.match(view.render().text, /저장되지 않았다고 단정할 수 없/); assert.equal(view.writes(), 1);
  });
  console.log(`${passed} visibility acknowledgment and recovery scenarios passed; no database or provider calls.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
