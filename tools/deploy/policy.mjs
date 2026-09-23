import { createHash } from 'node:crypto';

export const MAX_PLAN_BYTES = 1024 * 1024;
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const VERSION = /^[0-9]{14}$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const READINESS_KEYS = ['identitySeparated', 'environmentSecretsOnly', 'mainProtected', 'ledgerBootstrapped', 'exclusiveSchemaControl', 'disposableApplyVerified', 'humanFlowVerified'];

function fail(message) { throw new Error(`Deployment policy: ${message}`); }
function check(condition, message) { if (!condition) fail(message); }
function object(value, label) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  check(prototype === Object.prototype || prototype === null, `${label} must be plain data`);
  return value;
}
function keys(value, expected, label) {
  object(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  check(actual.length === wanted.length && actual.every((key, index) => key === wanted[index]), `${label} has missing or unknown fields`);
}
function integer(value, label) { check(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer`); }
function string(value, pattern, label, max = 512) {
  const match = typeof value === 'string' && value.length <= max ? pattern.exec(value) : null;
  check(match !== null && match[0] === value, `${label} has invalid format`);
}
function bool(value, label) { check(typeof value === 'boolean', `${label} must be boolean`); }
function list(value, label) { check(Array.isArray(value) && value.length <= 10000, `${label} must be a bounded array`); }
function timestamp(value, label) {
  string(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/, label, 24);
  const result = Date.parse(value);
  check(Number.isFinite(result), `${label} must be a valid timestamp`);
  // Reject dates that Date.parse silently rolls into a different month.
  check(new Date(result).toISOString().slice(0, 19) === value.slice(0, 19), `${label} must be a valid timestamp`);
  return result;
}

// JSON.parse silently accepts duplicate keys. Evidence must never have two
// interpretations, including keys that become equal after escape decoding.
export function parseStrictJson(text, { maxBytes = MAX_PLAN_BYTES } = {}) {
  check(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= MAX_PLAN_BYTES, 'invalid JSON size limit');
  check(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= maxBytes, 'JSON exceeds size limit');
  let position = 0;
  let nodes = 0;
  const whitespace = () => { while (/[\t\r\n ]/.test(text[position] ?? '\0')) position += 1; };
  const readString = () => {
    const start = position++;
    while (position < text.length) {
      const character = text[position++];
      if (character === '"') {
        let result;
        try { result = JSON.parse(text.slice(start, position)); } catch { fail('invalid JSON string'); }
        check(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(result), 'unpaired Unicode surrogate');
        return result;
      }
      if (character === '\\') position += 1;
    }
    fail('unterminated JSON string');
  };
  const read = (depth) => {
    check(depth <= 32 && ++nodes <= 100000, 'JSON nesting or node limit exceeded');
    whitespace();
    const character = text[position];
    if (character === '"') return readString();
    if (character === '{') {
      position += 1;
      const result = Object.create(null);
      whitespace();
      if (text[position] === '}') { position += 1; return result; }
      while (true) {
        whitespace();
        check(text[position] === '"', 'invalid JSON object key');
        const key = readString();
        check(!Object.hasOwn(result, key), 'duplicate JSON key');
        whitespace();
        check(text[position++] === ':', 'missing JSON colon');
        result[key] = read(depth + 1);
        whitespace();
        const delimiter = text[position++];
        if (delimiter === '}') return result;
        check(delimiter === ',', 'invalid JSON object delimiter');
      }
    }
    if (character === '[') {
      position += 1;
      const result = [];
      whitespace();
      if (text[position] === ']') { position += 1; return result; }
      while (true) {
        result.push(read(depth + 1));
        whitespace();
        const delimiter = text[position++];
        if (delimiter === ']') return result;
        check(delimiter === ',', 'invalid JSON array delimiter');
      }
    }
    for (const [literal, value] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, position)) { position += literal.length; return value; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(position));
    check(number, 'invalid JSON value');
    position += number[0].length;
    const result = Number(number[0]);
    check(Number.isFinite(result), 'non-finite JSON number');
    return result;
  };
  const result = read(0);
  whitespace();
  check(position === text.length, 'trailing JSON data');
  return result;
}

export function canonicalJson(value) {
  let count = 0;
  const visit = (item, depth) => {
    check(depth <= 32 && ++count <= 100000, 'canonical JSON limit exceeded');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number') {
      check(Number.isSafeInteger(item) && !Object.is(item, -0), 'canonical JSON requires safe integers');
      return JSON.stringify(item);
    }
    if (Array.isArray(item)) {
      const arrayKeys = Object.keys(item);
      check(item.length <= 10000 && arrayKeys.length === item.length && arrayKeys.every((key, index) => key === String(index)) && Object.getOwnPropertySymbols(item).length === 0, 'invalid canonical array');
      return `[${item.map((element) => visit(element, depth + 1)).join(',')}]`;
    }
    object(item, 'canonical value');
    check(Object.getOwnPropertySymbols(item).length === 0, 'canonical object has symbol keys');
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${visit(item[key], depth + 1)}`).join(',')}}`;
  };
  const result = visit(value, 0);
  check(Buffer.byteLength(result, 'utf8') <= MAX_PLAN_BYTES, 'canonical JSON exceeds size limit');
  return result;
}

export function sha256(value) {
  check(typeof value === 'string' || Buffer.isBuffer(value), 'hash input must be bytes or text');
  return createHash('sha256').update(value).digest('hex');
}

export function validateConfig(config, { requireEnabled = false } = {}) {
  keys(config, ['schemaVersion', 'enabled', 'repositoryId', 'repository', 'projectRef', 'environment', 'workflowPath', 'cliVersion', 'approvalIssueNumber', 'automationActorId', 'approverUserIds', 'readiness'], 'config');
  check(config.schemaVersion === 1, 'unsupported config version');
  bool(config.enabled, 'enabled');
  integer(config.repositoryId, 'repository ID');
  string(config.repository, REPOSITORY, 'repository');
  string(config.projectRef, /^[a-z]{20}$/, 'project reference');
  check(config.environment === 'Production', 'environment must be Production');
  check(config.workflowPath === '.github/workflows/database-deploy.yml', 'unknown workflow path');
  string(config.cliVersion, /^\d+\.\d+\.\d+$/, 'pinned CLI version', 30);
  integer(config.approvalIssueNumber, 'approval issue number');
  if (config.automationActorId !== null) integer(config.automationActorId, 'automation actor ID');
  list(config.approverUserIds, 'approver IDs');
  check(config.approverUserIds.length > 0 && config.approverUserIds.length <= 20, 'at least one approver is required');
  config.approverUserIds.forEach((id) => integer(id, 'approver ID'));
  check(new Set(config.approverUserIds).size === config.approverUserIds.length, 'duplicate approver ID');
  check(!config.approverUserIds.includes(config.automationActorId), 'automation and approver identities must differ');
  keys(config.readiness, READINESS_KEYS, 'readiness');
  for (const key of READINESS_KEYS) bool(config.readiness[key], key);
  if (requireEnabled || config.enabled) {
    check(config.enabled === true, 'automated apply is disabled');
    integer(config.automationActorId, 'configured automation actor ID');
    check(READINESS_KEYS.every((key) => config.readiness[key] === true), 'activation prerequisites incomplete');
  }
  return config;
}

export function assertReady(config) { return validateConfig(config, { requireEnabled: true }); }

function sortedUniqueVersions(values, label) {
  list(values, label);
  let previous = '';
  for (const value of values) {
    string(value, VERSION, `${label} version`, 14);
    check(value > previous, `${label} must have unique ascending versions`);
    previous = value;
  }
}

function validatePlanShape(plan) {
  keys(plan, ['schemaVersion', 'repository', 'projectRef', 'environment', 'commitSha', 'preview', 'cliVersion', 'migrations', 'remoteHistory', 'pendingVersions'], 'plan');
  check(plan.schemaVersion === 1, 'unsupported plan version');
  keys(plan.repository, ['id', 'fullName'], 'plan repository');
  integer(plan.repository.id, 'plan repository ID');
  string(plan.repository.fullName, REPOSITORY, 'plan repository');
  string(plan.projectRef, /^[a-z]{20}$/, 'plan project reference');
  check(plan.environment === 'Production', 'plan environment must be Production');
  string(plan.commitSha, SHA, 'commit SHA', 40);
  keys(plan.preview, ['workflowId', 'workflowPath', 'runId', 'runAttempt'], 'preview');
  for (const key of ['workflowId', 'runId', 'runAttempt']) integer(plan.preview[key], key);
  check(plan.preview.workflowPath === '.github/workflows/database-deploy.yml', 'unknown plan workflow path');
  string(plan.cliVersion, /^\d+\.\d+\.\d+$/, 'plan CLI version', 30);
  list(plan.migrations, 'migrations');
  check(plan.migrations.length > 0, 'migration inventory is empty');
  for (const migration of plan.migrations) {
    keys(migration, ['version', 'path', 'sha256'], 'migration');
    string(migration.version, VERSION, 'migration version', 14);
    string(migration.path, new RegExp(`^supabase/migrations/${migration.version}_[a-z0-9_]+\\.sql$`), 'migration path', 250);
    string(migration.sha256, HASH, 'migration hash', 64);
  }
  sortedUniqueVersions(plan.migrations.map(({ version }) => version), 'migrations');
  list(plan.remoteHistory, 'remote history');
  for (const row of plan.remoteHistory) {
    keys(row, ['version', 'name', 'statementsSha256'], 'history row');
    string(row.version, VERSION, 'history version', 14);
    if (row.name !== null) string(row.name, /^[a-z0-9_]{1,200}$/, 'history name', 200);
    string(row.statementsSha256, HASH, 'history statements hash', 64);
  }
  sortedUniqueVersions(plan.remoteHistory.map(({ version }) => version), 'remote history');
  sortedUniqueVersions(plan.pendingVersions, 'pending migrations');
  const local = new Set(plan.migrations.map(({ version }) => version));
  const applied = new Set(plan.remoteHistory.map(({ version }) => version));
  check([...applied].every((version) => local.has(version)), 'remote history contains unknown migrations');
  const expectedPending = plan.migrations.filter(({ version }) => !applied.has(version)).map(({ version }) => version);
  check(canonicalJson(expectedPending) === canonicalJson(plan.pendingVersions), 'pending migrations disagree with local and remote history');
  canonicalJson(plan);
  return plan;
}

export function validatePlan(plan, config) {
  validatePlanShape(plan);
  validateConfig(config);
  check(plan.repository.id === config.repositoryId && plan.repository.fullName === config.repository, 'plan repository mismatch');
  check(plan.projectRef === config.projectRef && plan.environment === config.environment, 'plan target mismatch');
  check(plan.preview.workflowPath === config.workflowPath, 'plan workflow mismatch');
  check(plan.cliVersion === config.cliVersion, 'plan CLI version mismatch');
  return plan;
}

export function createPlan(input, config) {
  // Clone through the strict parser: no references to caller-owned nested data.
  const plan = parseStrictJson(canonicalJson(input));
  list(plan.migrations, 'migrations');
  list(plan.remoteHistory, 'remote history');
  list(plan.pendingVersions, 'pending migrations');
  plan.migrations.sort((a, b) => String(a?.version).localeCompare(String(b?.version), 'en'));
  plan.remoteHistory.sort((a, b) => String(a?.version).localeCompare(String(b?.version), 'en'));
  plan.pendingVersions.sort();
  return validatePlan(plan, config);
}

export function planHash(plan) { validatePlanShape(plan); return sha256(canonicalJson(plan)); }

export function approvalStatement(plan) {
  return `APPROVE_DB_DEPLOY v1 repo=${plan.repository.fullName} project=${plan.projectRef} sha=${plan.commitSha} run=${plan.preview.runId} attempt=${plan.preview.runAttempt} plan=${planHash(plan)}`;
}

export function assertPlanMatches({ plan, migrations, remoteHistory, pendingVersions }) {
  validatePlanShape(plan);
  const observed = { ...plan, migrations, remoteHistory, pendingVersions };
  validatePlanShape(observed);
  check(canonicalJson(plan) === canonicalJson(observed), 'live migration files, history, or pending list changed');
  return true;
}

export function verifyEvidence({ config, plan, run, planJob, planJobAttempt, artifact, expectedArtifactId, downloadedArtifactDigest, comment, expectedCommentId, currentMainSha, applyActorId, applyTriggeringActorId, now }) {
  assertReady(config);
  validatePlan(plan, config);
  integer(applyActorId, 'apply actor ID');
  integer(applyTriggeringActorId, 'apply triggering actor ID');
  check(applyActorId === config.automationActorId && applyTriggeringActorId === config.automationActorId, 'apply requester must be the configured automation identity');
  string(currentMainSha, SHA, 'current main SHA', 40);
  check(currentMainSha === plan.commitSha, 'main moved since preview');
  check(Number.isSafeInteger(now) && now > 0, 'current time must be explicit milliseconds');

  object(run, 'preview run');
  object(run.repository, 'run repository');
  object(run.head_repository, 'run head repository');
  check(run.id === plan.preview.runId && run.run_attempt === plan.preview.runAttempt, 'preview run identity mismatch');
  check(run.workflow_id === plan.preview.workflowId && run.path === config.workflowPath, 'preview workflow mismatch');
  check(run.repository.id === config.repositoryId && run.repository.full_name === config.repository, 'preview repository mismatch');
  check(run.head_repository.id === config.repositoryId && run.head_repository.full_name === config.repository, 'fork preview rejected');
  check(run.head_branch === 'main' && run.head_sha === plan.commitSha, 'preview must use approved main commit');
  check(['push', 'workflow_dispatch'].includes(run.event), 'preview event rejected');
  check(run.status === 'completed' && run.conclusion === 'success', 'preview run must succeed');
  object(planJob, 'plan job');
  // The adapter must fetch /runs/<id>/attempts/<attempt>/jobs. Some GitHub
  // versions omit run_attempt from each job, so retain the bound fetch attempt.
  check(planJob.name === 'plan' && planJob.run_id === plan.preview.runId && planJobAttempt === plan.preview.runAttempt, 'plan job identity mismatch');
  check(planJob.run_attempt === undefined || planJob.run_attempt === plan.preview.runAttempt, 'plan job attempt mismatch');
  check(planJob.head_sha === plan.commitSha && planJob.status === 'completed' && planJob.conclusion === 'success', 'plan job must succeed on approved commit');
  const completed = timestamp(planJob.completed_at, 'plan completion time');
  check(completed <= now && now - completed < APPROVAL_TTL_MS, 'preview approval window expired or future');

  object(artifact, 'artifact');
  integer(expectedArtifactId, 'expected artifact ID');
  check(artifact.id === expectedArtifactId, 'artifact ID mismatch');
  check(artifact.name === `db-deployment-plan-${plan.preview.runId}-${plan.preview.runAttempt}`, 'artifact name mismatch');
  check(artifact.expired === false, 'artifact expired');
  check(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= MAX_PLAN_BYTES, 'artifact size rejected');
  string(artifact.digest, /^sha256:[a-f0-9]{64}$/, 'artifact digest', 71);
  check(artifact.digest === downloadedArtifactDigest, 'downloaded artifact digest mismatch');
  check(timestamp(artifact.expires_at, 'artifact expiry') > now, 'artifact expired');
  check(timestamp(artifact.created_at, 'artifact creation') <= completed, 'artifact created after plan completion');
  object(artifact.workflow_run, 'artifact workflow run');
  check(artifact.workflow_run.id === plan.preview.runId && artifact.workflow_run.repository_id === config.repositoryId && artifact.workflow_run.head_repository_id === config.repositoryId, 'artifact run repository mismatch');
  check(artifact.workflow_run.head_branch === 'main' && artifact.workflow_run.head_sha === plan.commitSha, 'artifact commit mismatch');

  object(comment, 'approval comment');
  integer(expectedCommentId, 'expected comment ID');
  check(comment.id === expectedCommentId, 'approval comment ID mismatch');
  check(comment.issue_url === `https://api.github.com/repos/${config.repository}/issues/${config.approvalIssueNumber}`, 'approval issue mismatch');
  object(comment.user, 'approval author');
  integer(comment.user.id, 'approval author ID');
  check(comment.user.type === 'User' && config.approverUserIds.includes(comment.user.id), 'approval author is not an allowed human');
  check(comment.user.id !== applyActorId && comment.user.id !== config.automationActorId, 'approval author cannot be automation');
  check(comment.body === approvalStatement(plan), 'approval statement mismatch');
  const created = timestamp(comment.created_at, 'approval creation');
  check(comment.updated_at === comment.created_at, 'edited approval rejected');
  check(created >= completed && created <= now, 'approval must follow preview and not be in the future');
  return { planHash: planHash(plan), approvalCommentId: comment.id, approverUserId: comment.user.id, previewCompletedAt: planJob.completed_at };
}
