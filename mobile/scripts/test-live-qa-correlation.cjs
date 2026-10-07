const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real event handler without browser/network dependencies.
const source = fs.readFileSync(path.join(__dirname, '../../tools/qa/live-qa.mjs'), 'utf8');
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing QA section: ${start}`);
  return source.slice(from, to);
};
const context = { URL };
vm.createContext(context);
vm.runInContext(`const SUPABASE_HOST = /\\.supabase\\.co$/;\n`
  + section('function safeUrl(', '// Split one request')
  + section('function splitTiming(', 'const connectMs')
  + section('function instrument(', 'async function settle(')
  + ';this.instrument = instrument;', context);

async function collect(headers, options = {}) {
  const handlers = {};
  const log = context.instrument({ on: (event, callback) => { handlers[event] = callback; } });
  await handlers.requestfinished({
    method: () => options.method || 'GET',
    url: () => options.url || 'https://example.supabase.co/rest/v1/categories?apikey=SECRET_KEY&filter=PRIVATE_FILTER',
    response: async () => options.noResponse ? null : ({
      status: () => 200,
      allHeaders: async () => {
        if (options.headerFailure) throw new Error('header unavailable');
        return headers;
      },
    }),
    timing: () => ({
      startTime: options.startTime === undefined ? 1791415102000 : options.startTime,
      requestStart: 1, responseStart: 20, responseEnd: 25,
      domainLookupStart: -1, domainLookupEnd: -1, connectStart: -1,
      connectEnd: -1, secureConnectionStart: -1,
    }),
  });
  return JSON.parse(JSON.stringify(log));
}

(async () => {
  const sb = '01a118a9-b2a4-7d04-a862-6dec21520d2b';
  let log = await collect({ 'sb-request-id': sb, 'cf-ray': 'a470a0bdc9564ba2-LAX' });
  assert.equal(log.api[0].requestId, sb, 'Hosted Supabase request id must be retained');
  assert.equal(log.api[0].cfRay, 'a470a0bdc9564ba2-LAX');
  assert.equal(log.api[0].startedAt, '2026-10-07T23:18:22.000Z');
  assert.equal(log.api[0].serverMs, 19);
  assert.equal(log.api[0].downloadMs, 5);
  assert.equal(log.api[0].ms, 25);
  assert.equal((await collect({ 'sb-request-id': sb, 'x-request-id': 'proxy-id' })).api[0].requestId, sb);
  assert.equal((await collect({ 'x-request-id': 'proxy-id' })).api[0].requestId, 'proxy-id');
  for (const bad of ['', 'bad\nvalue', 'a'.repeat(101), 123]) {
    assert.equal((await collect({ 'sb-request-id': bad, 'x-request-id': 'proxy-id' })).api[0].requestId, 'proxy-id');
    const row = (await collect({ 'sb-request-id': bad, 'x-request-id': bad, 'cf-ray': bad })).api[0];
    assert.equal(row.requestId, null);
    assert.equal(row.cfRay, null);
  }
  for (const options of [{}, { noResponse: true }, { headerFailure: true }]) {
    const row = (await collect({}, options)).api[0];
    assert.equal(row.requestId, null);
    assert.equal(row.cfRay, null);
    assert.equal(row.ms, 25, 'Missing headers must not drop timing');
  }
  assert.equal((await collect({}, { startTime: -1 })).api[0].startedAt, null);
  assert.equal((await collect({}, { method: 'OPTIONS' })).api.length, 0);
  assert.equal((await collect({}, { url: 'https://example.com/api' })).api.length, 0);
  log = await collect({
    'sb-request-id': sb, authorization: 'PRIVATE_AUTH', apikey: 'SECRET_KEY',
    cookie: 'PRIVATE_COOKIE', 'set-cookie': 'PRIVATE_SET_COOKIE', 'x-user-id': 'PRIVATE_USER',
  });
  const serialized = JSON.stringify(log);
  for (const secret of ['PRIVATE_AUTH', 'SECRET_KEY', 'PRIVATE_COOKIE', 'PRIVATE_SET_COOKIE', 'PRIVATE_USER', 'PRIVATE_FILTER']) {
    assert.ok(!serialized.includes(secret), `Sensitive metadata leaked: ${secret}`);
  }
  console.log('live QA correlation: hosted/proxy IDs, missing/invalid headers, timing, filtering and privacy passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
