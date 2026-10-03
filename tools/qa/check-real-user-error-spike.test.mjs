import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateRows, runQuery } from './check-real-user-error-spike.mjs';

function row(overrides = {}) {
  return {
    kind: 'client_error',
    name: 'home',
    detail: 'FETCH_FAILED',
    platform: 'web',
    last_complete_hour: 0,
    same_hour_prev_7d: 0,
    error_code_same_hour_prev_7d: 0,
    error_code_prev_7d: 0,
    current_hour_start: '2026-09-24T03:00:00.000Z',
    current_hour_end: '2026-09-24T04:00:00.000Z',
    ...overrides,
  };
}

test('alerts on a new error code', () => {
  const alerts = evaluateRows([row({ last_complete_hour: 2 })]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].errorCode, 'FETCH_FAILED');
  assert.deepEqual(alerts[0].reasons, ['new_error_code', 'three_x_spike']);
  assert.equal(alerts[0].currentCount, 2);
  assert.equal(alerts[0].baselineAverage, 0);
  assert.equal(alerts[0].ratio, null);
});

test('alerts only when a known code is more than three times the matching-hour average', () => {
  const spike = evaluateRows([row({
    last_complete_hour: 7,
    error_code_same_hour_prev_7d: 14,
    error_code_prev_7d: 20,
  })]);
  assert.equal(spike.length, 1);
  assert.deepEqual(spike[0].reasons, ['three_x_spike']);
  assert.equal(spike[0].baselineAverage, 2);
  assert.equal(spike[0].ratio, 3.5);

  const exactlyThree = evaluateRows([row({
    last_complete_hour: 6,
    error_code_same_hour_prev_7d: 14,
    error_code_prev_7d: 20,
  })]);
  assert.equal(exactlyThree.length, 0);
});

test('aggregates the same error code across contexts and platforms', () => {
  const alerts = evaluateRows([
    row({ name: 'home', platform: 'web', last_complete_hour: 3, error_code_same_hour_prev_7d: 14, error_code_prev_7d: 12 }),
    row({ name: 'explore', platform: 'ios', last_complete_hour: 4, error_code_same_hour_prev_7d: 14, error_code_prev_7d: 12 }),
  ]);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].currentCount, 7);
  assert.equal(alerts[0].baselineAverage, 2);
  assert.equal(alerts[0].locations.length, 2);
});

test('ignores product analytics rows and codes with no events in the completed hour', () => {
  const alerts = evaluateRows([
    row({ last_complete_hour: 0, error_code_same_hour_prev_7d: 14, error_code_prev_7d: 20 }),
    { ...row({ last_complete_hour: 100 }), kind: 'product_event', detail: '-' },
  ]);
  assert.equal(alerts.length, 0);
});

test('redacts identifier-shaped fields instead of forwarding arbitrary text', () => {
  const alerts = evaluateRows([row({
    detail: 'DROP TABLE --',
    name: '<script>alert(1)</script>',
    platform: 'web mobile',
    last_complete_hour: 1,
  })]);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].errorCode, 'redacted-invalid');
  assert.deepEqual(alerts[0].locations[0], {
    context: 'redacted-invalid',
    platform: 'redacted-invalid',
    count: 1,
  });
});

test('queries with the DB credential and the dedicated hourly SQL', async (t) => {
  const original = process.env.SUPABASE_ACCESS_TOKEN;
  const edgeOriginal = process.env.SUPABASE_QA_ACCESS_TOKEN;
  t.after(() => {
    if (original === undefined) delete process.env.SUPABASE_ACCESS_TOKEN;
    else process.env.SUPABASE_ACCESS_TOKEN = original;
    if (edgeOriginal === undefined) delete process.env.SUPABASE_QA_ACCESS_TOKEN;
    else process.env.SUPABASE_QA_ACCESS_TOKEN = edgeOriginal;
  });
  process.env.SUPABASE_ACCESS_TOKEN = ' test-db-credential ';
  process.env.SUPABASE_QA_ACCESS_TOKEN = 'test-edge-credential';
  const rows = Array.from({ length: 61 }, (_, i) => row({
    name: 'screen_' + i, last_complete_hour: 1,
    error_code_same_hour_prev_7d: 140, error_code_prev_7d: 140,
  }));
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(url.endsWith('/database/query/read-only'));
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-db-credential');
    const { query } = JSON.parse(options.body);
    assert.match(query, /public\.client_error_events/);
    assert.doesNotMatch(query, /public\.product_analytics_events/);
    assert.doesNotMatch(query, /limit\s+60\b/i);
    return { ok: true, json: async () => rows };
  });
  const alerts = evaluateRows(await runQuery());
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(alerts[0].currentCount, 61);
  assert.deepEqual(alerts[0].reasons, ['three_x_spike']);
});

test('rejects missing DB credential without falling back to the Edge credential', async (t) => {
  const original = process.env.SUPABASE_ACCESS_TOKEN;
  const edgeOriginal = process.env.SUPABASE_QA_ACCESS_TOKEN;
  t.after(() => {
    if (original === undefined) delete process.env.SUPABASE_ACCESS_TOKEN;
    else process.env.SUPABASE_ACCESS_TOKEN = original;
    if (edgeOriginal === undefined) delete process.env.SUPABASE_QA_ACCESS_TOKEN;
    else process.env.SUPABASE_QA_ACCESS_TOKEN = edgeOriginal;
  });
  delete process.env.SUPABASE_ACCESS_TOKEN;
  process.env.SUPABASE_QA_ACCESS_TOKEN = 'test-edge-only';
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('must not fetch without DB credential');
  });
  await assert.rejects(runQuery(), /^Error: SUPABASE_ACCESS_TOKEN is required$/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('reports a denied query without exposing the response body or credential', async (t) => {
  const original = process.env.SUPABASE_ACCESS_TOKEN;
  t.after(() => {
    if (original === undefined) delete process.env.SUPABASE_ACCESS_TOKEN;
    else process.env.SUPABASE_ACCESS_TOKEN = original;
  });
  process.env.SUPABASE_ACCESS_TOKEN = 'test-db-credential';
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false, status: 403,
    json: async () => { throw new Error('response body must not be read'); },
  }));
  await assert.rejects(runQuery(), /^Error: Supabase Management API 403$/);
});


test('workflow wiring keeps QA reads on the repository token without Production shadowing', () => {
  const hourly = fs.readFileSync(new URL('../../.github/workflows/real-user-error-alerts.yml', import.meta.url), 'utf8');
  const daily = fs.readFileSync(new URL('../../.github/workflows/daily-qa.yml', import.meta.url), 'utf8');

  assert.match(hourly, /SUPABASE_ACCESS_TOKEN:\s*\$\{\{ secrets\.SUPABASE_QA_ACCESS_TOKEN \}\}/);
  assert.doesNotMatch(hourly, /environment:\s*Production/);

  const dailyQaRefs = daily.match(/SUPABASE_ACCESS_TOKEN:\s*\$\{\{ secrets\.SUPABASE_QA_ACCESS_TOKEN \}\}/g) ?? [];
  assert.equal(dailyQaRefs.length, 2);
  assert.doesNotMatch(daily, /environment:\s*Production/);
});
