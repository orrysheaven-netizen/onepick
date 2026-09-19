// Execute actual service/repository code with transport doubles, never real credentials.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.join(__dirname, '../src');
const modules = new Map();
function load(filename) {
  filename = path.resolve(filename);
  if (modules.has(filename)) return modules.get(filename).exports;
  const local = { exports: {} }; modules.set(filename, local);
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const resolve = (name) => {
    if (name.startsWith('@/')) return load(path.join(root, name.slice(2) + '.ts'));
    if (name.startsWith('.')) return load(path.join(path.dirname(filename), name + '.ts'));
    throw new Error(`Unexpected dependency: ${name}`);
  };
  new Function('module', 'exports', 'require', compiled)(local, local.exports, resolve);
  return local.exports;
}
const { AppError } = load(path.join(root, 'errors/appError.ts'));
const { ProfileAiReviewService } = load(path.join(root, 'services/profileAiReviewService.ts'));
const { SupabaseProfileAiReviewRepository: Repository } = load(path.join(root, 'repositories/supabase/supabaseProfileAiReviewRepository.ts'));
const { parseProfileAiReview } = load(path.join(root, 'lib/profileAiReviewResponse.ts'));
const { requireProfileAiReviewVersion } = load(path.join(root, 'lib/profileAiPublication.ts'));
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const REVIEW = '44444444-4444-4444-8444-444444444444';
const date = '2026-09-19T00:00:00.000Z';
const seen = () => ({ id: REVIEW, generatedAt: date });
const fixture = () => ({
  review: { id: REVIEW, profile_id: A, actor_id: ACTOR,
    summary: '테스트용 취향 요약', body: '등록한 선택의 이유를 정리한 테스트 본문입니다.',
    keywords: ['선택', '취향', '기록'], is_visible: false, is_stale: false,
    generated_at: date, created_at: date, updated_at: date },
  actor: { id: ACTOR, slug: 'onepick_ai', display_name: 'OnePick AI', actor_type: 'ai',
    bio: null, avatar_url: null, is_verified: true, is_active: true, created_at: date, updated_at: date },
});
const sessionFor = (id = A, token = `synthetic-${id}`) => ({ user: { id, is_anonymous: false }, access_token: token });
const expectCode = (code) => (error) => error instanceof AppError && error.code === code;
function fake() {
  const listeners = new Set();
  const f = {
    session: sessionFor(), payload: fixture(), row: fixture().review, calls: [], reads: [], writes: [],
    authCalls: 0, verifyTokens: [], unsubscribed: 0,
    emit(event, session) { f.session = session; for (const listener of listeners) listener(event, session); },
    get subscriptions() { return listeners.size; },
  };
  f.client = {
    auth: {
      onAuthStateChange(callback) {
        listeners.add(callback);
        return { data: { subscription: { unsubscribe() { listeners.delete(callback); f.unsubscribed++; } } } };
      },
      async getSession() {
        f.authCalls++;
        if (f.onSession) await f.onSession();
        return { data: { session: f.session }, error: f.sessionError ?? null };
      },
      async getUser(token) {
        f.verifyTokens.push(token);
        if (f.onVerify) await f.onVerify();
        return { data: { user: f.verifiedUser ?? { id: A, is_anonymous: false } }, error: f.verifyError ?? null };
      },
    },
    functions: {
      async invoke(name, options) {
        f.calls.push({ name, options });
        if (f.onInvoke) await f.onInvoke();
        return { data: f.payload, error: f.invokeError ?? null };
      },
    },
    from(table) {
      const query = { table, filters: [], columns: null, values: null };
      const builder = {
        select(columns) { query.columns = columns; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        update(values) { query.values = values; return builder; },
        async maybeSingle() {
          if (query.values) f.writes.push(query); else f.reads.push(query);
          if (f.onQuery) await f.onQuery(query);
          if (table === 'system_actors') return { data: f.payload.actor, error: f.actorError ?? null };
          if (f.queryError) return { data: null, error: f.queryError };
          // Model filtering, not just call syntax. A late replacement must not match.
          if (!f.row || !query.filters.every(([column, value]) => f.row[column] === value)) {
            return { data: null, error: null };
          }
          if (query.values) f.row = { ...f.row, ...query.values };
          return { data: f.row, error: null };
        },
      };
      return builder;
    },
  };
  f.repository = new Repository(f.client);
  return f;
}
let passed = 0;
async function test(name, action) { await action(); passed++; console.log(`PASS ${name}`); }
const originalFetch = global.fetch;
global.fetch = async () => { throw new Error('Network forbidden in AI account regression tests'); };
(async () => {
  await test('service binds originating profile BEFORE generation', async () => {
    let received;
    const service = new ProfileAiReviewService({ generate: async (id) => { received = id; return { profileId: A }; } });
    await service.generate(A, 10); assert.equal(received, A);
  });
  await test('invalid/insufficient pick counts never reach the repository', async () => {
    let calls = 0;
    const service = new ProfileAiReviewService({ generate: async () => { calls++; } });
    for (const count of [0, 2, 3, 9, -1, 10.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(service.generate(A, count), expectCode('AI_NOT_ENOUGH_PICKS'));
    }
    assert.equal(calls, 0);
  });
  await test('service retains defense against a mismatched returned profile', async () => {
    const service = new ProfileAiReviewService({ generate: async () => ({ profileId: B }) });
    await assert.rejects(service.generate(A, 10), expectCode('FORBIDDEN'));
  });
  for (const [name, session] of [['logged out', null], ['other account', sessionFor(B)],
    ['anonymous account', { ...sessionFor(), user: { id: A, is_anonymous: true } }]]) {
    await test(`${name}: no generation request is sent`, async () => {
      const f = fake(); f.session = session;
      await assert.rejects(f.repository.generate(A), expectCode('AUTH_REQUIRED'));
      assert.equal(f.calls.length, 0); assert.equal(f.subscriptions, 0);
    });
  }
  await test('Auth verification failure cannot be replaced with local session trust', async () => {
    const f = fake(); f.verifyError = { message: 'expired' };
    await assert.rejects(f.repository.generate(A), expectCode('AUTH_REQUIRED'));
    assert.equal(f.calls.length, 0); assert.equal(f.unsubscribed, 1);
  });
  await test('Auth returning a different user cannot start generation', async () => {
    const f = fake(); f.verifiedUser = { id: B };
    await assert.rejects(f.repository.generate(A), expectCode('AUTH_REQUIRED')); assert.equal(f.calls.length, 0);
  });
  await test('account switch during token verification is caught before POST', async () => {
    const f = fake(); f.onVerify = () => f.emit('SIGNED_IN', sessionFor(B));
    await assert.rejects(f.repository.generate(A), expectCode('AUTH_REQUIRED'));
    assert.equal(f.calls.length, 0); assert.equal(f.subscriptions, 0);
  });
  await test('successful POST pins verified token without global auth mutation', async () => {
    const f = fake(); const token = f.session.access_token;
    const result = await f.repository.generate(A);
    assert.equal(result.profileId, A); assert.equal(result.isVisible, false);
    assert.equal(f.calls.length, 1); assert.deepEqual(f.verifyTokens, [token]);
    assert.deepEqual(f.calls[0], { name: 'analyze-profile-taste', options: { body: {}, headers: { Authorization: `Bearer ${token}` } } });
    assert.equal(f.subscriptions, 0); assert.equal(f.unsubscribed, 1);
  });
  await test('token refresh for the same user does not cancel a valid request', async () => {
    const f = fake(); const token = f.session.access_token;
    f.onInvoke = () => f.emit('TOKEN_REFRESHED', sessionFor(A, 'synthetic-refreshed'));
    assert.equal((await f.repository.generate(A)).profileId, A);
    assert.equal(f.calls[0].options.headers.Authorization, `Bearer ${token}`);
  });
  for (const [name, change] of [
    ['switch A to B', (f) => f.emit('SIGNED_IN', sessionFor(B))],
    ['sign out', (f) => f.emit('SIGNED_OUT', null)],
    ['switch A to B then A', (f) => { f.emit('SIGNED_IN', sessionFor(B)); f.emit('SIGNED_IN', sessionFor(A)); }],
    ['sign out then sign into A again', (f) => { f.emit('SIGNED_OUT', null); f.emit('SIGNED_IN', sessionFor(A)); }],
  ]) {
    await test(`${name}: discard late result and release observer`, async () => {
      const f = fake(); f.onInvoke = () => change(f);
      await assert.rejects(f.repository.generate(A), expectCode('AUTH_REQUIRED'));
      assert.equal(f.calls.length, 1); assert.equal(f.subscriptions, 0);
      assert.equal(f.calls[0].options.headers.Authorization, `Bearer ${sessionFor().access_token}`);
    });
  }
  await test('transport rejection always removes Auth observer', async () => {
    const f = fake(); f.onInvoke = () => { throw new Error('offline'); };
    await assert.rejects(f.repository.generate(A), /offline/); assert.equal(f.subscriptions, 0);
  });
  for (const code of ['AUTH_REQUIRED', 'FORBIDDEN', 'AI_NOT_CONFIGURED', 'AI_NOT_ENOUGH_PICKS', 'AI_REVIEW_STALE', 'RATE_LIMITED']) {
    await test(`${code} remains a distinct recoverable UI error`, async () => {
      const f = fake(); f.invokeError = { context: Response.json({ error: code }) };
      await assert.rejects(f.repository.generate(A), expectCode(code)); assert.equal(f.subscriptions, 0);
    });
  }
  await test('malformed provider error is not shown as a successful evaluation', async () => {
    const f = fake(); f.invokeError = { context: new Response('<html>failure</html>') };
    await assert.rejects(f.repository.generate(A), expectCode('AI_REVIEW_FAILED')); assert.equal(f.subscriptions, 0);
  });
  const rejected = [
    ['another profile', (p) => { p.review.profile_id = B; }],
    ['mismatched actor ID', (p) => { p.actor.id = B; }],
    ['human author labelled as AI', (p) => { p.actor.actor_type = 'human'; }],
    ['unverified author', (p) => { p.actor.is_verified = false; }],
    ['inactive author', (p) => { p.actor.is_active = false; }],
    ['other AI slug', (p) => { p.actor.slug = 'fake_ai'; }],
    ['missing privacy flag', (p) => { delete p.review.is_visible; }],
    ['string privacy flag', (p) => { p.review.is_visible = 'false'; }],
    ['public stale response', (p) => { p.review.is_visible = true; p.review.is_stale = true; }],
    ['empty summary', (p) => { p.review.summary = '  '; }],
    ['oversized body', (p) => { p.review.body = '가'.repeat(1201); }],
    ['missing body', (p) => { delete p.review.body; }],
    ['two keywords', (p) => { p.review.keywords = ['선택', '취향']; }],
    ['non-string keyword', (p) => { p.review.keywords[0] = 123; }],
    ['duplicate keywords after trimming', (p) => { p.review.keywords = ['선택', ' 선택 ', '취향']; }],
    ['invalid timestamp', (p) => { p.review.generated_at = 'invalid'; }],
    ['missing actor', (p) => { p.actor = null; }],
  ];
  for (const [name, alter] of rejected) {
    await test(`invalid response: ${name}`, async () => {
      const f = fake(); alter(f.payload);
      await assert.rejects(f.repository.generate(A), expectCode('AI_REVIEW_FAILED')); assert.equal(f.subscriptions, 0);
    });
  }
  await test('internal server fields never enter the returned UI object', () => {
    const p = fixture(); p.review.pick_snapshot = ['private']; p.review.model_name = 'internal';
    p.review.source_fingerprint = 'internal'; p.actor.unexpected = 'not-retained';
    const result = parseProfileAiReview(p.review, p.actor, A);
    assert.equal(result.pick_snapshot, undefined); assert.equal(result.model_name, undefined);
    assert.equal(result.source_fingerprint, undefined); assert.equal(result.actor.unexpected, undefined);
    assert.equal(result.isVisible, false); assert.equal(result.isStale, false);
  });
  await test('public read requires no model/configuration or login lookup', async () => {
    const f = fake(); f.session = null; f.row.is_visible = true;
    const result = await f.repository.getByProfileId(A);
    assert.equal(result.isVisible, true); assert.equal(f.calls.length, 0); assert.equal(f.authCalls, 0);
  });
  await test('no accessible review returns null and skips author lookup', async () => {
    const f = fake(); f.row = null;
    assert.equal(await f.repository.getByProfileId(A), null); assert.equal(f.reads.length, 1);
  });
  await test('private stale owner result remains private/stale after mapping', async () => {
    const f = fake(); f.row.is_stale = true;
    const result = await f.repository.getByProfileId(A);
    assert.equal(result.isVisible, false); assert.equal(result.isStale, true);
  });
  for (const visible of [false, true]) {
    await test(`owner can ${visible ? 'publish the seen version' : 'hide'} without an AI call`, async () => {
      const f = fake(); const result = await f.repository.setVisibility(A, visible, seen());
      assert.equal(result.isVisible, visible); assert.equal(f.calls.length, 0);
      assert.deepEqual(f.writes[0].values, { is_visible: visible });
      assert.deepEqual(f.writes[0].filters, visible
        ? [['profile_id', A], ['id', REVIEW], ['generated_at', date], ['is_stale', false]] : [['profile_id', A]]);
      assert.equal(f.subscriptions, 0);
    });
  }
  await test('another account cannot start a visibility write', async () => {
    const f = fake(); f.session = sessionFor(B);
    await assert.rejects(f.repository.setVisibility(A, true, seen()), expectCode('AUTH_REQUIRED'));
    assert.equal(f.writes.length, 0);
  });
  await test('stale publication constraint becomes the correct UI error', async () => {
    const f = fake(); f.queryError = { code: '23514', message: 'profile_ai_reviews_no_stale_publication' };
    await assert.rejects(f.repository.setVisibility(A, true, seen()), expectCode('AI_REVIEW_STALE'));
    assert.equal(f.subscriptions, 0);
  });
  await test('zero-row publication is never reported as success', async () => {
    const f = fake(); f.row = null;
    await assert.rejects(f.repository.setVisibility(A, true, seen()), expectCode('AI_REVIEW_STALE'));
    assert.equal(f.subscriptions, 0);
  });
  await test('account switch while visibility response loads discards late result', async () => {
    const f = fake(); f.onQuery = (query) => { if (query.table === 'profile_ai_reviews' && query.values) f.emit('SIGNED_IN', sessionFor(B)); };
    await assert.rejects(f.repository.setVisibility(A, false), expectCode('AUTH_REQUIRED')); assert.equal(f.subscriptions, 0);
  });
  await test('publishing without a displayed version fails before a database request', async () => {
    const f = fake(); await assert.rejects(f.repository.setVisibility(A, true), expectCode('AI_REVIEW_STALE'));
    assert.equal(f.writes.length, 0); assert.equal(f.authCalls, 0);
  });
  await test('malformed publication versions fail closed', () => {
    for (const value of [undefined, null, {}, { ...seen(), id: 'not-a-uuid' },
      { ...seen(), generatedAt: '' }, { ...seen(), generatedAt: 'yesterday' },
      { ...seen(), generatedAt: '2026-09-19T00:00:00.1234567Z' }]) {
      assert.throws(() => requireProfileAiReviewVersion(value), expectCode('AI_REVIEW_STALE'));
    }
  });
  await test('service passes the displayed version unchanged', async () => {
    let received;
    const service = new ProfileAiReviewService({ setVisibility: async (...args) => { received = args; return {}; } });
    const version = seen(); await service.setVisibility(A, true, version);
    assert.deepEqual(received, [A, true, version]);
  });
  await test('previous screen cannot publish a regenerated body in the same row', async () => {
    const f = fake(); f.row.body = '새로 생성되어 아직 읽지 않은 본문'; f.row.generated_at = '2026-09-19T01:00:00.000Z';
    await assert.rejects(f.repository.setVisibility(A, true, seen()), expectCode('AI_REVIEW_STALE'));
    assert.equal(f.row.is_visible, false); assert.equal(f.writes.length, 1);
  });
  await test('row deletion/recreation cannot reuse consent even with the same timestamp', async () => {
    const f = fake(); f.row.id = B;
    await assert.rejects(f.repository.setVisibility(A, true, seen()), expectCode('AI_REVIEW_STALE'));
    assert.equal(f.row.is_visible, false);
  });
  await test('source invalidation without regeneration blocks publication', async () => {
    const f = fake(); f.row.is_stale = true;
    await assert.rejects(f.repository.setVisibility(A, true, seen()), expectCode('AI_REVIEW_STALE'));
    assert.equal(f.row.is_visible, false);
  });
  await test('microseconds are preserved, not rounded into an unrelated version', async () => {
    const f = fake(); f.row.generated_at = '2026-09-19T00:00:00.123002+00:00';
    await assert.rejects(f.repository.setVisibility(A, true, { id: REVIEW, generatedAt: '2026-09-19T00:00:00.123001+00:00' }), expectCode('AI_REVIEW_STALE'));
    assert.equal(f.row.is_visible, false);
    const result = await f.repository.setVisibility(A, true, { id: REVIEW, generatedAt: f.row.generated_at });
    assert.equal(result.isVisible, true);
    assert.equal(f.writes.at(-1).filters[2][1], '2026-09-19T00:00:00.123002+00:00');
  });
  await test('replacement after Auth validation is checked by the UPDATE itself', async () => {
    const f = fake(); f.onQuery = (query) => {
      if (query.values) f.row.generated_at = '2026-09-19T02:00:00.000Z';
    };
    await assert.rejects(f.repository.setVisibility(A, true, seen()), expectCode('AI_REVIEW_STALE'));
    assert.equal(f.row.is_visible, false); assert.equal(f.writes.length, 1);
    assert.equal(f.reads.length, 0, 'No fetch-latest-and-publish fallback');
  });
  await test('caller mutation during Auth does not replace the captured consent', async () => {
    const f = fake(); const version = seen();
    f.row.generated_at = '2026-09-19T03:00:00.000Z';
    f.onVerify = () => { version.generatedAt = f.row.generated_at; };
    await assert.rejects(f.repository.setVisibility(A, true, version), expectCode('AI_REVIEW_STALE'));
    assert.equal(f.row.is_visible, false);
  });
  await test('old screen can still hide a newer public result', async () => {
    const f = fake(); f.row.generated_at = '2026-09-19T03:00:00.000Z'; f.row.is_visible = true;
    const result = await f.repository.setVisibility(A, false, seen());
    assert.equal(result.isVisible, false); assert.deepEqual(f.writes[0].filters, [['profile_id', A]]);
  });
  await test('hiding needs neither a valid version nor a model connection', async () => {
    const f = fake(); f.row.is_stale = true;
    assert.equal((await f.repository.setVisibility(A, false, { id: 'old', generatedAt: 'invalid' })).isVisible, false);
    assert.equal(f.calls.length, 0);
  });
  await test('zero-row hide is not reported as success', async () => {
    const f = fake(); f.row = null;
    await assert.rejects(f.repository.setVisibility(A, false), expectCode('FORBIDDEN'));
  });
  console.log(`${passed} AI account/response/publication regression scenarios passed; no network or API key used.`);
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = originalFetch; });
