import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateRows, runQuery } from './check-real-user-error-spike.mjs';
import { publishAlerts } from './publish-real-user-error-alerts.mjs';

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


function hourRow(hour, changes = {}) {
  const start = new Date(Date.UTC(2026, 9, 9, hour)).toISOString();
  const end = new Date(Date.UTC(2026, 9, 9, hour + 1)).toISOString();
  return row({ current_hour_start: start, current_hour_end: end, ...changes });
}

function exampleAlert(hour, code = 'FETCH_FAILED') {
  return evaluateRows([hourRow(hour, { detail: code, last_complete_hour: 3 })])[0];
}

function githubTestClient() {
  const issues = [];
  const comments = new Map();
  let failOnce = false;
  async function requestFn(url, opts = {}) {
    if (url.startsWith('/issues?') && !opts.method) {
      const page = Number(url.match(/[?&]page=(\d+)/)?.[1] || 1);
      return issues.slice((page - 1) * 100, page * 100);
    }
    const match = url.match(/^\/issues\/(\d+)\/comments/);
    if (match) {
      const issueNumber = Number(match[1]);
      const current = comments.get(issueNumber) || [];
      if (opts.method === 'POST') {
        if (failOnce) { failOnce = false; throw new Error('simulated failure'); }
        const comment = { body: JSON.parse(opts.body).body };
        current.push(comment);
        comments.set(issueNumber, current);
        return comment;
      }
      const page = Number(url.match(/[?&]page=(\d+)/)?.[1] || 1);
      return current.slice((page - 1) * 100, page * 100);
    }
    if (url === '/issues' && opts.method === 'POST') {
      const issue = { ...JSON.parse(opts.body), number: 2000 + issues.length, state: 'open' };
      issues.push(issue);
      return issue;
    }
    throw new Error('Unexpected GitHub path');
  }
  return { issues, comments, requestFn, failNext: () => { failOnce = true; } };
}

function testReport(alerts, generatedAt = '2026-10-09T06:22:00Z') {
  return { generatedAt, alerts, alertCount: alerts.length };
}

function testOptions(client) {
  return { requestFn: client.requestFn, repository: 'owner/repo', workflowUrl: 'https://github.com/owner/repo/actions/runs/123' };
}

test('five-hour scheduler gap evaluates each hour independently with original three-times threshold', () => {
  const rows = Array.from({ length: 5 }, (_, i) => hourRow(i, {
    last_complete_hour: (i === 1 || i === 4) ? 7 : 1,
    error_code_same_hour_prev_7d: 14,
    error_code_prev_7d: 20,
  }));
  const alerts = evaluateRows(rows);
  assert.deepEqual(alerts.map(a => a.windowEnd), [
    '2026-10-09T02:00:00.000Z', '2026-10-09T05:00:00.000Z',
  ]);
  assert.equal(alerts[0].currentCount, 7);
  assert.equal(evaluateRows([hourRow(3, {
    last_complete_hour: 6, error_code_same_hour_prev_7d: 14, error_code_prev_7d: 20,
  })]).length, 0);
});

test('hour-specific grouping preserves contexts without conflating consecutive hours', () => {
  const alerts = evaluateRows([
    hourRow(3, { name: 'home', last_complete_hour: 3, error_code_same_hour_prev_7d: 14, error_code_prev_7d: 10 }),
    hourRow(3, { name: 'explore', platform: 'ios', last_complete_hour: 4, error_code_same_hour_prev_7d: 14, error_code_prev_7d: 10 }),
    hourRow(4, { last_complete_hour: 3, error_code_same_hour_prev_7d: 14, error_code_prev_7d: 10 }),
  ]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].currentCount, 7);
  assert.equal(alerts[0].locations.length, 2);
});

test('window alignment validation and untrusted output sanitization', () => {
  assert.throws(() => evaluateRows([row({
    current_hour_end: '2026-10-09T04:30:00Z', last_complete_hour: 1,
  })]), /Invalid hourly QA window/);
  assert.throws(() => evaluateRows([row({
    current_hour_end: '2026-10-09T05:00:00Z', last_complete_hour: 1,
  })]), /exactly one hour/);
  const alerts = evaluateRows([hourRow(3, {
    last_complete_hour: 2, detail: '<script>', name: 'DROP TABLE', platform: 'web mobile',
  })]);
  assert.equal(alerts[0].errorCode, 'redacted-invalid');
  assert.equal(alerts[0].locations[0].context, 'redacted-invalid');
});

test('publisher batches 24-hour backfill by code and never comments twice for the same hour', async () => {
  const client = githubTestClient();
  const records = [exampleAlert(1), exampleAlert(2), exampleAlert(3)];
  assert.deepEqual(await publishAlerts(testReport(records), testOptions(client)),
    { newlyPublished: 3, skippedDuplicates: 0 });
  assert.equal(client.issues.length, 1);
  assert.deepEqual(await publishAlerts(testReport(records), testOptions(client)),
    { newlyPublished: 0, skippedDuplicates: 3 });
  assert.equal(client.comments.size, 0);
  assert.equal((await publishAlerts(testReport([...records, exampleAlert(4)]), testOptions(client))).newlyPublished, 1);
  assert.equal(client.comments.get(client.issues[0].number).length, 1);
  assert.equal((await publishAlerts(testReport([...records, exampleAlert(4)]), testOptions(client))).newlyPublished, 0);
});

test('publisher recognizes the legacy hour in issue body and does not replay it', async () => {
  const client = githubTestClient();
  client.issues.push({
    number: 1900, state: 'open',
    body: '<!-- onepick-real-user-error:error-code:FETCH_FAILED -->\n' +
      '- last completed hour: 2026-10-09T03:00:00.000+00:00 → 2026-10-09T04:00:00.000+00:00',
  });
  assert.equal((await publishAlerts(testReport([exampleAlert(3)]), testOptions(client))).newlyPublished, 0);
});

test('GitHub partial comment failure retries only unpublished hours', async () => {
  const client = githubTestClient();
  await publishAlerts(testReport([exampleAlert(2)]), testOptions(client));
  client.failNext();
  await assert.rejects(
    publishAlerts(testReport([exampleAlert(2), exampleAlert(3)]), testOptions(client)),
    /simulated failure/,
  );
  assert.equal((await publishAlerts(testReport([exampleAlert(2), exampleAlert(3)]), testOptions(client))).newlyPublished, 1);
  assert.equal(client.comments.get(client.issues[0].number).length, 1);
});

test('closed issues preserve dedupe windows, but a new hour creates another issue', async () => {
  const client = githubTestClient();
  await publishAlerts(testReport([exampleAlert(2)]), testOptions(client));
  client.issues[0].state = 'closed';
  assert.equal((await publishAlerts(testReport([exampleAlert(2)]), testOptions(client))).newlyPublished, 0);
  assert.equal((await publishAlerts(testReport([exampleAlert(2), exampleAlert(3)]), testOptions(client))).newlyPublished, 1);
  assert.equal(client.issues.length, 2);
});

test('publisher rejects stale or future windows before accessing GitHub', async () => {
  const client = githubTestClient();
  await assert.rejects(
    publishAlerts(testReport([exampleAlert(1)], '2026-10-10T10:30:00.000Z'), testOptions(client)),
    /outside the bounded completed-hour lookback/,
  );
  assert.equal(client.issues.length, 0);
});

test('publisher accepts all 24 SQL hours when report generation crosses the UTC hour', async () => {
  const client = githubTestClient();
  // SQL executes at 05:59:59Z; generatedAt is written after the boundary.
  // The oldest completed window ends at 2026-10-08T06:00:00Z.
  const alerts = Array.from({ length: 24 }, (_, index) => exampleAlert(index - 19));
  const report = testReport(alerts, '2026-10-09T06:00:10.000Z');
  assert.deepEqual(await publishAlerts(report, testOptions(client)),
    { newlyPublished: 24, skippedDuplicates: 0 });
  assert.equal(client.issues.length, 1);
  assert.deepEqual(await publishAlerts(report, testOptions(client)),
    { newlyPublished: 0, skippedDuplicates: 24 });
});

test('publisher still rejects windows outside the bounded query-hour lookback', async () => {
  const client = githubTestClient();
  const generatedAt = '2026-10-09T06:00:10.000Z';
  await assert.rejects(
    publishAlerts(testReport([exampleAlert(-20)], generatedAt), testOptions(client)),
    /outside the bounded completed-hour lookback/,
  );
  await assert.rejects(
    publishAlerts(testReport([exampleAlert(6)], generatedAt), testOptions(client)),
    /outside the bounded completed-hour lookback/,
  );
  const scattered = [exampleAlert(-19), exampleAlert(5)];
  await assert.rejects(
    publishAlerts(testReport(scattered, generatedAt), testOptions(client)),
    /Lookback exceeded 24 completed hours/,
  );
  assert.equal(client.issues.length, 0);
});
