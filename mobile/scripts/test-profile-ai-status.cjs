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
const { parseProfileAiStatus, readProfileAiStatus, canRequestProfileAiGeneration } = local.exports;
const base = 'https://example.supabase.co';
const payload = { service: 'analyze-profile-taste', status: 'ok', configured: true };
let passed = 0;
async function test(name, action) { await action(); passed++; console.log(`PASS ${name}`); }

(async () => {
  await test('accepts configured and unconfigured responses', () => {
    assert.deepEqual(parseProfileAiStatus(payload), { configured: true });
    assert.deepEqual(parseProfileAiStatus({ ...payload, configured: false }), { configured: false });
  });
  await test('drops unexpected fields rather than storing them', () => {
    assert.deepEqual(parseProfileAiStatus({ ...payload, unexpected: 'not-retained' }), { configured: true });
  });
  await test('malformed payloads fail closed', () => {
    for (const value of [null, [], {}, 'ok', { ...payload, service: 'other' },
      { ...payload, status: 'error' }, { ...payload, configured: 'true' }, { ...payload, configured: 1 }]) {
      assert.throws(() => parseProfileAiStatus(value), /AI_STATUS_INVALID/);
    }
  });
  await test('uses public GET without any credentials or body', async () => {
    let calls = 0;
    const result = await readProfileAiStatus(base, { fetcher: async (url, options) => {
      calls++;
      assert.equal(url, base + '/functions/v1/analyze-profile-taste/status');
      assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit');
      assert.equal(options.cache, 'no-store'); assert.equal(options.body, undefined);
      assert.deepEqual(options.headers, { Accept: 'application/json' });
      return Response.json(payload);
    } });
    assert.equal(calls, 1); assert.deepEqual(result, { configured: true });
  });
  await test('HTTP failure cannot enable generation', async () => {
    await assert.rejects(readProfileAiStatus(base, { fetcher: async () => Response.json(payload, { status: 503 }) }), /AI_STATUS_UNAVAILABLE/);
  });
  await test('invalid JSON cannot enable generation', async () => {
    await assert.rejects(readProfileAiStatus(base, { fetcher: async () => new Response('<html>error</html>') }));
  });
  await test('network failure is not mistaken for missing configuration', async () => {
    await assert.rejects(readProfileAiStatus(base, { fetcher: async () => { throw new Error('OFFLINE'); } }), /OFFLINE/);
  });
  await test('aborted request never contacts the server', async () => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(readProfileAiStatus(base, { signal: controller.signal,
      fetcher: async () => { assert.fail('must not fetch'); } }), /AI_STATUS_CANCELLED/);
  });
  await test('timeout bounds even a fetch that ignores abort', async () => {
    let requestSignal;
    await assert.rejects(readProfileAiStatus(base, { timeoutMs: 10, fetcher: async (_url, opts) => {
      requestSignal = opts.signal; return new Promise(() => {});
    } }), /AI_STATUS_TIMEOUT/);
    assert.equal(requestSignal.aborted, true);
  });
  await test('timeout also bounds a stalled response body', async () => {
    await assert.rejects(readProfileAiStatus(base, { timeoutMs: 10,
      fetcher: async () => ({ ok: true, json: () => new Promise(() => {}) }) }), /AI_STATUS_TIMEOUT/);
  });
  await test('account/screen cancellation aborts an in-flight status read', async () => {
    const controller = new AbortController(); let requestSignal;
    const pending = readProfileAiStatus(base, { signal: controller.signal, fetcher: async (_url, opts) => {
      requestSignal = opts.signal; return new Promise(() => {});
    } });
    controller.abort();
    await assert.rejects(pending, /AI_STATUS_CANCELLED/);
    assert.equal(requestSignal.aborted, true);
  });
  await test('configuration true is necessary but not enough to allow a request', () => {
    const ready = { isOwner: true, publicPickCount: 3, minimumPickCount: 3,
      configured: true, statusError: false, statusPending: false };
    assert.equal(canRequestProfileAiGeneration(ready), true);
    for (const change of [{ isOwner: false }, { publicPickCount: 2 }, { publicPickCount: NaN },
      { configured: undefined }, { configured: false }, { statusError: true }, { statusPending: true }]) {
      assert.equal(canRequestProfileAiGeneration({ ...ready, ...change }), false);
    }
  });
  await test('rejects invalid timeout instead of leaving a request running', async () => {
    for (const timeoutMs of [0, -1, Infinity, NaN]) {
      await assert.rejects(readProfileAiStatus(base, { timeoutMs }), /AI_STATUS_TIMEOUT_INVALID/);
    }
  });
  console.log(`${passed} AI readiness tests passed.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
