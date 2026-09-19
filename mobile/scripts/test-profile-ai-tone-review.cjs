// Production recipe builders, but only local plan/result fixtures. No provider calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadProduction } = require('../../qa/profile-ai-runtime.cjs');
const { planFingerprint, sha256 } = require('../../qa/profile-ai-plan-identity.cjs');
const qa = require('../../qa/run-profile-ai-quality.cjs');
const review = require('../../qa/compare-profile-ai-tones.cjs');
const originalFetch = global.fetch;
global.fetch = async () => { assert.fail('Network forbidden in tone comparison tests'); };
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'onepick-tone-review-'));
const runtimes = { direct: loadProduction(undefined, 'direct'), warm: loadProduction(undefined, 'warm') };
const plans = Object.fromEntries(Object.entries(runtimes).map(([tone, runtime]) => [tone, qa.createPlan(runtime, 1)]));
const clone = (value) => JSON.parse(JSON.stringify(value));
const pair = () => [qa.emptyRun(plans.direct), qa.emptyRun(plans.warm)];
const comment = { summary: '선택 이유를 구체적으로 연결한 목록', body: '영화의 작은 단서와 볼펜의 끊기지 않는 필기감을 좋아한다고 적었네요.', keywords: ['선택', '사용감', '연결'] };
function measured() {
  const result = pair();
  for (const run of result) {
    run.mode = 'mock'; run.providerCallsAttempted = 8;
    for (const row of run.rows) Object.assign(row, { status: 'output_received', automaticCheck: 'pass',
      comment: clone(comment), durationMs: 10, actualModel: 'synthetic-fixture' });
  }
  return result;
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
(async () => {
  await test('same production sources and input give distinct tone identities', () => {
    const [a, b] = [plans.direct, plans.warm];
    assert.equal(a.datasetHash, b.datasetHash); assert.deepEqual(a.sourceHashes, b.sourceHashes);
    assert.equal(sha256(JSON.stringify({ datasetHash: a.datasetHash, repeats: a.repeats, sources: a.sourceHashes })),
      sha256(JSON.stringify({ datasetHash: b.datasetHash, repeats: b.repeats, sources: b.sourceHashes })));
    assert.notEqual(a.fingerprint, b.fingerprint); assert.notEqual(a.promptHash, b.promptHash);
    assert.equal(a.identityVersion, 2); assert.equal(a.tone, 'direct'); assert.equal(b.tone, 'warm');
  });
  await test('request recipe changes are identity changes even with unchanged source files', () => {
    const original = plans.direct;
    for (const change of [{ model: 'fixture-v2' }, { promptHash: sha256('changed') },
      { maximumOutputTokensPerCall: 800 }, { tone: 'warm' }]) {
      assert.notEqual(planFingerprint({ ...original, ...change }), original.fingerprint);
    }
    const sameSourcesNewRequest = { ...runtimes.direct,
      build: (picks) => ({ ...runtimes.direct.build(picks), max_output_tokens: 800 }), maxOutputTokens: 800 };
    assert.notEqual(qa.createPlan(sameSourcesNewRequest, 1).fingerprint, original.fingerprint);
  });
  await test('plan-only report keeps all eight pairs empty and ungraded', () => {
    const result = review.compareToneRuns(...pair());
    assert.equal(result.pairs.length, 8); assert.equal(result.plannedCalls, 16); assert.equal(result.attempts, 0);
    assert.equal(result.readyPairs, 0); assert.ok(result.pairs.every((p) => !p.direct.comment && !p.warm.comment && p.humanVerdict === null));
    assert.equal(review.reviewTemplate(result).pairs[0].checks.sameGroundedObservations, null);
  });
  await test('same-tone and reversed arguments cannot masquerade as T/F pairs', () => {
    const [a, b] = pair(); assert.throws(() => review.compareToneRuns(a, a), /IDENTITY/);
    assert.throws(() => review.compareToneRuns(b, a), /IDENTITY/);
  });
  await test('old identities require new plans instead of guessing tone labels', () => {
    const [a, b] = pair(); delete a.plan.identityVersion;
    assert.throws(() => review.compareToneRuns(a, b), /IDENTITY/);
  });
  await test('a tone label inconsistent with its prompt version is rejected', () => {
    const [a, b] = pair(); b.plan.promptVersion = plans.direct.promptVersion;
    b.plan.fingerprint = planFingerprint(b.plan);
    assert.throws(() => review.compareToneRuns(a, b), /PROMPT/);
  });
  await test('missing, duplicate and relabelled rows are rejected', () => {
    for (const mutate of [(r) => r.rows.pop(), (r) => { r.rows[1] = r.rows[0]; },
      (r) => { r.rows[0].key = 'unknown#1'; }, (r) => { r.rows[0].repetition = 2; }]) {
      const [a, b] = pair(); mutate(b); assert.throws(() => review.compareToneRuns(a, b), /ROWS/);
    }
  });
  await test('modified input and response request hashes are rejected', () => {
    const [a, b] = pair(); b.plan.cases[0].picks[0].review = '바뀐 입력';
    assert.throws(() => review.compareToneRuns(a, b), /DATASET/);
    const [c, d] = pair(); d.rows[0].requestHash = sha256('another request');
    assert.throws(() => review.compareToneRuns(c, d), /ROWS/);
  });
  await test('different model or source files cannot be called a tone-only comparison', () => {
    for (const change of ['model', 'source']) {
      const [a, b] = pair();
      if (change === 'model') b.plan.model = 'another-fixture-model';
      else b.plan.sourceHashes['quality.ts'] = sha256('other source');
      b.plan.fingerprint = planFingerprint(b.plan);
      assert.throws(() => review.compareToneRuns(a, b), /SETTINGS/);
    }
  });
  await test('repeat counts must match', () => {
    const [a] = pair(); const b = qa.emptyRun(qa.createPlan(runtimes.warm, 2));
    assert.throws(() => review.compareToneRuns(a, b), /INPUTS/);
  });
  await test('plan and mock results cannot be mixed', () => {
    const [a] = pair(); const [, b] = measured(); assert.throws(() => review.compareToneRuns(a, b), /MODES/);
  });
  await test('failures and unattempted rows remain visible, not replaced by examples', () => {
    const [a, b] = measured();
    Object.assign(b.rows[0], { status: 'http_503', automaticCheck: 'not_run', comment: null });
    b.rows[1] = clone(pair()[1].rows[1]); b.providerCallsAttempted = 7;
    const result = review.compareToneRuns(a, b);
    assert.equal(result.pairs.length, 8); assert.equal(result.pairs[0].warm.status, 'http_503');
    assert.equal(result.pairs[1].warm.status, 'not_attempted'); assert.equal(result.pairs[0].warm.comment, null);
  });
  await test('unattempted output and false success labels cannot improve the report', () => {
    const [a, b] = pair(); b.rows[0].comment = clone(comment);
    assert.throws(() => review.compareToneRuns(a, b), /INVENTED/);
    const [c, d] = measured(); d.rows[0].automaticCheck = 'fail';
    assert.throws(() => review.compareToneRuns(c, d), /FALSE_SUCCESS/);
  });
  await test('mock output is labelled mock with no release verdict', () => {
    const result = review.compareToneRuns(...measured());
    assert.equal(result.mode, 'mock'); assert.equal(result.readyPairs, 0);
    assert.match(review.renderReport(result), /모의 응답 · 실제 AI 품질 검증 아님/);
    assert.ok(review.reviewTemplate(result).pairs.every((p) => p.verdict === null && p.reviewer === null));
  });
  await test('live-shaped fixtures still require human decisions, never automatic approval', () => {
    // Shape validation only: no live provider requests occur in this test.
    const [a, b] = measured(); a.mode = b.mode = 'live';
    const result = review.compareToneRuns(a, b);
    assert.equal(result.readyPairs, 8); assert.equal(result.humanMeaningVerdict, 'not_automatically_graded');
    assert.ok(result.pairs.every((p) => p.humanVerdict === null));
  });
  await test('changed output invalidates the paired review reference', () => {
    const [a, b] = measured(); const before = review.compareToneRuns(a, b);
    b.rows[0].comment.body += ' 메모에 적힌 선택 이유도 함께 읽었어요.';
    const after = review.compareToneRuns(a, b);
    assert.notEqual(before.pairs[0].comparisonId, after.pairs[0].comparisonId);
    assert.notEqual(review.reviewTemplate(before).pairs[0].warmOutputHash,
      review.reviewTemplate(after).pairs[0].warmOutputHash);
  });
  await test('returned model differences are a review warning', () => {
    const [a, b] = measured(); b.rows[0].actualModel = 'other-synthetic-fixture';
    assert.equal(review.compareToneRuns(a, b).pairs[0].returnedModelMismatch, true);
  });
  await test('HTML escapes text and contains no executable scripts or external assets', () => {
    const [a, b] = measured(); b.rows[0].comment.body = '<script>window.evil=1</script><img src="https://example.invalid/x">';
    const html = review.renderReport(review.compareToneRuns(a, b));
    assert.ok(html.includes('&lt;script&gt;')); assert.ok(!/<script\b|<img\b|<iframe\b/i.test(html));
    assert.match(html, /default-src 'none'/); assert.match(html, /grid-template-columns:1fr/);
  });
  await test('counts cannot claim more completed attempts than recorded rows', () => {
    const [a, b] = measured(); b.providerCallsAttempted = 7;
    assert.throws(() => review.compareToneRuns(a, b), /ATTEMPT_COUNT/);
  });
  await test('comparison CLI is read-only and will not overwrite a prior directory', () => {
    const [a, b] = pair(), direct = path.join(temp, 'direct.json'), warm = path.join(temp, 'warm.json');
    fs.writeFileSync(direct, JSON.stringify(a)); fs.writeFileSync(warm, JSON.stringify(b));
    const out = path.join(temp, 'compared');
    review.main([`--direct=${direct}`, `--warm=${warm}`, `--out=${out}`]);
    assert.ok(fs.existsSync(path.join(out, 'report.html')));
    assert.equal(JSON.parse(fs.readFileSync(direct)).providerCallsAttempted, 0);
    assert.throws(() => review.main([`--direct=${direct}`, `--warm=${warm}`, `--out=${out}`]));
    assert.throws(() => review.main([`--direct=${direct}`, `--warm=${warm}`, `--out=${out}2`, '--live=true']));
  });
  await test('explicit CLI tone overrides legacy environment without reading API secrets', async () => {
    const old = process.env.ONEPICK_QA_TONE;
    try {
      process.env.ONEPICK_QA_TONE = 'direct'; const out = path.join(temp, 'warm-plan');
      const env = new Proxy({}, { get() { assert.fail('plan must not read credentials'); } });
      await qa.main(['plan', '--tone=warm', '--repeats=1', `--out=${out}`], env);
      assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'results.json'))).plan.tone, 'warm');
      await assert.rejects(qa.main(['plan', '--tone=unknown', `--out=${out}2`], env));
    } finally { if (old === undefined) delete process.env.ONEPICK_QA_TONE; else process.env.ONEPICK_QA_TONE = old; }
  });
  await test('runner refuses a direct plan handed to the warm runtime before any request', async () => {
    await assert.rejects(qa.execute(plans.direct, runtimes.warm, { mode: 'mock', approvedCalls: 8,
      key: 'synthetic-not-a-secret', fetcher: async () => assert.fail('must not send') }), /PLAN_CHANGED/);
  });
  console.log(`${passed} tone identity/paired review checks passed. Actual provider calls: zero.`);
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { global.fetch = originalFetch; fs.rmSync(temp, { recursive: true, force: true }); });
