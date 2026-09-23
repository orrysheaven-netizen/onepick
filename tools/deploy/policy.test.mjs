import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVAL_TTL_MS, MAX_PLAN_BYTES, approvalStatement, assertPlanMatches,
  assertReady, canonicalJson, createPlan, parseStrictJson, planHash, sha256,
  validateConfig, validatePlan, verifyEvidence,
} from './policy.mjs';

const clone = (value) => structuredClone(value);
const config = {
  schemaVersion: 1, enabled: true, repositoryId: 1371316072,
  repository: 'orrysheaven-netizen/onepick', projectRef: 'ygoipwzakzdnkaaxyrgb',
  environment: 'Production', workflowPath: '.github/workflows/database-deploy.yml',
  cliVersion: '2.117.0', approvalIssueNumber: 225, automationActorId: 1001,
  approverUserIds: [329510562], readiness: {
    identitySeparated: true, environmentSecretsOnly: true, mainProtected: true,
    ledgerBootstrapped: true, exclusiveSchemaControl: true,
    disposableApplyVerified: true, humanFlowVerified: true,
  },
};
const migration = (version) => ({ version, path: `supabase/migrations/${version}_example.sql`, sha256: sha256(version) });
const plan = {
  schemaVersion: 1, repository: { id: config.repositoryId, fullName: config.repository },
  projectRef: config.projectRef, environment: config.environment, commitSha: 'a'.repeat(40),
  preview: { workflowId: 101, workflowPath: config.workflowPath, runId: 10001, runAttempt: 1 },
  cliVersion: config.cliVersion,
  migrations: [migration('20260922000000'), migration('20260923000000')],
  remoteHistory: [{ version: '20260922000000', name: 'example', statementsSha256: sha256(canonicalJson(['select 1;'])) }],
  pendingVersions: ['20260923000000'],
};
const completedAt = '2026-09-23T12:00:00Z';
const fixture = () => ({
  config: clone(config), plan: clone(plan),
  run: {
    id: plan.preview.runId, run_attempt: 1, workflow_id: plan.preview.workflowId,
    path: config.workflowPath,
    repository: { id: config.repositoryId, full_name: config.repository },
    head_repository: { id: config.repositoryId, full_name: config.repository },
    head_branch: 'main', head_sha: plan.commitSha, event: 'push',
    status: 'completed', conclusion: 'success',
  },
  planJob: {
    name: 'plan', run_id: plan.preview.runId, head_sha: plan.commitSha,
    status: 'completed', conclusion: 'success', completed_at: completedAt,
  },
  planJobAttempt: 1,
  artifact: {
    id: 20001, name: 'db-deployment-plan-10001-1', expired: false,
    size_in_bytes: 1024, digest: `sha256:${'b'.repeat(64)}`,
    expires_at: '2026-09-24T12:00:00Z', created_at: '2026-09-23T11:59:00Z',
    workflow_run: {
      id: plan.preview.runId, repository_id: config.repositoryId,
      head_repository_id: config.repositoryId, head_branch: 'main', head_sha: plan.commitSha,
    },
  },
  expectedArtifactId: 20001, downloadedArtifactDigest: `sha256:${'b'.repeat(64)}`,
  comment: {
    id: 30001, issue_url: `https://api.github.com/repos/${config.repository}/issues/225`,
    user: { id: 329510562, type: 'User', login: 'human-display-name' },
    body: approvalStatement(plan), created_at: '2026-09-23T12:10:00Z', updated_at: '2026-09-23T12:10:00Z',
  },
  expectedCommentId: 30001, currentMainSha: plan.commitSha,
  applyActorId: 1001, applyTriggeringActorId: 1001,
  now: Date.parse('2026-09-23T13:00:00Z'),
});

test('strict JSON rejects duplicate keys at every nesting level, including escaped keys', () => {
  for (const text of ['{"x":1,"x":2}', '{"outer":{"a":1,"\\u0061":2}}', '[{"x":1,"x":2}]', '{"__proto__":1,"__proto__":2}']) {
    assert.throws(() => parseStrictJson(text), /duplicate JSON key/);
  }
});

test('strict JSON rejects malformed input, non-finite numbers and lone surrogates', () => {
  for (const text of ['', '{', '[1,]', '{"a":1,}', 'true false', '\ufeff{}', '01', '1e999', '{"a":undefined}', '"\\ud800"', '"\\udc00"', '"raw\nnewline"']) {
    assert.throws(() => parseStrictJson(text), Error, text);
  }
  assert.equal(parseStrictJson('"\\ud83c\\udf1e"'), '🌞');
  assert.equal(parseStrictJson('"escaped \\" quote"'), 'escaped " quote');
  assert.equal(canonicalJson(parseStrictJson(' {"x":[null,true,false,-2,"ok"]} \n')), '{"x":[null,true,false,-2,"ok"]}');
});

test('strict JSON bounds bytes and depth and avoids prototype mutation', () => {
  assert.throws(() => parseStrictJson(' '.repeat(MAX_PLAN_BYTES + 1)), /size limit/);
  assert.throws(() => parseStrictJson('"가가"', { maxBytes: 7 }), /size limit/);
  assert.throws(() => parseStrictJson('['.repeat(34) + '0' + ']'.repeat(34)), /nesting/);
  const parsed = parseStrictJson('{"__proto__":{"polluted":true}}');
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal({}.polluted, undefined);
});

test('canonical serialization and hashes are independent of object insertion order', () => {
  assert.equal(canonicalJson({ b: 2, a: { d: true, c: null } }), '{"a":{"c":null,"d":true},"b":2}');
  const reversed = Object.fromEntries(Object.entries(plan).reverse());
  assert.equal(planHash(plan), planHash(reversed));
  assert.match(planHash(plan), /^[a-f0-9]{64}$/);
  assert.notEqual(planHash(plan), planHash({ ...plan, commitSha: 'b'.repeat(40) }));
  for (const value of [undefined, NaN, Infinity, 1.5, -0, 9007199254740992, { a: undefined }, new Date(), [, 1]]) {
    assert.throws(() => canonicalJson(value), Error);
  }
  const sparse = Array(1);
  sparse.extra = 1;
  assert.throws(() => canonicalJson(sparse), /invalid canonical array/);
});

test('config remains inspectable while disabled, but apply fails closed', () => {
  const disabled = clone(config);
  disabled.enabled = false;
  disabled.automationActorId = null;
  for (const key of Object.keys(disabled.readiness)) disabled.readiness[key] = false;
  assert.equal(validateConfig(disabled), disabled);
  assert.throws(() => assertReady(disabled), /disabled/);
});

for (const [label, mutate] of [
  ['unknown keys', (value) => { value.extra = true; }],
  ['unversioned config', (value) => { delete value.schemaVersion; }],
  ['string numeric ID', (value) => { value.repositoryId = '1371316072'; }],
  ['unsafe ID', (value) => { value.automationActorId = Number.MAX_SAFE_INTEGER + 1; }],
  ['same automation and human account', (value) => { value.automationActorId = value.approverUserIds[0]; }],
  ['missing automation identity', (value) => { value.automationActorId = null; }],
  ['duplicate human IDs', (value) => { value.approverUserIds.push(value.approverUserIds[0]); }],
  ['empty human allowlist', (value) => { value.approverUserIds = []; }],
  ['mutable CLI version', (value) => { value.cliVersion = 'latest'; }],
  ['unrecognized workflow', (value) => { value.workflowPath = '.github/workflows/evil.yml'; }],
  ['wrong environment', (value) => { value.environment = 'production'; }],
  ['repository trailing newline', (value) => { value.repository += '\n'; }],
  ['CLI version trailing newline', (value) => { value.cliVersion += '\n'; }],
  ['project reference trailing newline', (value) => { value.projectRef += '\n'; }],
  ...Object.keys(config.readiness).map((key) => [`unready ${key}`, (value) => { value.readiness[key] = false; }]),
]) {
  test(`config rejects ${label}`, () => {
    const value = clone(config); mutate(value);
    assert.throws(() => validateConfig(value), Error);
  });
}

test('plan generation normalizes order without mutating inputs', () => {
  const input = clone(plan);
  input.migrations.reverse();
  const normalized = createPlan(input, config);
  assert.equal(planHash(normalized), planHash(plan));
  assert.equal(input.migrations[0].version, '20260923000000');
  assert.equal(validatePlan(normalized, config), normalized);
});

for (const [label, mutate] of [
  ['unknown field', (value) => { value.extra = 'ignored?'; }],
  ['extra nested field', (value) => { value.preview.extra = true; }],
  ['unsupported version', (value) => { value.schemaVersion = 2; }],
  ['wrong repository ID', (value) => { value.repository.id += 1; }],
  ['wrong repository name', (value) => { value.repository.fullName = 'someone/else'; }],
  ['wrong project', (value) => { value.projectRef = 'z'.repeat(20); }],
  ['wrong CLI version', (value) => { value.cliVersion = '2.116.0'; }],
  ['short SHA', (value) => { value.commitSha = 'abcd'; }],
  ['uppercase SHA', (value) => { value.commitSha = 'A'.repeat(40); }],
  ['unsafe run ID', (value) => { value.preview.runId = 9007199254740992; }],
  ['migration path traversal', (value) => { value.migrations[0].path = 'supabase/migrations/../secret'; }],
  ['migration filename injection', (value) => { value.migrations[0].path = 'supabase/migrations/20260922000000_$(whoami).sql'; }],
  ['duplicate migration versions', (value) => { value.migrations.push(value.migrations[0]); }],
  ['unsorted migrations', (value) => { value.migrations.reverse(); }],
  ['missing hash', (value) => { delete value.migrations[0].sha256; }],
  ['malformed file hash', (value) => { value.migrations[0].sha256 = 'G'.repeat(64); }],
  ['unknown remote migration', (value) => { value.remoteHistory[0].version = '20260920000000'; }],
  ['duplicate remote history', (value) => { value.remoteHistory.push(value.remoteHistory[0]); }],
  ['missing pending entry', (value) => { value.pendingVersions = []; }],
  ['already applied pending entry', (value) => { value.pendingVersions = ['20260922000000', '20260923000000']; }],
  ['unknown pending entry', (value) => { value.pendingVersions.push('20260924000000'); }],
  ['duplicate pending entry', (value) => { value.pendingVersions.push(value.pendingVersions[0]); }],
  ['repository trailing newline', (value) => { value.repository.fullName += '\n'; }],
  ['project reference trailing newline', (value) => { value.projectRef += '\n'; }],
  ['CLI version trailing newline', (value) => { value.cliVersion += '\n'; }],
  ['migration path trailing newline', (value) => { value.migrations[0].path += '\n'; }],
  ['history name trailing newline', (value) => { value.remoteHistory[0].name += '\n'; }],
]) {
  test(`plan rejects ${label}`, () => {
    const value = clone(plan); mutate(value);
    assert.throws(() => validatePlan(value, config), Error);
  });
}

test('fresh exact evidence passes, with no mutation or dependence on account display names', () => {
  const evidence = fixture();
  const original = clone(evidence);
  assert.deepEqual(verifyEvidence(evidence), {
    planHash: planHash(plan), approvalCommentId: 30001,
    approverUserId: 329510562, previewCompletedAt: completedAt,
  });
  assert.deepEqual(evidence, original);
  evidence.comment.user.login = 'renamed-human';
  evidence.run.event = 'workflow_dispatch';
  assert.equal(verifyEvidence(evidence).approvalCommentId, 30001);
});

for (const [label, mutate] of [
  ['missing comment', (value) => { value.comment = null; }],
  ['wrong current main', (value) => { value.currentMainSha = 'c'.repeat(40); }],
  ['human apply requester', (value) => { value.applyActorId = 329510562; }],
  ['human rerun requester', (value) => { value.applyTriggeringActorId = 329510562; }],
  ['missing rerun identity', (value) => { delete value.applyTriggeringActorId; }],
  ['string actor ID', (value) => { value.applyActorId = '1001'; }],
  ['wrong preview run', (value) => { value.run.id += 1; }],
  ['rerun preview', (value) => { value.run.run_attempt += 1; }],
  ['wrong preview workflow', (value) => { value.run.workflow_id += 1; }],
  ['unknown preview path', (value) => { value.run.path = '.github/workflows/other.yml'; }],
  ['different run repository', (value) => { value.run.repository.id += 1; }],
  ['fork preview', (value) => { value.run.head_repository.id += 1; }],
  ['PR preview', (value) => { value.run.event = 'pull_request'; }],
  ['PR target preview', (value) => { value.run.event = 'pull_request_target'; }],
  ['non-main preview', (value) => { value.run.head_branch = 'feature'; }],
  ['different preview SHA', (value) => { value.run.head_sha = 'c'.repeat(40); }],
  ['failed preview', (value) => { value.run.conclusion = 'failure'; }],
  ['running preview', (value) => { value.run.status = 'in_progress'; }],
  ['wrong job name', (value) => { value.planJob.name = 'deploy'; }],
  ['failed plan job', (value) => { value.planJob.conclusion = 'failure'; }],
  ['wrong job run', (value) => { value.planJob.run_id += 1; }],
  ['wrong job endpoint attempt', (value) => { value.planJobAttempt += 1; }],
  ['wrong optional job attempt', (value) => { value.planJob.run_attempt = 2; }],
  ['wrong job SHA', (value) => { value.planJob.head_sha = 'c'.repeat(40); }],
  ['missing plan completion', (value) => { delete value.planJob.completed_at; }],
  ['expired preview', (value) => { value.now = Date.parse(completedAt) + APPROVAL_TTL_MS; }],
  ['future preview', (value) => { value.now = Date.parse(completedAt) - 1000; }],
  ['invalid timestamp normalization', (value) => { value.planJob.completed_at = '2026-02-30T12:00:00Z'; }],
  ['missing explicit clock', (value) => { delete value.now; }],
  ['wrong artifact ID', (value) => { value.expectedArtifactId += 1; }],
  ['unknown artifact name', (value) => { value.artifact.name = 'plan'; }],
  ['expired artifact', (value) => { value.artifact.expired = true; }],
  ['expired artifact timestamp', (value) => { value.artifact.expires_at = '2026-09-23T12:30:00Z'; }],
  ['oversized artifact', (value) => { value.artifact.size_in_bytes = MAX_PLAN_BYTES + 1; }],
  ['missing artifact digest', (value) => { delete value.artifact.digest; }],
  ['wrong downloaded artifact digest', (value) => { value.downloadedArtifactDigest = `sha256:${'c'.repeat(64)}`; }],
  ['artifact from a later job', (value) => { value.artifact.created_at = '2026-09-23T12:01:00Z'; }],
  ['artifact from different run', (value) => { value.artifact.workflow_run.id += 1; }],
  ['artifact from fork', (value) => { value.artifact.workflow_run.head_repository_id += 1; }],
  ['artifact from non-main branch', (value) => { value.artifact.workflow_run.head_branch = 'feature'; }],
  ['artifact with changed SHA', (value) => { value.artifact.workflow_run.head_sha = 'c'.repeat(40); }],
  ['wrong comment ID', (value) => { value.expectedCommentId += 1; }],
  ['wrong issue', (value) => { value.comment.issue_url = value.comment.issue_url.replace('/225', '/165'); }],
  ['wrong issue repository', (value) => { value.comment.issue_url = 'https://api.github.com/repos/evil/onepick/issues/225'; }],
  ['wrong author numeric identity', (value) => { value.comment.user.id = 1002; }],
  ['bot approval', (value) => { value.comment.user.type = 'Bot'; }],
  ['string author ID', (value) => { value.comment.user.id = '329510562'; }],
  ['edited comment', (value) => { value.comment.updated_at = '2026-09-23T12:11:00Z'; }],
  ['approval before preview', (value) => { value.comment.created_at = value.comment.updated_at = '2026-09-23T11:59:00Z'; }],
  ['future approval', (value) => { value.comment.created_at = value.comment.updated_at = '2026-09-23T13:01:00Z'; }],
  ['trailing approval newline', (value) => { value.comment.body += '\n'; }],
  ['partial approval', (value) => { value.comment.body = 'APPROVE_DB_DEPLOY'; }],
  ['changed plan hash', (value) => { value.comment.body = value.comment.body.replace(/plan=.*/, `plan=${'c'.repeat(64)}`); }],
  ['shell-shaped comment', (value) => { value.comment.body += '; $(curl evil)'; }],
]) {
  test(`evidence rejects ${label}`, () => {
    const value = fixture(); mutate(value);
    assert.throws(() => verifyEvidence(value), Error);
  });
}

test('live comparison binds complete migration file inventory, history and pending list', () => {
  const current = { plan, migrations: clone(plan.migrations), remoteHistory: clone(plan.remoteHistory), pendingVersions: clone(plan.pendingVersions) };
  assert.equal(assertPlanMatches(current), true);
  for (const mutate of [
    (value) => { value.migrations[0].sha256 = 'f'.repeat(64); },
    (value) => { value.migrations[1].path = 'supabase/migrations/20260923000000_renamed.sql'; },
    (value) => { value.remoteHistory[0].statementsSha256 = sha256(canonicalJson(['select 2;'])); },
    (value) => { value.remoteHistory[0].name = 'changed'; },
    (value) => { value.pendingVersions = []; },
    (value) => { value.migrations.push(migration('20260924000000')); value.pendingVersions.push('20260924000000'); },
    (value) => { value.remoteHistory.push({ version: '20260923000000', name: 'example', statementsSha256: sha256('null') }); value.pendingVersions = []; },
  ]) {
    const value = clone(current); mutate(value);
    assert.throws(() => assertPlanMatches(value), Error);
  }
});
