const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = readFileSync(path.join(__dirname, '../src/lib/profileAiStatus.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const local = { exports: {} };
new Function('module', 'exports', 'require', compiled)(local, local.exports, require);
const {
  parseProfileAiStatus, readProfileAiStatus, canRequestProfileAiGeneration,
  EXPECTED_PROFILE_AI_CONTRACT_VERSION, EXPECTED_PROFILE_AI_MIN_PICKS,
  EXPECTED_PROFILE_AI_PROMPT_VERSION, EXPECTED_PROFILE_AI_COOLDOWN_SECONDS,
} = local.exports;
const base = 'https://example.supabase.co';
const payload = {
  service: 'analyze-profile-taste', status: 'ok', configured: true,
  contractVersion: EXPECTED_PROFILE_AI_CONTRACT_VERSION,
  minimumPicks: EXPECTED_PROFILE_AI_MIN_PICKS,
  promptVersion: EXPECTED_PROFILE_AI_PROMPT_VERSION,
  cooldownSeconds: EXPECTED_PROFILE_AI_COOLDOWN_SECONDS,
};
let passed = 0;
async function test(name, action) { await action(); passed++; console.log(`PASS ${name}`); }

(async () => {
  await test('current contract is compatible whether configured or not', () => {
    assert.equal(parseProfileAiStatus(payload).compatible, true);
    const unconfigured = parseProfileAiStatus({ ...payload, configured: false });
    assert.equal(unconfigured.compatible, true); assert.equal(unconfigured.configured, false);
  });
  await test('legacy deployed payload stays reachable but incompatible', () => {
    assert.deepEqual(parseProfileAiStatus({ service: 'analyze-profile-taste', status: 'ok', configured: true }), {
      configured: true, compatible: false, contractVersion: null,
      minimumPicks: null, promptVersion: null, cooldownSeconds: null,
    });
  });
  await test('any contract mismatch disables generation', () => {
    for (const changed of [
      { contractVersion: 'profile-ai-v1' }, { minimumPicks: 3 },
      { promptVersion: 'taste-v3' }, { cooldownSeconds: 300 },
    ]) assert.equal(parseProfileAiStatus({ ...payload, ...changed }).compatible, false);
  });
  await test('partial or malformed contract fields fail closed', () => {
    for (const value of [
      null, [], {}, 'ok', { ...payload, service: 'other' }, { ...payload, status: 'error' },
      { ...payload, configured: 'true' }, { ...payload, minimumPicks: '10' },
      { service: 'analyze-profile-taste', status: 'ok', configured: true, contractVersion: 'profile-ai-v2' },
    ]) assert.throws(() => parseProfileAiStatus(value), /AI_STATUS_INVALID/);
  });
  await test('unexpected fields are not retained', () => {
    const result = parseProfileAiStatus({ ...payload, secret: 'never-cache-me' });
    assert.equal(result.secret, undefined); assert.equal(result.compatible, true);
  });
  await test('uses public GET without credentials or body', async () => {
    let calls = 0;
    const result = await readProfileAiStatus(base, { fetcher: async (url, options) => {
      calls++; assert.equal(url, base + '/functions/v1/analyze-profile-taste/status');
      assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit');
      assert.equal(options.cache, 'no-store'); assert.equal(options.body, undefined);
      assert.deepEqual(options.headers, { Accept: 'application/json' });
      return Response.json(payload);
    } });
    assert.equal(calls, 1); assert.equal(result.compatible, true);
  });
  await test('HTTP, JSON and network failures cannot enable generation', async () => {
    await assert.rejects(readProfileAiStatus(base, { fetcher: async () => Response.json(payload, { status: 503 }) }), /AI_STATUS_UNAVAILABLE/);
    await assert.rejects(readProfileAiStatus(base, { fetcher: async () => new Response('<html>error</html>') }));
    await assert.rejects(readProfileAiStatus(base, { fetcher: async () => { throw new Error('OFFLINE'); } }), /OFFLINE/);
  });
  await test('aborted request never contacts the server', async () => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(readProfileAiStatus(base, { signal: controller.signal,
      fetcher: async () => { assert.fail('must not fetch'); } }), /AI_STATUS_CANCELLED/);
  });
  await test('timeout bounds fetch and response body', async () => {
    let requestSignal;
    await assert.rejects(readProfileAiStatus(base, { timeoutMs: 10, fetcher: async (_url, opts) => {
      requestSignal = opts.signal; return new Promise(() => {});
    } }), /AI_STATUS_TIMEOUT/);
    assert.equal(requestSignal.aborted, true);
    await assert.rejects(readProfileAiStatus(base, { timeoutMs: 10,
      fetcher: async () => ({ ok: true, json: () => new Promise(() => {}) }) }), /AI_STATUS_TIMEOUT/);
  });
  await test('account/screen cancellation aborts an in-flight status read', async () => {
    const controller = new AbortController(); let requestSignal;
    const pending = readProfileAiStatus(base, { signal: controller.signal, fetcher: async (_url, opts) => {
      requestSignal = opts.signal; return new Promise(() => {});
    } });
    controller.abort(); await assert.rejects(pending, /AI_STATUS_CANCELLED/);
    assert.equal(requestSignal.aborted, true);
  });
  await test('owner, count, configuration and compatibility are all required', () => {
    const ready = { isOwner: true, publicPickCount: 10, minimumPickCount: 10,
      configured: true, compatible: true, statusError: false, statusPending: false };
    assert.equal(canRequestProfileAiGeneration(ready), true);
    for (const change of [
      { isOwner: false }, { publicPickCount: 9 }, { publicPickCount: NaN },
      { configured: undefined }, { configured: false }, { compatible: undefined },
      { compatible: false }, { statusError: true }, { statusPending: true },
    ]) assert.equal(canRequestProfileAiGeneration({ ...ready, ...change }), false);
  });
  await test('rejects invalid timeout instead of leaving a request running', async () => {
    for (const timeoutMs of [0, -1, Infinity, NaN]) {
      await assert.rejects(readProfileAiStatus(base, { timeoutMs }), /AI_STATUS_TIMEOUT_INVALID/);
    }
  });
  const serverContract = readFileSync(path.join(__dirname, '../../supabase/functions/analyze-profile-taste/contract.ts'), 'utf8');
  const quality = readFileSync(path.join(__dirname, '../../supabase/functions/analyze-profile-taste/quality.ts'), 'utf8');
  await test('client expectations match server source constants', () => {
    assert.match(serverContract, new RegExp(`PROFILE_AI_CONTRACT_VERSION = '${EXPECTED_PROFILE_AI_CONTRACT_VERSION}'`));
    assert.match(serverContract, new RegExp(`PROFILE_AI_MIN_PICKS = ${EXPECTED_PROFILE_AI_MIN_PICKS}`));
    assert.match(serverContract, /PROFILE_AI_COOLDOWN_SECONDS = 10 \* 60/);
    assert.ok(quality.includes(`TASTE_PROMPT_VERSION = '${EXPECTED_PROFILE_AI_PROMPT_VERSION}'`));
  });
  console.log(`${passed} AI readiness/contract tests passed.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
