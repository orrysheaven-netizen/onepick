import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyApprovedPlan } from './engine.mjs';
import { createPlan, sha256 } from './policy.mjs';

const clone = (value) => structuredClone(value);
function harness() {
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
  const calls = [];
  const state = { consumed: false, pushed: false, before, after };
  const handlers = {
    verify: async () => clone(plan),
    readState: async () => clone(state.pushed ? state.after : state.before),
    preview: async () => {},
    reserve: async () => { state.consumed = true; return true; },
    push: async () => { state.pushed = true; },
  };
  const args = { config, plan };
  for (const key of Object.keys(handlers)) args[key] = async (...values) => {
    calls.push(key);
    return handlers[key](...values);
  };
  return { args, calls, handlers, state };
}

test('apply orders evidence, live state, preview, recheck, reservation and push', async () => {
  const { args, calls, state } = harness();
  // A downloaded canonical plan has different property order from runtime
  // observations. Equivalent objects must survive final verification.
  await applyApprovedPlan(args);
  assert.deepEqual(calls, ['verify', 'readState', 'preview', 'verify', 'readState', 'reserve', 'push', 'readState', 'preview']);
  assert.equal(state.consumed, true);
  assert.equal(state.pushed, true);
});

test('disabled activation or no pending migration invokes no external dependency', async () => {
  const disabled = harness();
  disabled.args.config.enabled = false;
  await assert.rejects(applyApprovedPlan(disabled.args), /disabled/);
  assert.deepEqual(disabled.calls, []);
  const empty = harness();
  empty.args.plan.remoteHistory = clone(empty.state.after.remoteHistory);
  empty.args.plan.pendingVersions = [];
  await assert.rejects(applyApprovedPlan(empty.args), /No pending/);
  assert.deepEqual(empty.calls, []);
});

test('push waits for the separately committed reservation response', async () => {
  const value = harness();
  let confirm;
  value.handlers.reserve = () => new Promise((resolve) => { confirm = resolve; });
  const running = applyApprovedPlan(value.args);
  while (!confirm) await new Promise(setImmediate);
  assert.equal(value.calls.includes('push'), false);
  confirm(true);
  await running;
  assert.equal(value.calls.includes('push'), true);
});

for (const response of [false, undefined, null, 1, 'true', {}, []]) {
  test(`uncertain or replayed reservation (${JSON.stringify(response)}) prevents push`, async () => {
    const value = harness();
    value.handlers.reserve = async () => response;
    await assert.rejects(applyApprovedPlan(value.args), /consumed or reservation uncertain/);
    assert.equal(value.calls.includes('push'), false);
    assert.equal(value.calls.at(-1), 'reserve');
  });
}

for (const stage of ['verify', 'readState', 'preview', 'reserve']) {
  test(`${stage} failure prevents push and is not retried`, async () => {
    const value = harness();
    value.handlers[stage] = async () => { throw new Error('injected failure'); };
    await assert.rejects(applyApprovedPlan(value.args), /injected failure/);
    assert.equal(value.calls.includes('push'), false);
    assert.equal(value.calls.filter((name) => name === stage).length, 1);
  });
}

test('changed or revoked evidence after dry-run blocks reservation', async () => {
  for (const revoked of [false, true]) {
    const value = harness();
    let reads = 0;
    value.handlers.verify = async () => {
      if (++reads === 1) return value.args.plan;
      if (revoked) throw new Error('approval deleted');
      return { ...value.args.plan, commitSha: 'b'.repeat(40) };
    };
    await assert.rejects(applyApprovedPlan(value.args), /evidence changed|approval deleted/);
    assert.equal(value.calls.includes('reserve'), false);
  }
});

for (const [label, change] of [
  ['migration hash', (state) => { state.migrations[1].sha256 = sha256('changed'); }],
  ['remote history', (state) => { state.remoteHistory[0].statementsSha256 = sha256('changed'); }],
  ['pending list', (state) => { state.pendingVersions = []; }],
]) {
  test(`a changed ${label} immediately before reservation blocks apply`, async () => {
    const value = harness();
    value.handlers.preview = async () => change(value.state.before);
    await assert.rejects(applyApprovedPlan(value.args), Error);
    assert.equal(value.calls.includes('reserve'), false);
    assert.equal(value.calls.includes('push'), false);
  });
}

test('migration failure burns the reservation and cannot automatically retry', async () => {
  const value = harness();
  value.handlers.reserve = async () => {
    if (value.state.consumed) return false;
    value.state.consumed = true;
    return true;
  };
  value.handlers.push = async () => { throw new Error('migration failed'); };
  await assert.rejects(applyApprovedPlan(value.args), /migration failed/);
  assert.equal(value.state.consumed, true);
  await assert.rejects(applyApprovedPlan(value.args), /consumed/);
  assert.equal(value.calls.filter((name) => name === 'push').length, 1);
});

for (const [label, change] of [
  ['remaining pending migration', (state) => { state.pendingVersions = ['20260923000000']; }],
  ['missing history row', (state) => { state.remoteHistory.pop(); }],
  ['rewritten history', (state) => { state.remoteHistory[0].statementsSha256 = sha256('rewritten'); }],
  ['modified checkout', (state) => { state.migrations[1].sha256 = sha256('modified'); }],
]) {
  test(`post-apply ${label} is detected with approval still consumed`, async () => {
    const value = harness();
    change(value.state.after);
    await assert.rejects(applyApprovedPlan(value.args), /verification failed|history changed/);
    assert.equal(value.state.consumed, true);
    assert.equal(value.state.pushed, true);
  });
}

test('failed final preview does not release the consumed approval', async () => {
  const value = harness();
  value.handlers.preview = async () => { if (value.state.pushed) throw new Error('final dry-run failed'); };
  await assert.rejects(applyApprovedPlan(value.args), /final dry-run failed/);
  assert.equal(value.state.consumed, true);
  assert.equal(value.calls.filter((name) => name === 'reserve').length, 1);
});
