// Actual production prompt/request/validators with fake transport, never real API calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadProduction, sha256 } = require('../../qa/profile-ai-runtime.cjs');
const qa = require('../../qa/run-profile-ai-quality.cjs');
const dataset = require('../../qa/profile-ai-quality-cases.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'onepick-ai-qa-'));
const originalFetch = global.fetch;
global.fetch = async () => { throw new Error('NETWORK_MUST_NOT_BE_USED'); };
const runtime = loadProduction();
const goodComment = { summary: '선택 이유가 구체적으로 이어지는 목록',
  body: '영화에서는 작은 단서를, 볼펜에서는 끊기지 않는 필기감을 좋아한다고 적었네요. 적어둔 이유에서는 세부적인 사용감에 주목하는 공통점이 보여요.',
  keywords: ['선택이유', '사용감', '작은차이'] };
const envelope = (comment = goodComment) => ({ id: 'resp_synthetic', model: 'synthetic-model', status: 'completed',
  usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30, input_tokens_details: { cached_tokens: 0 } },
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(comment) }] }] });
const run = (fetcher, options = {}, plan = qa.createPlan(runtime, 1)) =>
  qa.execute(plan, runtime, { mode: 'mock', approvedCalls: plan.maximumCalls, key: 'synthetic-secret-for-tests', fetcher, ...options });
let passed = 0;
async function test(name, action) { await action(); passed++; console.log(`PASS ${name}`); }
(async () => {
  await test('default plan has 8 ten-pick cases and 24 unique runs, no results invented', () => {
    const plan = qa.createPlan(runtime), result = qa.emptyRun(plan);
    assert.equal(plan.maximumCalls, 24); assert.equal(plan.maximumOutputTokensTotal, 24 * 1600);
    assert.equal(result.rows.length, 24); assert.equal(new Set(result.rows.map((r) => r.key)).size, 24);
    assert.equal(result.providerCallsAttempted, 0); assert.equal(result.qualityVerdict, 'not_evaluated');
    assert.ok(result.rows.every((r) => r.comment === null && r.usage === null && r.status === 'not_attempted'));
  });
  await test('plan command never reads credentials even if supplied in the environment', async () => {
    const env = new Proxy({}, { get() { assert.fail('plan must not read environment values'); } });
    const out = path.join(temp, 'plan'); await qa.main(['plan', `--out=${out}`], env);
    const result = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
    assert.equal(result.mode, 'plan'); assert.equal(result.providerCallsAttempted, 0);
    assert.ok(fs.existsSync(path.join(out, 'report.html')));
  });
  await test('repeat/call limits and CLI typos cannot expand paid execution', async () => {
    for (const repeats of [0, 4, 1.5, NaN, Infinity]) assert.throws(() => qa.createPlan(runtime, repeats));
    for (const args of [ ['run', '--out=x'], ['run', '--out=x', '--confirm-live-calls=999'],
      ['plan', '--out=x', '--api-key=never'], ['plan', '--out=x', '--live=true'] ]) {
      await assert.rejects(qa.main(args, {}));
    }
  });
  await test('live execution is blocked in CI and without a key', async () => {
    await assert.rejects(qa.main(['run', `--out=${temp}/ci`, '--confirm-live-calls=24'], { CI: 'true', OPENAI_API_KEY: 'never-read' }), /CI/);
    await assert.rejects(qa.main(['run', `--out=${temp}/nokey`, '--confirm-live-calls=24'], {}), /KEY_REQUIRED/);
    assert.equal(fs.existsSync(`${temp}/ci`), false); assert.equal(fs.existsSync(`${temp}/nokey`), false);
  });
  await test('old output directories cannot be overwritten', async () => {
    const out = path.join(temp, 'existing'); fs.mkdirSync(out); fs.writeFileSync(`${out}/keep`, 'old-run');
    await assert.rejects(qa.main(['plan', `--out=${out}`], {}));
    assert.equal(fs.readFileSync(`${out}/keep`, 'utf8'), 'old-run');
  });
  await test('request matches production parameters and excludes evaluator targets', () => {
    const request = runtime.build(dataset.cases[0].picks);
    assert.equal(request.model, 'gpt-5.6-terra'); assert.equal(request.store, false);
    assert.equal(request.reasoning.effort, 'low'); assert.equal(request.max_output_tokens, 1600);
    assert.equal(request.text.format.strict, true);
    assert.equal(JSON.parse(request.input).picks.length, 10);
    assert.ok(!JSON.stringify(request).includes(dataset.cases[0].editorialReference.body));
    assert.ok(!JSON.stringify(request).includes(dataset.cases[0].expectations[0]));
    const safe = runtime.build([{ ...dataset.cases[0].picks[0], accountId: 'not-sent', photo: 'not-sent', SNS: 'not-sent' }]);
    assert.ok(!safe.input.includes('not-sent'));
  });
  await test('24 fake responses are recorded and never mislabeled as live model quality', async () => {
    const plan = qa.createPlan(runtime); const requests = [], checkpoints = [];
    const result = await run(async (url, options) => {
      requests.push([url, options]); assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.redirect, 'error'); assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-secret-for-tests');
      return Response.json(envelope());
    }, { checkpoint: (value) => checkpoints.push(value) }, plan);
    assert.equal(requests.length, 24); assert.equal(result.providerCallsAttempted, 24);
    assert.equal(result.mode, 'mock'); assert.equal(result.qualityVerdict, 'mock_not_model_quality');
    assert.ok(result.rows.every((r) => r.status === 'output_received' && r.automaticCheck === 'pass'));
    assert.equal(result.rows[0].usage.outputTokens, 20); assert.equal(result.rows[0].actualModel, 'synthetic-model');
    assert.ok(!JSON.stringify(checkpoints).includes('synthetic-secret-for-tests'));
    assert.ok(checkpoints.some((c) => c.rows[0].status === 'attempted'));
    const form = qa.reviewTemplate(result);
    assert.ok(form.rows.every((r) => r.verdict === null && r.checks.groundedInReasons === null));
    assert.ok(qa.pairing(result).every((p) => p.reviewHint === 'similar_wording_review'));
  });
  await test('fake transport cannot be labeled as live output', async () => {
    await assert.rejects(run(async () => Response.json(envelope()), { mode: 'live' }), /CUSTOM_TRANSPORT/);
  });
  await test('a modified plan cannot substitute inputs or duplicate targets', async () => {
    const plan = qa.createPlan(runtime, 1); plan.cases[0].picks[0].review = 'modified';
    await assert.rejects(run(async () => { assert.fail('no request'); }, {}, plan), /PLAN_CHANGED/);
  });
  for (const status of [401, 403, 404, 429, 500, 503]) {
    await test(`HTTP ${status} stops without retries and does not leak error bodies`, async () => {
      let calls = 0; const result = await run(async () => { calls++; return new Response('synthetic-secret-for-tests', { status }); });
      assert.equal(calls, 1); assert.equal(result.rows[0].status, `http_${status}`);
      assert.equal(result.rows.filter((r) => r.status === 'not_attempted').length, 7);
      assert.ok(!JSON.stringify(result).includes('synthetic-secret-for-tests'));
    });
  }
  await test('transport rejection stops the suite and hides arbitrary errors', async () => {
    const result = await run(async () => { throw new Error('synthetic-secret-for-tests'); });
    assert.equal(result.providerCallsAttempted, 1); assert.equal(result.rows[0].status, 'QA_TRANSPORT_OR_VALIDATION_FAILED');
    assert.ok(!JSON.stringify(result).includes('synthetic-secret-for-tests'));
  });
  await test('timeout bounds fetch implementations that ignore cancellation', async () => {
    let signal; const result = await run(async (_url, options) => { signal = options.signal; return new Promise(() => {}); }, { timeoutMs: 10 });
    assert.equal(result.rows[0].status, 'QA_TIMEOUT'); assert.equal(signal.aborted, true);
    assert.equal(result.providerCallsAttempted, 1);
  });
  await test('response body timeout and size limit prevent unbounded reads', async () => {
    const slow = await run(async () => new Response(new ReadableStream({ start() {} })), { timeoutMs: 10 });
    assert.equal(slow.rows[0].status, 'QA_TIMEOUT');
    const huge = await run(async () => new Response('x'.repeat(262145)));
    assert.equal(huge.rows[0].status, 'QA_RESPONSE_TOO_LARGE');
  });
  for (const [name, payload, expected] of [
    ['truncated response', { ...envelope(), status: 'incomplete' }, 'QA_INCOMPLETE'],
    ['provider refusal', { ...envelope(), output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'declined' }] }] }, 'QA_REFUSED_OR_EMPTY'],
    ['malformed output JSON', { ...envelope(), output: [{ type: 'message', content: [{ type: 'output_text', text: '{' }] }] }, 'QA_INVALID_JSON'],
    ['extra output field', envelope({ ...goodComment, age: 'not-allowed' }), 'QA_SCHEMA_FAILED'],
    ['two keywords', envelope({ ...goodComment, keywords: ['하나', '둘'] }), 'QA_SCHEMA_FAILED'],
    ['excluded wording', envelope({ ...goodComment, body: '나이는 모르겠지만 선택을 읽었어요.' }), 'AI_REVIEW_AGE_EXCLUDED'],
  ]) {
    await test(`${name} cannot be counted as an automatic pass`, async () => {
      const result = await run(async () => Response.json(payload));
      assert.ok(result.rows.every((r) => r.status === expected && r.automaticCheck === 'fail' && r.comment === null));
    });
  }
  await test('normal catalog names survive the actual age guard', () => {
    assert.equal(runtime.validate(envelope({ ...goodComment, body: '나이브스 아웃의 단서를 좋아한다고 적었네요.' })).body,
      '나이브스 아웃의 단서를 좋아한다고 적었네요.');
  });
  await test('unknown usage is not invented as zero tokens', async () => {
    const response = envelope(); delete response.usage;
    const result = await run(async () => Response.json(response));
    assert.equal(result.rows[0].usage, null);
    assert.deepEqual(qa.usageOf({ input_tokens: -1, output_tokens: '20' }), {
      inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, reasoningTokens: null });
  });
  await test('secret echo is redacted rather than persisted as a comment', async () => {
    const result = await run(async () => Response.json(envelope({ ...goodComment, body: 'synthetic-secret-for-tests' })));
    assert.equal(result.rows[0].status, 'QA_SECRET_ECHO_REDACTED');
    assert.ok(!JSON.stringify(result).includes('synthetic-secret-for-tests'));
  });
  await test('HTML report is inert even with adversarial text', () => {
    const result = qa.emptyRun(qa.createPlan(runtime, 1));
    result.plan.cases[0].label = '<script>alert(1)</script>';
    const html = qa.renderReport(result);
    assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes("default-src 'none'")); assert.ok(html.includes('실제 모델 호출 0'));
  });
  await test('comparison aligns input identity and preserves failures', async () => {
    const a = await run(async () => Response.json(envelope()));
    const b = await run(async () => new Response('failed', { status: 503 }));
    const comparison = qa.compareRuns(a, b);
    assert.equal(comparison.rows.length, 8); assert.equal(comparison.rows[0].after, 'http_503');
    assert.equal(comparison.rows[1].after, 'not_attempted');
    assert.equal(comparison.humanMeaningVerdict, 'not_automatically_graded');
    assert.throws(() => qa.compareRuns(qa.emptyRun(qa.createPlan(runtime, 1)), b), /MEASURED/);
    b.plan.datasetHash = 'different'; assert.throws(() => qa.compareRuns(a, b), /INPUTS/);
  });
  await test('changed production settings remain comparable only with identical test input', () => {
    const original = qa.createPlan(runtime, 1);
    const variant = { ...runtime, model: 'synthetic-other-model', sourceHashes: { ...runtime.sourceHashes, 'index.ts': 'changed' },
      build: (picks) => ({ ...runtime.build(picks), model: 'synthetic-other-model' }) };
    const changed = qa.createPlan(variant, 1);
    assert.equal(original.datasetHash, changed.datasetHash);
    assert.notEqual(original.fingerprint, changed.fingerprint);
    assert.notEqual(original.cases[0].requestHash, changed.cases[0].requestHash);
  });
  await test('source hashes identify the exact production files rather than hand-copied settings', () => {
    const root = path.resolve(__dirname, '../../supabase/functions/analyze-profile-taste');
    for (const [name, hash] of Object.entries(runtime.sourceHashes)) assert.equal(hash, sha256(fs.readFileSync(path.join(root, name))));
  });
  await test('production refactors fail before requests instead of using stale QA settings', () => {
    const root = path.join(temp, 'changed-source');
    const dir = path.join(root, 'supabase/functions/analyze-profile-taste'); fs.mkdirSync(dir, { recursive: true });
    const original = path.resolve(__dirname, '../../supabase/functions/analyze-profile-taste');
    for (const name of ['index.ts', 'quality.ts', 'contract.ts']) fs.copyFileSync(path.join(original, name), path.join(dir, name));
    const index = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
    fs.writeFileSync(path.join(dir, 'index.ts'), index.replace('store: false,', 'store: true,'));
    assert.throws(() => loadProduction(root), /CONTRACT_CHANGED/);
    fs.writeFileSync(path.join(dir, 'index.ts'), index.replace('function cleanResult(', 'function renamedCleanResult('));
    assert.throws(() => loadProduction(root), /CONTRACT_CHANGED/);
  });
  await test('an unapproved number of requests cannot contact the provider', async () => {
    await assert.rejects(run(async () => { assert.fail('no request'); }, { approvedCalls: 1 }), /APPROVAL_REQUIRED/);
  });
  console.log(`${passed} QA runner/adapter safeguards passed. All provider responses mocked; actual model quality NOT measured.`);
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { global.fetch = originalFetch; fs.rmSync(temp, { recursive: true, force: true }); });
