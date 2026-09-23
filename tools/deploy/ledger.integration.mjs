import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlan, planHash, sha256 } from './policy.mjs';
import { reservationQuery } from './runtime.mjs';

// This test deliberately has no URL, host, port, password or environment-token
// input. It only exercises the disposable Supabase database already started by
// Database Tests. Never use this fixture cleanup in the production workflow.
const LOCAL_PSQL_ARGS = [
  '--no-psqlrc', '--no-password', '--host=127.0.0.1', '--port=54322',
  '--username=postgres', '--dbname=postgres', '--no-align', '--tuples-only',
  '--quiet', '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=sqlstate',
];
const SESSION_TIMEOUT_MS = 30000;
const MAX_OUTPUT_BYTES = 64 * 1024;

function childEnvironment(applicationName) {
  // Do not inherit PGHOSTADDR, PGSERVICE, PGOPTIONS, credential files, production
  // deployment tokens or other libpq settings that could redirect the target.
  const env = { PATH: process.env.PATH || '', LANG: 'C', LC_ALL: 'C',
    PGPASSWORD: 'postgres', PGCONNECT_TIMEOUT: '5', PGSSLMODE: 'disable',
    PGAPPNAME: applicationName };
  for (const key of ['SystemRoot', 'WINDIR']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function session(applicationName) {
  const child = spawn('psql', LOCAL_PSQL_ARGS, {
    env: childEnvironment(applicationName), shell: false, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', failure, closed = false;
  const timeout = setTimeout(() => {
    failure = new Error('Local ledger test PostgreSQL session timed out');
    child.kill();
  }, SESSION_TIMEOUT_MS);
  timeout.unref();
  const append = (target, data) => {
    if (target === 'stdout') stdout += data.toString('utf8');
    else stderr += data.toString('utf8');
    if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
      failure = new Error('Local ledger test PostgreSQL output exceeded limit');
      child.kill();
    }
  };
  child.stdout.on('data', (data) => append('stdout', data));
  child.stderr.on('data', (data) => append('stderr', data));
  child.stdin.on('error', () => {}); // The close/error event reports startup failures.
  const done = new Promise((resolve, reject) => {
    child.on('error', () => { failure = new Error('Local ledger test requires an available psql client'); });
    child.on('close', (status) => {
      closed = true;
      clearTimeout(timeout);
      if (failure) reject(failure);
      else resolve({ status, stdout: stdout.trim(), stderr });
    });
  });
  // A deliberately open transaction may fail before its parent awaits done.
  done.catch(() => {});
  return {
    write(sql) { child.stdin.write(sql); },
    end(sql = '') { child.stdin.end(sql); },
    done,
    async waitForLine(line) {
      const deadline = Date.now() + 10000;
      while (!stdout.split(/\r?\n/).includes(line)) {
        if (closed) {
          await done;
          throw new Error('Local ledger test reservation session ended before its barrier');
        }
        if (Date.now() > deadline) throw new Error('Local ledger test reservation barrier timed out');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    async stop() {
      if (!closed) { child.stdin.destroy(); child.kill(); }
      await done.catch(() => {});
    },
  };
}

async function query(sql, applicationName, expectedError) {
  const connection = session(applicationName);
  connection.end(sql);
  const result = await connection.done;
  if (expectedError) {
    assert.notEqual(result.status, 0, `Expected PostgreSQL error ${expectedError}`);
    assert.match(result.stderr, new RegExp(`\\b${expectedError}\\b`), `Expected PostgreSQL error ${expectedError}`);
  } else {
    assert.equal(result.status, 0, 'Local ledger test PostgreSQL query failed');
  }
  return result.stdout;
}

export async function verifyLocalLedger() {
  const runToken = randomUUID().replaceAll('-', '');
  const app = `ledger-integration-${runToken}`;
  // These synthetic IDs lie far outside this repository's real GitHub IDs.
  // The exact key is checked absent first; the hash further scopes final cleanup.
  const repositoryId = 9000000000000000;
  const commentId = 9000000000000001 + randomInt(1000000);
  const config = {
    schemaVersion: 1, enabled: true, repositoryId, repository: 'local/ledger-integration',
    projectRef: 'a'.repeat(20), environment: 'Production',
    workflowPath: '.github/workflows/database-deploy.yml', cliVersion: '2.117.0',
    approvalIssueNumber: 1, automationActorId: 1001, approverUserIds: [1002],
    readiness: { identitySeparated: true, environmentSecretsOnly: true, mainProtected: true,
      ledgerBootstrapped: true, exclusiveSchemaControl: true, disposableApplyVerified: true, humanFlowVerified: true },
  };
  // Synthetic readiness only constructs validated test SQL; it does not read or
  // enable the repository's real config, invoke apply, or contact any API.
  const plan = createPlan({ schemaVersion: 1,
    repository: { id: repositoryId, fullName: config.repository }, projectRef: config.projectRef,
    environment: config.environment, commitSha: 'a'.repeat(40), cliVersion: config.cliVersion,
    preview: { workflowId: 1001, workflowPath: config.workflowPath, runId: 1002, runAttempt: 1 },
    migrations: [{ version: '20260923000000', path: 'supabase/migrations/20260923000000_local_probe.sql', sha256: sha256(runToken) }],
    remoteHistory: [], pendingVersions: ['20260923000000'] }, config);
  const hash = planHash(plan);
  const key = `repository_id=${repositoryId} and approval_comment_id=${commentId}`;
  const reservation = (value = plan, settings = config, runId = 1003) => reservationQuery(settings, value, commentId, runId, 1);
  const connections = [];
  let ownsFixture = false;
  let cleanupFailure;
  try {
    assert.equal(await query("select current_database() = 'postgres' and current_user = 'postgres';", `${app}-check`), 't');
    assert.equal(await query(`select count(*) from private.database_deployment_approvals where ${key};`, `${app}-check`), '0',
      'Refusing to reuse any existing local fixture key');
    ownsFixture = true;

    // First insert stays uncommitted. A second, separate psql connection must
    // block on that exact transaction before the first is allowed to commit.
    const first = session(`${app}-a`);
    connections.push(first);
    first.write(`begin;\nset local statement_timeout='20s';\n${reservation()}\nselect 'FIRST_RESERVED';\n`);
    await first.waitForLine('FIRST_RESERVED');
    const second = session(`${app}-b`);
    connections.push(second);
    second.end(`begin;\nset local statement_timeout='20s';\n${reservation(plan, config, 1004)}\ncommit;\n`);
    const deadline = Date.now() + 10000;
    let contended = false;
    while (Date.now() < deadline) {
      const observed = await query(`select count(distinct pid)=2 and coalesce(bool_or(
        application_name='${app}-b' and wait_event_type='Lock' and wait_event='transactionid'),false)
        from pg_stat_activity where application_name in ('${app}-a','${app}-b');`, `${app}-check`);
      if (observed === 't') { contended = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(contended, true, 'Both separate sessions must contend on the same uncommitted approval');
    first.end('commit;\n');
    const [winner, loser] = await Promise.all([first.done, second.done]);
    assert.equal(winner.status, 0);
    assert.equal(loser.status, 0);
    assert.deepEqual(winner.stdout.split(/\r?\n/).filter((line) => line !== 'FIRST_RESERVED'), [String(commentId)]);
    assert.equal(loser.stdout, '', 'The competing committed INSERT must return no reservation');
    assert.equal(await query(`select count(*) from private.database_deployment_approvals where ${key};`, `${app}-check`), '1');
    console.log('PASS: separate contending PostgreSQL sessions commit exactly one approval reservation');

    const differentPlan = createPlan({ ...plan, commitSha: 'b'.repeat(40) }, config);
    assert.equal(await query(reservation(differentPlan), `${app}-check`), '', 'A changed plan must not reuse the comment');
    const otherConfig = { ...config, projectRef: 'b'.repeat(20) };
    const otherPlan = createPlan({ ...plan, projectRef: otherConfig.projectRef }, otherConfig);
    assert.equal(await query(reservation(otherPlan, otherConfig), `${app}-check`), '', 'A changed project must not reuse the comment');
    assert.equal(await query(`select plan_hash || '|' || project_ref || '|' || commit_sha
      from private.database_deployment_approvals where ${key};`, `${app}-check`),
    `${hash}|${config.projectRef}|${plan.commitSha}`, 'Replay attempts must preserve the original bindings');
    console.log('PASS: changed plan and project cannot reuse the committed approval');

    // This separate failing transaction models a migration command after the
    // HTTP reservation has already committed. It creates no persistent object
    // and never reads or changes supabase_migrations.schema_migrations.
    await query('begin; create temporary table ledger_failure_probe(id integer); insert into ledger_failure_probe values (1); select 1/0; commit;',
      `${app}-failed-apply`, '22012');
    assert.equal(await query(`select count(*) from private.database_deployment_approvals where ${key} and plan_hash='${hash}';`, `${app}-check`), '1');
    assert.equal(await query(reservation(), `${app}-check`), '', 'A failed subsequent transaction must leave approval consumed');
    console.log('PASS: a failed subsequent SQL transaction does not undo or release the reservation');

    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const statement of [
        `select * from private.database_deployment_approvals where ${key};`,
        reservation(),
        `update private.database_deployment_approvals set plan_hash=plan_hash where ${key};`,
        `delete from private.database_deployment_approvals where ${key};`,
      ]) {
        // Even an unexpected grant cannot persist a test mutation: successful
        // statements explicitly roll back, and ON_ERROR_STOP closes failures.
        await query(`begin; set local role ${role}; ${statement} rollback;`, `${app}-${role}`, '42501');
      }
    }
    const privilegeCount = await query(`select count(*) from (values ('anon'),('authenticated'),('service_role')) roles(name)
      where has_table_privilege(name,'private.database_deployment_approvals','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(name,'private.database_deployment_approvals','SELECT,INSERT,UPDATE,REFERENCES');`, `${app}-check`);
    assert.equal(privilegeCount, '0');
    console.log('PASS: anon, authenticated and service_role cannot read, reserve, alter or release approvals');
  } finally {
    // Stop open sessions first so their uncommitted inserts cannot survive or
    // block cleanup. Delete only this run's proven-absent synthetic key/hash.
    await Promise.all(connections.map((connection) => connection.stop()));
    if (ownsFixture) {
      try {
        await query(`delete from private.database_deployment_approvals where ${key} and plan_hash='${hash}'
          and project_ref='${config.projectRef}' and commit_sha='${plan.commitSha}';`, `${app}-cleanup`);
        assert.equal(await query(`select count(*) from private.database_deployment_approvals where ${key};`, `${app}-cleanup`), '0');
      } catch (error) { cleanupFailure = error; }
    }
    if (cleanupFailure) throw new Error('Local ledger integration fixture cleanup failed', { cause: cleanupFailure });
  }
  console.log('Local PostgreSQL ledger integration passed. This does not verify the remote approval/deployment or human flow.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error('Local ledger integration accepts no connection arguments.');
    process.exitCode = 1;
  } else {
    verifyLocalLedger().catch((error) => {
      console.error(`Local ledger integration failed: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
