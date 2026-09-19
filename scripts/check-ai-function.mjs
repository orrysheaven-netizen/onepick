// Non-destructive live probes: no real credentials, profile reads or AI calls.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const expected = 'https://ygoipwzakzdnkaaxyrgb.supabase.co/functions/v1/analyze-profile-taste';
const target = (process.env.ONEPICK_AI_SMOKE_URL ?? expected).replace(/\/+$/, '');
assert.equal(target, expected, 'This smoke script is restricted to the authorized OnePick development function');
const results = [];

async function request(path, options = {}) {
  return fetch(`${target}${path}`, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
}
async function check(name, run) {
  await run();
  results.push({ name, result: 'PASS' });
  console.log(`PASS ${name}`);
}
async function expectError(path, options, status, code) {
  const response = await request(path, options);
  assert.equal(response.status, status, `Unexpected HTTP status (${options.method ?? 'GET'})`);
  const body = await response.json();
  assert.deepEqual(body, { error: code }, 'Unexpected or excessive error response data');
}

async function main() {
  let configured = null;
  let contractCompatible = false;
  await check('status returns public liveness, configuration presence and optional compatibility contract', async () => {
    const response = await request('/status');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    const allowed = new Set(['configured','service','status','contractVersion','minimumPicks','promptVersion','cooldownSeconds']);
    for (const key of Object.keys(body)) assert.ok(allowed.has(key), `Unexpected status field: ${key}`);
    assert.equal(body.service, 'analyze-profile-taste');
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.configured, 'boolean');
    configured = body.configured;
    contractCompatible = body.contractVersion === 'profile-ai-v2' &&
      body.minimumPicks === 10 && body.promptVersion === 'taste-v5-no-age' &&
      body.cooldownSeconds === 600;
  });
  await check('root GET cannot trigger generation', () => expectError('', {}, 405, 'METHOD_NOT_ALLOWED'));
  await check('CORS preflight is handled without authentication', async () => {
    const response = await request('', { method: 'OPTIONS', headers: {
      Origin: 'https://onepick-5cl.pages.dev',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,apikey,content-type',
    } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.match(response.headers.get('access-control-allow-methods') ?? '', /POST/);
    assert.equal(await response.text(), '');
  });
  const body = JSON.stringify({ profile_id: '00000000-0000-0000-0000-000000000000' });
  await check('missing login is rejected before any generation', () =>
    expectError('', { method: 'POST', body }, 401, 'AUTH_REQUIRED'));
  await check('malformed authorization is rejected', () =>
    expectError('', { method: 'POST', body, headers: { Authorization: 'Basic invalid-smoke-value' } }, 401, 'AUTH_REQUIRED'));
  await check('bearer-shaped fake token is rejected by real Auth validation', () =>
    expectError('', { method: 'POST', body, headers: { Authorization: 'Bearer onepick-smoke-invalid-token' } }, 401, 'AUTH_REQUIRED'));
  await check('unsupported write method is rejected', () =>
    expectError('', { method: 'PUT', body }, 405, 'METHOD_NOT_ALLOWED'));
  await check('status POST cannot act as a generation bypass', () =>
    expectError('/status', { method: 'POST', body }, 405, 'METHOD_NOT_ALLOWED'));
  const report = {
    checkedAt: new Date().toISOString(), target,
    configurationPresent: configured,
    contractCompatible,
    providerConnectionTested: false,
    authenticatedGenerationTested: false,
    results,
  };
  await writeFile('ai-function-smoke.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`AI smoke failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
