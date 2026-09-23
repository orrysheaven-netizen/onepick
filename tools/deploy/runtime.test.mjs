import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Runtime, id, readMigrations, normalizeHistory, assertDryRun, reservationQuery } from './runtime.mjs';
import { MAX_PLAN_BYTES, canonicalJson, createPlan, planHash, sha256, approvalStatement, APPROVAL_TTL_MS } from './policy.mjs';

const clone = (value) => structuredClone(value);
function fixture() {
  const config = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
  config.enabled = true;
  config.automationActorId = 1001;
  for (const key of Object.keys(config.readiness)) config.readiness[key] = true;
  const migrations = ['20260922000000', '20260923000000'].map((version) => ({
    version, path: `supabase/migrations/${version}_example.sql`, sha256: sha256(version),
  }));
  const remoteHistory = [{ version: migrations[0].version, name: 'example', statementsSha256: sha256('old') }];
  const before = { migrations, remoteHistory, pendingVersions: [migrations[1].version] };
  const after = clone({ migrations, remoteHistory: [...remoteHistory,
    { version: migrations[1].version, name: 'example', statementsSha256: sha256('new') }], pendingVersions: [] });
  const plan = createPlan({ schemaVersion: 1, repository: { id: config.repositoryId, fullName: config.repository },
    projectRef: config.projectRef, environment: config.environment, commitSha: 'a'.repeat(40),
    preview: { workflowId: 101, workflowPath: config.workflowPath, runId: 10001, runAttempt: 1 },
    cliVersion: config.cliVersion, ...before }, config);
  return { config, plan, before, after };
}
const response = (value, options) => new Response(JSON.stringify(value), options);
const noNetwork = async () => { throw new Error('unexpected network request'); };

test('IDs accept positive safe canonical integers and reject command-shaped inputs', () => {
  assert.equal(id('123'), 123);
  assert.equal(id(123), 123);
  assert.equal(id(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  for (const value of ['', 0, -1, '01', '1e3', '1.0', '1\n', ' 1', '1 ', '1;drop table x',
    '$(whoami)', 1.1, Number.MAX_SAFE_INTEGER + 1, null, undefined, {}, true]) {
    assert.throws(() => id(value), /INVALID_ID/, String(value));
  }
});

test('reservation SQL only interpolates validated bindings and atomically returns consumption', () => {
  const { config, plan } = fixture();
  const sql = reservationQuery(config, plan, '30001', '40001', '2');
  assert.match(sql, /^insert into private\.database_deployment_approvals\s/);
  assert.ok(sql.includes(`values (${config.repositoryId},30001,'${planHash(plan)}','${config.projectRef}','${plan.commitSha}',10001,1,40001,2)`));
  assert.match(sql, /on conflict \(repository_id,approval_comment_id\) do nothing returning approval_comment_id::text;$/);
  for (const index of [0, 1, 2]) {
    const identifiers = ['30001', '40001', '2'];
    identifiers[index] = "1); delete from private.database_deployment_approvals;--";
    assert.throws(() => reservationQuery(config, plan, ...identifiers), /INVALID_ID/);
  }
  for (const field of ['projectRef', 'commitSha']) {
    const changed = clone(plan); changed[field] = "'; select 1;--";
    assert.throws(() => reservationQuery(config, changed, 30001, 40001, 2), Error);
  }
  const disabled = clone(config); disabled.enabled = false;
  assert.throws(() => reservationQuery(disabled, plan, 30001, 40001, 2), /disabled/);
});

test('migration inventory hashes actual bytes, sorts names and excludes unrelated files', (t) => {
  const parent = fileURLToPath(new URL('../../work/', import.meta.url));
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'runtime-tests-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(parent) + path.sep));
    fs.rmSync(root, { recursive: true });
  });
  const directory = path.join(root, 'supabase', 'migrations');
  fs.mkdirSync(directory, { recursive: true });
  const first = '20260922000000_example.sql', second = '20260923000000_example.sql';
  fs.writeFileSync(path.join(directory, second), 'select 2;\r\n');
  fs.writeFileSync(path.join(directory, first), 'select 1;\n');
  fs.writeFileSync(path.join(directory, 'notes.md'), 'ignored');
  const files = readMigrations(root);
  assert.deepEqual(files.map((file) => file.path), [`supabase/migrations/${first}`, `supabase/migrations/${second}`]);
  assert.equal(files[0].sha256, sha256('select 1;\n'));
  assert.equal(files[1].sha256, sha256('select 2;\r\n'));
  fs.writeFileSync(path.join(directory, first), 'select 1;\r\n');
  assert.notEqual(readMigrations(root)[0].sha256, files[0].sha256);
  const malformed = path.join(directory, 'not_a_migration.sql');
  fs.writeFileSync(malformed, 'select 3');
  assert.throws(() => readMigrations(root), /INVALID_MIGRATION_FILE/);
  fs.unlinkSync(malformed);
  fs.writeFileSync(path.join(directory, first), Buffer.alloc(MAX_PLAN_BYTES + 1));
  assert.throws(() => readMigrations(root), /INVALID_MIGRATION_FILE/);
  fs.unlinkSync(path.join(directory, first));
  fs.mkdirSync(path.join(directory, first));
  assert.throws(() => readMigrations(root), /INVALID_MIGRATION_FILE/);
});

test('remote migration statements are hashed canonically without exposing raw SQL', () => {
  const rows = [
    { version: '20260923000000', name: null, statements: null },
    { version: '20260922000000', name: 'example', statements: ['select 1;', 'select 2;'] },
  ];
  const original = clone(rows);
  const history = normalizeHistory(rows);
  assert.deepEqual(rows, original);
  assert.deepEqual(history.map((row) => row.version), ['20260922000000', '20260923000000']);
  assert.equal(history[0].statementsSha256, sha256(canonicalJson(['select 1;', 'select 2;'])));
  assert.equal(history[1].statementsSha256, sha256('null'));
  assert.equal(JSON.stringify(history).includes('select 1'), false);
  for (const input of [null, {}, Array(10001).fill(rows[0]), [null], [{ ...rows[0], unknown: true }],
    [{ ...rows[0], statements: 'select 1' }], [{ ...rows[0], statements: [1] }], [{ version: 'x' }]]) {
    assert.throws(() => normalizeHistory(input), /INVALID_HISTORY/);
  }
});

test('pinned CLI dry-run output must contain exactly the expected pending migration list', () => {
  const { plan } = fixture();
  const file = '20260923000000_example.sql';
  for (const bullet of ['•', '-', '*']) {
    assert.doesNotThrow(() => assertDryRun(`Connecting...\r\n\u001b[32mWould push these migrations:\u001b[0m\r\n ${bullet} ${file}\r\n`, plan));
  }
  for (const output of ['', 'Remote database is up to date.', `Would push these migrations:\n`,
    `Would push these migrations:\n - 20260922000000_example.sql`,
    `Would push these migrations:\n - ${file}\n - ${file}`,
    `Would push these migrations:\n - ../${file}`,
    `Would push these migrations:\n - 20260923000000_$(whoami).sql`]) {
    assert.throws(() => assertDryRun(output, plan), /DRY_RUN/);
  }
  const empty = { ...plan, pendingVersions: [] };
  assert.doesNotThrow(() => assertDryRun('Remote database is up to date.', empty));
  assert.doesNotThrow(() => assertDryRun('No pending migrations to apply', empty));
  assert.throws(() => assertDryRun(`Would push these migrations:\n - ${file}`, empty), /UNEXPECTED_DRY_RUN/);
  assert.throws(() => assertDryRun('Unknown status', empty), /UNEXPECTED_DRY_RUN/);
});

test('link requires both deployment secrets and the pinned CLI before project linking', () => {
  const { config } = fixture();
  const runtime = new Runtime(config, {}, noNetwork);
  let calls = [];
  runtime.cli = (args) => { calls.push(args); return `${config.cliVersion}\n`; };
  assert.throws(() => runtime.link(), /MISSING_DEPLOYMENT_SECRETS/);
  assert.deepEqual(calls, []);
  runtime.env = { SUPABASE_ACCESS_TOKEN: 'fake-token', SUPABASE_DB_PASSWORD: 'fake-password' };
  runtime.link();
  assert.deepEqual(calls, [['--version'], ['link', '--project-ref', config.projectRef]]);
  calls = [];
  runtime.cli = (args) => { calls.push(args); return '0.0.1'; };
  assert.throws(() => runtime.link(), /CLI_VERSION_MISMATCH/);
  assert.deepEqual(calls, [['--version']]);
});

test('GitHub and database requests bind endpoints and prohibit redirects', async () => {
  const { config } = fixture();
  const calls = [];
  const runtime = new Runtime(config, { GH_TOKEN: 'fake-github', SUPABASE_ACCESS_TOKEN: 'fake-db' }, async (...args) => {
    calls.push(args); return response([]);
  });
  await runtime.github('branches/main');
  await runtime.query('select 1;');
  await runtime.query('insert into example default values;', false);
  assert.equal(calls[0][0], `https://api.github.com/repos/${config.repository}/branches/main`);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer fake-github');
  assert.equal(calls[1][0], `https://api.supabase.com/v1/projects/${config.projectRef}/database/query/read-only`);
  assert.equal(calls[2][0], `https://api.supabase.com/v1/projects/${config.projectRef}/database/query`);
  assert.deepEqual(JSON.parse(calls[1][1].body), { query: 'select 1;' });
  assert.ok(calls.every(([, options]) => options.redirect === 'error' && options.signal instanceof AbortSignal));
});

test('missing credentials and failed API calls do not leak response details', async () => {
  const { config } = fixture();
  const missing = new Runtime(config, {}, noNetwork);
  await assert.rejects(missing.github('branches/main'), /MISSING_GITHUB_TOKEN/);
  await assert.rejects(missing.query('select 1'), /MISSING_DEPLOYMENT_TOKEN/);
  const failed = new Runtime(config, { GH_TOKEN: 'fake', SUPABASE_ACCESS_TOKEN: 'fake' }, async () =>
    new Response('sensitive upstream text', { status: 403 }));
  await assert.rejects(failed.github('branches/main'), { message: 'GITHUB_READ_FAILED' });
  await assert.rejects(failed.query('select 1'), { message: 'DATABASE_QUERY_FAILED' });
});

test('API bodies reject advertised and streamed oversized responses', async () => {
  const { config } = fixture();
  for (const suppliedLength of [true, false]) {
    const runtime = new Runtime(config, { GH_TOKEN: 'fake' }, async () => new Response(
      suppliedLength ? '{}' : new Uint8Array(16 * MAX_PLAN_BYTES + 1),
      suppliedLength ? { headers: { 'content-length': String(16 * MAX_PLAN_BYTES + 1) } } : undefined));
    await assert.rejects(runtime.github('branches/main'), /RESPONSE_TOO_LARGE/);
  }
});

test('pagination retrieves every page and rejects malformed or unbounded lists', async () => {
  const { config } = fixture();
  const runtime = new Runtime(config, {}, noNetwork);
  const calls = [];
  runtime.github = async (suffix) => { calls.push(suffix); return { jobs: Array(calls.length === 1 ? 100 : 3).fill({}) }; };
  assert.equal((await runtime.pages('actions/runs/123/jobs', 'jobs')).length, 103);
  assert.deepEqual(calls, ['actions/runs/123/jobs?per_page=100&page=1', 'actions/runs/123/jobs?per_page=100&page=2']);
  runtime.github = async () => ({ jobs: {} });
  await assert.rejects(runtime.pages('jobs', 'jobs'), /INVALID_GITHUB_LIST/);
  runtime.github = async () => ({ jobs: Array(100).fill({}) });
  await assert.rejects(runtime.pages('jobs', 'jobs'), /GITHUB_LIST_TOO_LARGE/);
});

test('artifact download rejects redirect hosts, credentials and protocols', async () => {
  const { config } = fixture();
  for (const location of ['http://safe.blob.core.windows.net/plan', 'https://evil.example/plan',
    'https://safe.blob.core.windows.net.evil.example/plan', 'https://user:password@safe.blob.core.windows.net/plan']) {
    let calls = 0;
    const runtime = new Runtime(config, { GH_TOKEN: 'fake' }, async () => {
      calls += 1; return new Response(null, { status: 302, headers: { location } });
    });
    await assert.rejects(runtime.download({ id: 123 }), /ARTIFACT_HOST_REJECTED/);
    assert.equal(calls, 1);
  }
  const missing = new Runtime(config, { GH_TOKEN: 'fake' }, async () => new Response(null, { status: 200 }));
  await assert.rejects(missing.download({ id: 123 }), /ARTIFACT_REDIRECT_FAILED/);
});

test('artifact token stays on GitHub and archive digest is checked before parsing', async () => {
  const { config } = fixture();
  const calls = [];
  const runtime = new Runtime(config, { GH_TOKEN: 'fake' }, async (...args) => {
    calls.push(args);
    return calls.length === 1
      ? new Response(null, { status: 302, headers: { location: 'https://safe.blob.core.windows.net/plan?signed=true' } })
      : new Response('untrusted archive');
  });
  await assert.rejects(runtime.download({ id: 123, digest: `sha256:${'a'.repeat(64)}` }), /ARTIFACT_DIGEST_MISMATCH/);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer fake');
  assert.equal(calls[0][1].redirect, 'manual');
  assert.equal(calls[1][1].headers, undefined);
  assert.equal(calls[1][1].redirect, 'error');
});

test('artifact stream size is enforced before digest or archive interpretation', async () => {
  const { config } = fixture();
  let calls = 0;
  const runtime = new Runtime(config, { GH_TOKEN: 'fake' }, async () => ++calls === 1
    ? new Response(null, { status: 302, headers: { location: 'https://safe.githubusercontent.com/plan' } })
    : new Response(new Uint8Array(MAX_PLAN_BYTES + 1)));
  await assert.rejects(runtime.download({ id: 123 }), /RESPONSE_TOO_LARGE/);
});

for (const rows of [[], [{ approval_comment_id: '30001' }, { approval_comment_id: '30001' }],
  [{ approval_comment_id: 'wrong' }], [{ approval_comment_id: 30001 }], null, {}]) {
  test(`runtime rejects ambiguous reservation result ${JSON.stringify(rows)}`, async () => {
    const { config, plan, before } = fixture();
    const runtime = new Runtime(config, { APPROVAL_COMMENT_ID: '30001', GITHUB_RUN_ID: '40001', GITHUB_RUN_ATTEMPT: '1' }, noNetwork);
    runtime.verify = async () => plan;
    runtime.recheckForReservation = async () => {};
    runtime.link = () => {};
    runtime.state = async () => clone(before);
    runtime.preview = () => {};
    runtime.query = async (sql, readOnly) => {
      assert.equal(readOnly, false);
      assert.match(sql, /^insert into private\.database_deployment_approvals/);
      return rows;
    };
    let pushed = false;
    runtime.cli = () => { pushed = true; };
    await assert.rejects(runtime.apply(), /consumed or reservation uncertain/);
    assert.equal(pushed, false);
  });
}

test('runtime applies only after a matching committed reservation, then verifies clean state', async () => {
  const { config, plan, before, after } = fixture();
  const runtime = new Runtime(config, { APPROVAL_COMMENT_ID: '30001', GITHUB_RUN_ID: '40001', GITHUB_RUN_ATTEMPT: '1' }, noNetwork);
  let committed = false, pushed = false;
  runtime.verify = async () => plan;
  runtime.recheckForReservation = async () => {};
  runtime.link = () => {};
  runtime.state = async () => clone(pushed ? after : before);
  runtime.preview = () => {};
  runtime.query = async () => { committed = true; return [{ approval_comment_id: '30001' }]; };
  runtime.cli = (args) => {
    assert.equal(committed, true);
    assert.deepEqual(args, ['db', 'push', '--linked', '--include-all', '--skip-vault', '--yes']);
    pushed = true;
  };
  await runtime.apply();
  assert.equal(pushed, true);
});

function readyRuntimeEvidence() {
  const { config, plan, before } = fixture();
  const now = Date.now();
  const timestamp = (delta) => new Date(now + delta).toISOString();
  const digest = `sha256:${'b'.repeat(64)}`;
  const comment = { id: 30001, issue_url: `https://api.github.com/repos/${config.repository}/issues/${config.approvalIssueNumber}`,
    user: { id: config.approverUserIds[0], type: 'User' }, body: approvalStatement(plan),
    created_at: timestamp(-30000), updated_at: timestamp(-30000) };
  const evidence = { config, plan,
    run: { id: plan.preview.runId, run_attempt: 1, workflow_id: plan.preview.workflowId, path: config.workflowPath,
      repository: { id: config.repositoryId, full_name: config.repository },
      head_repository: { id: config.repositoryId, full_name: config.repository }, head_branch: 'main',
      head_sha: plan.commitSha, event: 'push', status: 'completed', conclusion: 'success' },
    planJob: { name: 'plan', run_id: plan.preview.runId, head_sha: plan.commitSha,
      status: 'completed', conclusion: 'success', completed_at: timestamp(-60000) }, planJobAttempt: 1,
    artifact: { id: 20001, name: 'db-deployment-plan-10001-1', expired: false, size_in_bytes: 1024,
      digest, expires_at: timestamp(3600000), created_at: timestamp(-70000),
      workflow_run: { id: plan.preview.runId, repository_id: config.repositoryId,
        head_repository_id: config.repositoryId, head_branch: 'main', head_sha: plan.commitSha } },
    expectedArtifactId: 20001, downloadedArtifactDigest: digest, comment, expectedCommentId: 30001,
    currentMainSha: plan.commitSha, applyActorId: config.automationActorId,
    applyTriggeringActorId: config.automationActorId, now };
  const runtime = new Runtime(config, { APPROVAL_COMMENT_ID: '30001', GITHUB_RUN_ID: '40001', GITHUB_RUN_ATTEMPT: '1' }, noNetwork);
  runtime.evidence = evidence;
  runtime.github = async (suffix) => suffix === 'branches/main' ? { commit: { sha: plan.commitSha } } : clone(comment);
  runtime.verify = async () => plan;
  runtime.link = () => {};
  runtime.preview = () => {};
  runtime.state = async () => clone(before);
  return { runtime, plan, evidence, comment, timestamp };
}

test('last reservation check refreshes main and exact comment with valid evidence', async () => {
  const { runtime, plan } = readyRuntimeEvidence();
  await runtime.recheckForReservation(plan);
  runtime.evidence = null;
  await assert.rejects(runtime.recheckForReservation(plan), /MISSING_VERIFIED_EVIDENCE/);
});

for (const [label, change] of [
  ['missing evidence', ({ runtime }) => { runtime.evidence = null; }],
  ['changed main', ({ runtime, comment }) => {
    runtime.github = async (suffix) => suffix === 'branches/main' ? { commit: { sha: 'b'.repeat(40) } } : comment;
  }],
  ['edited comment', ({ comment, timestamp }) => { comment.updated_at = timestamp(-10000); }],
  ['deleted comment', ({ runtime, plan }) => {
    runtime.github = async (suffix) => {
      if (suffix === 'branches/main') return { commit: { sha: plan.commitSha } };
      throw new Error('GITHUB_READ_FAILED');
    };
  }],
  ['expired approval', ({ evidence, timestamp }) => { evidence.planJob.completed_at = timestamp(-APPROVAL_TTL_MS - 1); }],
]) {
  test(`last reservation check blocks ${label} before ledger write or push`, async () => {
    const value = readyRuntimeEvidence();
    change(value);
    let writes = 0, pushes = 0;
    value.runtime.query = async () => { writes += 1; return [{ approval_comment_id: '30001' }]; };
    value.runtime.cli = () => { pushes += 1; };
    await assert.rejects(value.runtime.apply(), Error);
    assert.equal(writes, 0);
    assert.equal(pushes, 0);
  });
}
