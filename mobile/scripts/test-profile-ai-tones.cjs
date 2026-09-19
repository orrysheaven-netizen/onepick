// Real tone helpers, handler, repository and UI; all external transports mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, webcrypto } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const A = '11111111-1111-4111-8111-111111111111';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const ID = '44444444-4444-4444-8444-444444444444';
const date = '2026-09-19T00:00:00.000Z';
const originalFetch = global.fetch;
global.fetch = async () => { throw new Error('External network forbidden'); };
function loader(overrides = {}, context = {}) {
  const cache = new Map();
  const load = (file) => {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const local = { exports: {} }; cache.set(file, local);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const resolve = (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      let target = name.startsWith('@/') ? path.join(root, 'mobile/src', name.slice(2)) : path.resolve(path.dirname(file), name);
      if (!fs.existsSync(target)) target += fs.existsSync(target + '.tsx') ? '.tsx' : '.ts';
      return load(target);
    };
    new Function('module', 'exports', 'require', 'Deno', 'fetch', 'crypto', compiled)(
      local, local.exports, resolve, context.Deno, context.fetch ?? global.fetch, webcrypto);
    return local.exports;
  };
  return load;
}
const read = loader();
const tones = read(path.join(root, 'supabase/functions/analyze-profile-taste/tone.ts'));
const quality = read(path.join(root, 'supabase/functions/analyze-profile-taste/quality.ts'));
const clientTones = read(path.join(root, 'mobile/src/lib/profileAiTone.ts'));
const actor = { id: ACTOR, slug: 'onepick_ai', display_name: 'OnePick AI', actor_type: 'ai',
  bio: null, avatar_url: null, is_verified: true, is_active: true, created_at: date, updated_at: date };
const review = (tone = 'direct') => ({ id: ID, profile_id: A, actor_id: ACTOR, tone,
  summary: '선택에서 찾은 공통점', body: '구체적인 선택 이유를 연결한 합성 테스트 본문입니다.',
  keywords: ['선택', '기록', '취향'], is_visible: false, is_stale: false,
  generated_at: date, created_at: date, updated_at: date });
const rowsFor = (n) => Array.from({ length: n }, (_, i) => ({ id: `pick-${i}`, categories: { name: `분야 ${i}` },
  items: { name: `항목 ${i}` }, one_line_review: '구체적인 사용감이 좋아서 선택했어요.', updated_at: date }));
function server({ count = 10, cachedTone = null, limited = false, recent = false } = {}) {
  const rows = rowsFor(count);
  const snapshot = rows.map((p) => ({ pickId: p.id, category: p.categories.name, item: p.items.name,
    originalName: null, releaseYear: null, creatorName: null, collectionName: null,
    review: p.one_line_review, updatedAt: p.updated_at }));
  const sourceFingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const existing = cachedTone ? { ...review(cachedTone), source_version: 0,
    source_fingerprint: sourceFingerprint, model_name: 'gpt-5.6-terra',
    prompt_version: tones.tastePromptVersion(quality.TASTE_PROMPT_VERSION, cachedTone),
    generated_at: new Date(Date.now() - (recent ? 1000 : 900000)).toISOString() } : null;
  const state = { requests: [], saves: [], reservations: [], reads: 0 };
  let handler;
  const createClient = () => ({
    auth: { getUser: async () => ({ data: { user: { id: A, is_anonymous: false } }, error: null }) },
    from(table) {
      let columns;
      const q = { select(c) { columns = c; return q; }, eq() { return q; }, in() { return q; }, order() { return q; },
        async limit() { state.reads++; return { data: rows, error: null }; },
        async maybeSingle() {
          if (table === 'profiles') return { data: { id: A }, error: null };
          if (table === 'profile_ai_reviews') return { data: existing, error: null };
          if (table === 'profile_ai_generation_limits') return { data: columns === 'source_version'
            ? { source_version: 0 } : { next_allowed_at: new Date(Date.now() + 590000).toISOString() }, error: null };
          throw new Error('Unexpected table');
        },
        async single() { assert.equal(table, 'system_actors'); return { data: actor, error: null }; },
      };
      return q;
    },
    async rpc(name, args) {
      if (name === 'reserve_profile_ai_generation') {
        state.reservations.push(args); assert.deepEqual(args, { p_profile_id: A });
        return { data: !limited, error: null };
      }
      assert.equal(name, 'save_profile_ai_review'); state.saves.push(args);
      return { data: { ...review(args.p_prompt_version.split(':')[1]), is_visible: false }, error: null };
    },
  });
  const load = loader({ 'npm:@supabase/supabase-js@2.116.0': { createClient } }, {
    Deno: { serve: (fn) => { handler = fn; }, env: { get: () => 'synthetic-config-not-a-key' } },
    fetch: async (_url, options) => {
      state.requests.push(JSON.parse(options.body));
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text',
        text: JSON.stringify({ summary: '선택에서 찾은 연결', body: '구체적인 이유가 이어지는 선택으로 보여요.', keywords: ['선택', '연결', '기록'] }) }] }] });
    },
  });
  load(path.join(root, 'supabase/functions/analyze-profile-taste/index.ts'));
  return { state, request: (tone, extra = {}) => handler(new Request('https://example.invalid/analyze-profile-taste', {
    method: 'POST', headers: { Authorization: 'Bearer synthetic-user' }, body: JSON.stringify({ tone, ...extra }),
  })) };
}
function repository(tone = 'direct') {
  const calls = [];
  const client = { auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    getSession: async () => ({ data: { session: { access_token: 'synthetic-token', user: { id: A } } }, error: null }),
    getUser: async () => ({ data: { user: { id: A } }, error: null }),
  }, functions: { invoke: async (...args) => { calls.push(args); return { data: { review: review(tone), actor }, error: null }; } } };
  const Repository = read(path.join(root, 'mobile/src/repositories/supabase/supabaseProfileAiReviewRepository.ts')).SupabaseProfileAiReviewRepository;
  return { calls, repository: new Repository(client) };
}
function card({ count = 10, compatible = true, visible = false, isMine = true, tone = 'warm' } = {}) {
  const calls = [];
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props: props ?? {} };
  const load = loader({
    react: { useEffect: (fn) => fn(), useState: (value) => [value, () => {}], useRef: (current) => ({ current }) },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'view', Text: 'text', Pressable: 'button', ActivityIndicator: 'loading', StyleSheet: { create: (x) => x } },
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: isMine ? A : 'visitor' }, isLoading: false }) },
    '@/hooks/useProfileAiReview': {
      useProfileAiReview: () => ({ data: visible ? { ...review(tone), isVisible: true, isStale: false, tone,
        actor: { displayName: 'OnePick AI' }, generatedAt: date, keywords: ['선택', '연결', '기록'] } : null, isPending: false, isError: false }),
      useGenerateProfileAiReview: () => ({ isPending: false, mutateAsync: async (request) => { calls.push(request); return { isVisible: false, tone: request.tone }; } }),
      useSetProfileAiReviewVisibility: () => ({ isPending: false, mutateAsync: async () => ({ isVisible: false }) }),
    },
    '@/hooks/useProfileAiEligibility': { useProfileAiEligibility: () => ({ data: count, isPending: false, isFetching: false, isError: false,
      refetch: async () => ({ data: count, isError: false }) }) },
    '@/hooks/useProfileAiStatus': { useProfileAiStatus: () => ({ data: { configured: true, compatible }, isPending: false, isFetching: false, isError: false,
      refetch: async () => ({ data: { configured: true, compatible }, isError: false }) }) },
  });
  const tree = load(path.join(root, 'mobile/src/components/profile-ai-review-card.tsx')).ProfileAiReviewCard({ profileUserId: A, pickCount: count, isMine });
  const text = (n) => n == null || typeof n === 'boolean' ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
    : Array.isArray(n) ? n.map(text).join('') : text(n.props?.children);
  const buttons = [];
  const visit = (n) => { if (Array.isArray(n)) return n.forEach(visit); if (!n || typeof n !== 'object') return;
    if (n.type === 'button') buttons.push(n); visit(n.props?.children); };
  visit(tree);
  return { calls, text: text(tree), buttons, button: (mode) => buttons.find((b) => b.props.testID === `ai-tone-${mode}`) };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
(async () => {
  await test('fixed mode enum, no personality inference or arbitrary instruction mode', () => {
    for (const value of ['T', 'F', null, undefined, {}, 'roast']) assert.throws(() => tones.requireTasteTone(value));
    assert.equal(clientTones.profileAiToneLabel(null), '취향 해석');
    assert.equal(clientTones.profileAiToneLabel('warm'), '다정한 해석');
  });
  await test('both modes preserve the exact common safety and evidence instructions', () => {
    for (const tone of ['direct', 'warm']) {
      const instructions = tones.tasteInstructions(quality.TASTE_INSTRUCTIONS, tone);
      assert.ok(instructions.startsWith(quality.TASTE_INSTRUCTIONS));
      assert.ok(instructions.includes('MBTI나 성격의 증거가 아닙니다'));
      assert.ok(tones.tastePromptVersion(quality.TASTE_PROMPT_VERSION, tone).length <= 40);
    }
    assert.notEqual(tones.tasteInstructions('base', 'direct'), tones.tasteInstructions('base', 'warm'));
  });
  for (const tone of ['direct', 'warm']) {
    await test(`${tone} request selects fixed instructions and saves matching private metadata`, async () => {
      const f = server(); const response = await f.request(tone, { instructions: 'UNTRUSTED_OVERRIDE', pickCount: 999 });
      const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.review.tone, tone);
      assert.equal(data.review.is_visible, false); assert.equal(f.state.requests.length, 1);
      assert.equal(f.state.requests[0].instructions, tones.tasteInstructions(quality.TASTE_INSTRUCTIONS, tone));
      assert.ok(!JSON.stringify(f.state.requests).includes('UNTRUSTED_OVERRIDE'));
      assert.equal(f.state.saves[0].p_prompt_version, tones.tastePromptVersion(quality.TASTE_PROMPT_VERSION, tone));
    });
    await test(`${tone} cannot generate below ten`, async () => {
      const f = server({ count: 9 }); const response = await f.request(tone);
      assert.equal(response.status, 409); assert.equal((await response.json()).count, 9);
      assert.equal(f.state.requests.length, 0); assert.equal(f.state.reservations.length, 0);
    });
    await test(`${tone} reuses only the same tone and source`, async () => {
      const f = server({ cachedTone: tone }); const data = await (await f.request(tone)).json();
      assert.equal(data.reused, true); assert.equal(f.state.requests.length, 0); assert.equal(f.state.reservations.length, 0);
    });
    await test(`${tone} repository sends the captured mode and rejects a different mode`, async () => {
      const f = repository(tone); assert.equal((await f.repository.generate(A, tone)).tone, tone);
      assert.deepEqual(f.calls[0][1].body, { tone });
      const wrong = repository(tone === 'direct' ? 'warm' : 'direct');
      await assert.rejects(wrong.repository.generate(A, tone), (e) => e.code === 'AI_REVIEW_FAILED');
    });
    await test(`${tone} UI sends the selected tone after preflight`, async () => {
      const view = card(); assert.equal(view.calls.length, 0);
      view.button(tone).props.onPress(); await tick();
      assert.deepEqual(view.calls, [{ count: 10, tone }]);
    });
  }
  await test('switching tone generates new text rather than reusing the old mode', async () => {
    const f = server({ cachedTone: 'direct' }); const data = await (await f.request('warm')).json();
    assert.equal(data.reused, false); assert.equal(data.review.tone, 'warm'); assert.equal(data.review.is_visible, false);
  });
  await test('tone changes share the existing cooldown', async () => {
    for (const setup of [{ cachedTone: 'direct', recent: true }, { limited: true }]) {
      const f = server(setup); assert.equal((await f.request('warm')).status, 429); assert.equal(f.state.requests.length, 0);
    }
  });
  for (const tone of [undefined, null, 'T', 'F', 'roast', {}]) {
    await test('invalid or missing mode cannot read picks, reserve or call a model', async () => {
      const f = server(); const response = await f.request(tone);
      assert.equal(response.status, 400); assert.equal(f.state.reads, 0); assert.equal(f.state.reservations.length, 0); assert.equal(f.state.requests.length, 0);
    });
  }
  await test('bounded request rejects oversized input', async () => {
    await assert.rejects(tones.readTasteTone(new Request('https://example.invalid', { method: 'POST', body: JSON.stringify({ tone: 'warm', padding: 'x'.repeat(2048) }) })));
  });
  await test('legacy response cannot masquerade as a newly requested mode', async () => {
    const f = repository(null); await assert.rejects(f.repository.generate(A, 'direct'), (e) => e.code === 'AI_REVIEW_FAILED');
  });
  await test('both buttons disabled below ten and on an incompatible server', () => {
    for (const setup of [{ count: 9 }, { compatible: false }]) {
      const view = card(setup); assert.equal(view.button('direct').props.disabled, true); assert.equal(view.button('warm').props.disabled, true);
    }
  });
  await test('same-frame T then F starts only the original request', async () => {
    const view = card(); view.button('direct').props.onPress(); view.button('warm').props.onPress(); await tick();
    assert.deepEqual(view.calls, [{ count: 10, tone: 'direct' }]);
  });
  await test('public display uses saved tone without MBTI labels or request buttons', () => {
    const view = card({ visible: true, isMine: false, tone: 'warm' });
    assert.ok(view.text.includes('다정한 해석')); assert.equal(view.button('direct'), undefined); assert.equal(view.button('warm'), undefined);
    const legacy = card({ visible: true, isMine: false, tone: null }); assert.ok(!legacy.text.includes('다정한 해석'));
  });
  await test('QA builds both production modes with identical input and bounded call plans', () => {
    const { loadProduction } = require('../../qa/profile-ai-runtime.cjs');
    const qa = require('../../qa/run-profile-ai-quality.cjs');
    const dataset = require('../../qa/profile-ai-quality-cases.cjs');
    const direct = loadProduction(root, 'direct'), warm = loadProduction(root, 'warm');
    assert.equal(direct.build(dataset.cases[0].picks).input, warm.build(dataset.cases[0].picks).input);
    assert.notEqual(direct.promptHash, warm.promptHash); assert.notEqual(direct.promptVersion, warm.promptVersion);
    assert.equal(qa.createPlan(direct).maximumCalls, 24); assert.equal(qa.createPlan(warm).maximumCalls, 24);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'onepick-tone-'));
    try {
      const dir = path.join(temp, 'supabase/functions/analyze-profile-taste'); fs.mkdirSync(dir, { recursive: true });
      for (const file of Object.keys(direct.sourceHashes)) fs.copyFileSync(path.join(root, 'supabase/functions/analyze-profile-taste', file), path.join(dir, file));
      const file = path.join(dir, 'index.ts'), original = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, original.replace('store: false,', 'store: true,')); assert.throws(() => loadProduction(temp), /CONTRACT_CHANGED/);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
  console.log(`${passed} tone helper/handler/cache/repository/UI/QA tests passed. No live model calls.`);
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = originalFetch; });
