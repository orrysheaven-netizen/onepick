import { inspectRequest } from './request.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const url = 'https://example.invalid/functions/v1/analyze-profile-taste';
const noEnv = () => undefined;
const forbidEnv = () => { throw new Error('This route must not inspect configuration'); };

Deno.test('status reports missing configuration without returning secrets', async () => {
  const result = inspectRequest(new Request(`${url}/status`), noEnv);
  assert(result instanceof Response && result.status === 200, 'Expected status response');
  assert(result.headers.get('Cache-Control') === 'no-store', 'Readiness must not be cached');
  const body = await result.json();
  assert(body.configured === false && body.service === 'analyze-profile-taste', 'Expected missing config');
  assert(Object.keys(body).sort().join(',') === 'configured,service,status', 'Unexpected public data');
});
Deno.test('status reports presence only and never echoes supplied secrets', async () => {
  const secret = 'private-test-value-do-not-echo';
  const result = inspectRequest(new Request(`${url}/status`), () => secret);
  assert(result instanceof Response, 'Expected response');
  const text = await result.text();
  assert(!text.includes(secret), 'Secret leaked');
  assert(JSON.parse(text).configured === true, 'Expected configured');
});
Deno.test('empty and whitespace secrets are not configured', async () => {
  const result = inspectRequest(new Request(`${url}/status/`), (name) => name === 'OPENAI_API_KEY' ? '   ' : 'present');
  assert(result instanceof Response, 'Expected response');
  assert((await result.json()).configured === false, 'Whitespace must not count');
});
Deno.test('OPTIONS has no configuration or generation side effects', () => {
  const result = inspectRequest(new Request(url, { method: 'OPTIONS' }), forbidEnv);
  assert(result instanceof Response && result.status === 204, 'Expected CORS preflight');
});
Deno.test('unsupported methods and status POST cannot generate', () => {
  for (const [path, method] of [[url, 'GET'], [url, 'PUT'], [url, 'DELETE'], [`${url}/status`, 'POST']]) {
    const result = inspectRequest(new Request(path, { method }), forbidEnv);
    assert(result instanceof Response && result.status === 405, 'Expected method rejection');
  }
});
Deno.test('missing and malformed bearer headers fail before configuration is read', () => {
  for (const value of ['', 'Basic abc', 'Bearer', 'Bearer a b', `Bearer ${'x'.repeat(8200)}`]) {
    const result = inspectRequest(new Request(url, { method: 'POST', headers: { Authorization: value } }), forbidEnv);
    assert(result instanceof Response && result.status === 401, 'Expected auth rejection');
  }
});
Deno.test('bearer syntax is forwarded for real token validation, not treated as authenticated', () => {
  const result = inspectRequest(new Request(url, { method: 'POST', headers: { Authorization: 'bearer unverified-token' } }), forbidEnv);
  assert(!(result instanceof Response) && result.authorization === 'Bearer unverified-token', 'Token must reach getUser validation');
});
