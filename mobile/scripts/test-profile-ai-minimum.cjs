// Actual client and Edge handler with mocked transports. No credentials or writes.
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const serverPath = path.resolve(root, '../supabase/functions/analyze-profile-taste/index.ts');
const contractPath = path.resolve(root, '../supabase/functions/analyze-profile-taste/contract.ts');
const A = '11111111-1111-4111-8111-111111111111';
const originalFetch = global.fetch;
global.fetch = async () => { throw new Error('External network forbidden'); };
function loader(overrides = {}, context = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const local = { exports: {} }; cache.set(file, local);
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const resolve = (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      let target;
      if (name.startsWith('@/')) target = path.join(root, 'src', name.slice(2));
      else if (name.startsWith('.')) target = path.resolve(path.dirname(file), name);
      else throw new Error(`Unexpected import: ${name}`);
      if (!existsSync(target)) target += '.ts';
      return load(target);
    };
    new Function('module', 'exports', 'require', 'Deno', 'fetch', 'crypto', compiled)(
      local, local.exports, resolve, context.Deno, context.fetch ?? global.fetch, webcrypto);
    return local.exports;
  }
  return load;
}
const load = loader();
const { ProfileAiReviewService, MIN_PROFILE_AI_PICKS } = load(path.join(root, 'src/services/profileAiReviewService.ts'));
const { canRequestProfileAiGeneration } = load(path.join(root, 'src/lib/profileAiStatus.ts'));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
const tick = () => new Promise((resolve) => setImmediate(resolve));
function card(count, existing = false, configured = true) {
  let generated = 0;
  const review = { summary: '선택의 공통점', body: '선택한 이유를 함께 읽었어요.', keywords: ['선택', '기록', '취향'],
    tone: 'direct', actor: { displayName: 'OnePick AI' }, generatedAt: '2026-09-19T00:00:00Z', isVisible: true, isStale: false };
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props: props ?? {} };
  const read = loader({
    react: { useEffect: (fn) => { fn(); }, useRef: (current) => ({ current }), useState: (value) => [value, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'view', Text: 'text', Pressable: 'button', ActivityIndicator: 'loading', StyleSheet: { create: (value) => value } },
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: A }, isLoading: false, error: null }) },
    '@/hooks/useProfileAiReview': {
      useProfileAiReview: () => ({ data: existing ? review : null, isPending: false, isError: false }),
      useGenerateProfileAiReview: () => ({ isPending: false, mutateAsync: async (request) => {
        assert.deepEqual(request, { count, tone: 'direct' }); generated++; return review;
      } }),
      useSetProfileAiReviewVisibility: () => ({ isPending: false, mutateAsync: async () => review }),
    },
    '@/hooks/useProfileAiEligibility': { useProfileAiEligibility: () => ({ data: count, isError: false,
      isPending: false, isFetching: false, refetch: async () => ({ data: count, isError: false }) }) },
    '@/hooks/useProfileAiStatus': { useProfileAiStatus: () => ({ data: { configured, compatible: true }, isError: false,
      isPending: false, isFetching: false, refetch: async () => ({ data: { configured, compatible: true }, isError: false }) }) },
  });
  const tree = read(path.join(root, 'src/components/profile-ai-review-card.tsx')).ProfileAiReviewCard({ profileUserId: A, pickCount: count, isMine: true });
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
  return { text: text(tree), buttons, textOf: text, generated: () => generated };
}
function server(rows) {
  const state = { reserved: 0, modelCalls: 0, saved: 0, cachedReads: 0, filters: [] };
  const env = { SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'synthetic-public',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-server', OPENAI_API_KEY: 'synthetic-not-a-key' };
  let handler;
  function createClient(_url, key) {
    return {
      auth: { getUser: async () => ({ data: { user: { id: A, is_anonymous: false } }, error: null }) },
      from(table) {
        const filters = []; let selection = '';
        const query = {
          select(value) { selection = value; return query; }, eq(name, value) { filters.push([name, value]); return query; },
          in(name, value) { filters.push([name, value]); return query; }, order() { return query; },
          async limit(maximum) {
            assert.equal(table, 'picks'); assert.equal(key, env.SUPABASE_ANON_KEY);
            assert.ok(selection.includes('!inner')); state.filters = filters;
            assert.ok(filters.some(([name, value]) => name === 'status' && value === 'active'));
            assert.ok(filters.some(([name, value]) => name === 'categories.is_visible' && value === true));
            assert.ok(filters.some(([name, value]) => name === 'items.status' && value.join(',') === 'active,discontinued'));
            return { data: rows.slice(0, maximum), error: null };
          },
          async maybeSingle() {
            if (table === 'profiles') return { data: { id: A }, error: null };
            if (table === 'profile_ai_generation_limits') return { data: { source_version: 0,
              next_allowed_at: new Date(Date.now() + 600000).toISOString() }, error: null };
            if (table === 'profile_ai_reviews') { state.cachedReads++; return { data: null, error: null }; }
            throw new Error(`Unexpected table: ${table}`);
          },
          async single() { assert.equal(table, 'system_actors'); return { data: { id: 'synthetic-actor' }, error: null }; },
        };
        return query;
      },
      async rpc(name, args) {
        if (name === 'reserve_profile_ai_generation') { state.reserved++; return { data: true, error: null }; }
        assert.equal(name, 'save_profile_ai_review'); state.saved++;
        return { data: { profile_id: A, body: args.p_body, is_visible: false, tone: args.p_prompt_version.split(':')[1] }, error: null };
      },
    };
  }
  const read = loader({ 'npm:@supabase/supabase-js@2.116.0': { createClient } }, {
    Deno: { env: { get: (name) => env[name] }, serve: (fn) => { handler = fn; } },
    fetch: async (_url, options) => {
      state.modelCalls++; assert.ok(JSON.parse(JSON.parse(options.body).input).picks.length >= 10);
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text',
        text: JSON.stringify({ summary: '선택에서 발견한 즐거움', body: '서로 다른 선택에서 좋아하는 이유를 함께 읽었어요.', keywords: ['선택', '기록', '취향'] }) }] }] });
    },
  });
  read(serverPath);
  return { state, request: () => handler(new Request('https://example.invalid/functions/v1/analyze-profile-taste', {
    method: 'POST', headers: { Authorization: 'Bearer synthetic-user' },
    body: JSON.stringify({ tone: 'direct', pickCount: 999, profile_id: 'not-the-authenticated-user' }),
  })) };
}
const rowsFor = (count) => Array.from({ length: count }, (_, i) => ({
  id: `synthetic-pick-${i}`, categories: { name: `카테고리 ${i}` }, items: { name: `선택 ${i}` },
  one_line_review: '구체적으로 좋아하는 이유를 적었어요.', updated_at: '2026-09-19T00:00:00Z',
}));
(async () => {
  await test('client and server both require exactly ten as the minimum', () => {
    assert.equal(MIN_PROFILE_AI_PICKS, 10); assert.match(readFileSync(contractPath, 'utf8'), /PROFILE_AI_MIN_PICKS = 10;/);
  });
  await test('client refuses every count below ten without invoking the repository', async () => {
    let calls = 0; const service = new ProfileAiReviewService({ generate: async () => { calls++; } });
    for (let count = 0; count < 10; count++) await assert.rejects(service.generate(A, count), (e) => e.code === 'AI_NOT_ENOUGH_PICKS');
    assert.equal(calls, 0);
  });
  await test('ten and larger counts pass the client minimum gate', async () => {
    const calls = []; const service = new ProfileAiReviewService({ generate: async (id) => { calls.push(id); return { profileId: id }; } });
    await service.generate(A, 10); await service.generate(A, 11); assert.deepEqual(calls, [A, A]);
  });
  for (const existing of [false, true]) for (const count of [0, 3, 7, 9, 10, 11]) {
    await test(`${existing ? 'regeneration' : 'first generation'} card at ${count} picks`, async () => {
      const view = card(count, existing);
      const generation = view.buttons.find((node) => node.props.testID === 'ai-tone-direct');
      const warm = view.buttons.find((node) => node.props.testID === 'ai-tone-warm');
      assert.ok(generation && warm); assert.equal(generation.props.disabled, count < 10); assert.equal(warm.props.disabled, count < 10);
      assert.ok(view.text.includes(`공개 원픽 ${count}/10개`));
      if (count < 10) assert.ok(view.text.includes(`${10 - count}개 더 등록하면 요청할 수 있어요.`));
      assert.equal(view.generated(), 0, 'Reaching ten does not auto-generate');
      generation.props.onPress(); await tick(); assert.equal(view.generated(), count < 10 ? 0 : 1);
      if (existing) assert.equal(view.buttons.at(-1).props.disabled, false, 'Hiding does not require ten picks');
    });
  }
  await test('ten picks never bypass missing server configuration', () => {
    const view = card(10, false, false); assert.ok(view.text.includes('AI 연결 준비 중'));
    for (const mode of ['direct', 'warm']) {
      const button = view.buttons.find((node) => node.props.testID === `ai-tone-${mode}`);
      assert.ok(button); assert.equal(button.props.disabled, true);
    }
  });
  await test('generic button gate still requires owner and configured service', () => {
    const ready = { isOwner: true, publicPickCount: 10, minimumPickCount: MIN_PROFILE_AI_PICKS,
      configured: true, compatible: true, statusError: false, statusPending: false };
    assert.equal(canRequestProfileAiGeneration(ready), true);
    for (const change of [{ publicPickCount: 9 }, { isOwner: false }, { configured: false }, { statusError: true }]) assert.equal(canRequestProfileAiGeneration({ ...ready, ...change }), false);
  });
  for (const count of [0, 3, 9, 10, 11]) await test(`actual Edge handler at ${count} source rows with a forged client count`, async () => {
    const { state, request } = server(rowsFor(count)); const response = await request(); const body = await response.json();
    if (count < 10) {
      assert.equal(response.status, 409); assert.deepEqual(body, { error: 'AI_NOT_ENOUGH_PICKS', minimum: 10, count, remaining: 10 - count });
      assert.equal(state.cachedReads, 0); assert.equal(state.reserved, 0); assert.equal(state.modelCalls, 0); assert.equal(state.saved, 0);
    } else {
      assert.equal(response.status, 200); assert.equal(state.reserved, 1); assert.equal(state.modelCalls, 1); assert.equal(state.saved, 1);
      assert.equal(body.review.is_visible, false); assert.equal(body.review.tone, 'direct');
    }
  });
  await test('unreadable relation does not turn nine eligible picks into ten', async () => {
    const rows = rowsFor(10); rows[9].items = null; const { state, request } = server(rows); const response = await request();
    assert.equal(response.status, 409); assert.equal((await response.json()).count, 9); assert.equal(state.modelCalls, 0); assert.equal(state.reserved, 0);
  });
  console.log(`${passed} AI minimum-ten regression scenarios passed; all transports mocked.`);
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = originalFetch; });
