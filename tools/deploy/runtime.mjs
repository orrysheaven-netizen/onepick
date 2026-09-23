import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseStrictJson, canonicalJson, sha256, validateConfig, assertReady,
  createPlan, planHash, approvalStatement, verifyEvidence, MAX_PLAN_BYTES } from './policy.mjs';
import { applyApprovedPlan } from './engine.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONFIG = new URL('./config.json', import.meta.url);
const fail = (code) => { throw new Error(code); };
export function id(value) {
  if (!/^[1-9][0-9]{0,15}$/.test(String(value)) || !Number.isSafeInteger(Number(value)) ||
      String(value) !== String(Number(value))) fail('INVALID_ID');
  return Number(value);
}

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { cwd: ROOT, encoding: 'utf8', timeout: 900000,
    maxBuffer: 16 * 1024 * 1024, shell: false, ...options });
  // CLI/API error strings may contain credentials; never print them.
  if (result.error || result.status !== 0) fail('DEPLOYMENT_COMMAND_FAILED');
  return result.stdout;
}

export function readMigrations(root = ROOT) {
  const directory = path.join(root, 'supabase', 'migrations');
  return fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort().map((name) => {
    const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(name);
    const fullPath = path.join(directory, name);
    const stat = fs.lstatSync(fullPath);
    if (!match || !stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PLAN_BYTES) fail('INVALID_MIGRATION_FILE');
    return { version: match[1], path: `supabase/migrations/${name}`, sha256: sha256(fs.readFileSync(fullPath)) };
  });
}

export function normalizeHistory(rows) {
  if (!Array.isArray(rows) || rows.length > 10000) fail('INVALID_HISTORY');
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || Object.keys(row).sort().join(',') !== 'name,statements,version' ||
        !(row.statements === null || (Array.isArray(row.statements) && row.statements.every((sql) => typeof sql === 'string')))) fail('INVALID_HISTORY');
    return { version: row.version, name: row.name, statementsSha256: sha256(canonicalJson(row.statements)) };
  }).sort((a, b) => String(a.version).localeCompare(String(b.version), 'en'));
}

export function assertDryRun(output, plan) {
  // CLI is pinned. An unrecognized output format fails closed.
  const clean = output.replace(/\u001b\[[0-9;]*m/g, '');
  const marker = clean.split(/\r?\n/).findIndex((line) => line.trim() === 'Would push these migrations:');
  if (!plan.pendingVersions.length) {
    if (marker !== -1 || !/(Remote database is up to date|No (?:new |pending )?migrations to (?:apply|push))/i.test(clean)) fail('UNEXPECTED_DRY_RUN');
    return;
  }
  if (marker < 0) fail('MISSING_DRY_RUN_PLAN');
  const lines = clean.split(/\r?\n/).slice(marker + 1);
  const filenames = lines.filter((line) => /^\s*[•*-]\s/.test(line)).map((line) => {
    const match = /^\s*[•*-]\s+(\d{14}_[a-z0-9_]+\.sql)\s*$/.exec(line);
    if (!match) fail('INVALID_DRY_RUN_FILENAME');
    return match[1];
  });
  const expected = plan.migrations.filter((file) => plan.pendingVersions.includes(file.version)).map((file) => path.posix.basename(file.path));
  if (JSON.stringify(filenames) !== JSON.stringify(expected)) fail('DRY_RUN_PLAN_CHANGED');
}

export function reservationQuery(config, plan, commentId, runId, runAttempt) {
  assertReady(config);
  // createPlan/planHash validates every interpolated identifier, digest and ID.
  const hash = planHash(createPlan(plan, config));
  const values = [id(config.repositoryId), id(commentId), `'${hash}'`, `'${config.projectRef}'`,
    `'${plan.commitSha}'`, id(plan.preview.runId), id(plan.preview.runAttempt), id(runId), id(runAttempt)];
  return `insert into private.database_deployment_approvals
    (repository_id,approval_comment_id,plan_hash,project_ref,commit_sha,preview_run_id,preview_run_attempt,apply_run_id,apply_run_attempt)
    values (${values.join(',')}) on conflict (repository_id,approval_comment_id) do nothing returning approval_comment_id::text;`;
}

async function readBounded(response, maxBytes) {
  if (!response.body || Number(response.headers.get('content-length') || 0) > maxBytes) fail('RESPONSE_TOO_LARGE');
  const reader = response.body.getReader();
  const parts = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) { await reader.cancel(); fail('RESPONSE_TOO_LARGE'); }
      parts.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}

export class Runtime {
  constructor(config, env = process.env, fetchImpl = fetch) {
    this.config = validateConfig(config); this.env = env; this.fetch = fetchImpl;
  }
  async github(suffix) {
    if (!this.env.GH_TOKEN) fail('MISSING_GITHUB_TOKEN');
    const response = await this.fetch(`https://api.github.com/repos/${this.config.repository}/${suffix}`, {
      headers: { Authorization: `Bearer ${this.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) fail('GITHUB_READ_FAILED');
    return JSON.parse((await readBounded(response, 16 * MAX_PLAN_BYTES)).toString('utf8'));
  }
  async pages(suffix, key) {
    const all = [];
    for (let page = 1; page <= 100; page++) {
      const result = await this.github(`${suffix}?per_page=100&page=${page}`);
      if (!Array.isArray(result[key])) fail('INVALID_GITHUB_LIST');
      all.push(...result[key]);
      if (result[key].length < 100) return all;
    }
    fail('GITHUB_LIST_TOO_LARGE');
  }
  async query(sql, readOnly = true) {
    if (!this.env.SUPABASE_ACCESS_TOKEN) fail('MISSING_DEPLOYMENT_TOKEN');
    const response = await this.fetch(`https://api.supabase.com/v1/projects/${this.config.projectRef}/database/query${readOnly ? '/read-only' : ''}`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }), redirect: 'error', signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) fail('DATABASE_QUERY_FAILED');
    return JSON.parse((await readBounded(response, 16 * MAX_PLAN_BYTES)).toString('utf8'));
  }
  async state() {
    const migrations = readMigrations();
    const remoteHistory = normalizeHistory(await this.query('select version, name, statements from supabase_migrations.schema_migrations order by version;'));
    return { migrations, remoteHistory, pendingVersions: migrations.filter((file) => !remoteHistory.some((row) => row.version === file.version)).map((file) => file.version) };
  }
  cli(args) { return command('supabase', args, { env: this.env }); }
  link() {
    if (!this.env.SUPABASE_ACCESS_TOKEN || !this.env.SUPABASE_DB_PASSWORD) fail('MISSING_DEPLOYMENT_SECRETS');
    if (this.cli(['--version']).trim() !== this.config.cliVersion) fail('CLI_VERSION_MISMATCH');
    this.cli(['link', '--project-ref', this.config.projectRef]);
  }
  preview(plan) {
    // Capture both streams because CLI versions use stderr for some notices.
    const result = spawnSync('supabase', ['db', 'push', '--linked', '--dry-run', '--include-all', '--skip-vault'],
      { cwd: ROOT, env: this.env, encoding: 'utf8', shell: false, timeout: 300000, maxBuffer: 4 * MAX_PLAN_BYTES });
    if (result.error || result.status !== 0) fail('DRY_RUN_FAILED');
    assertDryRun(`${result.stdout}\n${result.stderr}`, plan);
  }
  async context() {
    const config = this.config;
    const run = await this.github(`actions/runs/${id(this.env.GITHUB_RUN_ID)}`);
    const workflow = await this.github('actions/workflows/database-deploy.yml');
    const branch = await this.github('branches/main');
    const sha = command('git', ['rev-parse', 'HEAD']).trim();
    if (this.env.GITHUB_REF !== 'refs/heads/main' || this.env.GITHUB_REPOSITORY !== config.repository ||
        id(this.env.GITHUB_REPOSITORY_ID) !== config.repositoryId || run.repository.id !== config.repositoryId ||
        run.head_repository.id !== config.repositoryId || run.head_branch !== 'main' || run.head_sha !== sha ||
        sha !== this.env.GITHUB_SHA || branch.commit.sha !== sha || run.workflow_id !== workflow.id ||
        workflow.path !== config.workflowPath || !['push', 'workflow_dispatch'].includes(run.event) ||
        run.run_attempt !== id(this.env.GITHUB_RUN_ATTEMPT)) fail('WORKFLOW_CONTEXT_MISMATCH');
    return { run, workflow, sha };
  }
  async download(artifact) {
    const response = await this.fetch(`https://api.github.com/repos/${this.config.repository}/actions/artifacts/${id(artifact.id)}/zip`, {
      headers: { Authorization: `Bearer ${this.env.GH_TOKEN}` }, redirect: 'manual', signal: AbortSignal.timeout(30000),
    });
    if (response.status !== 302) fail('ARTIFACT_REDIRECT_FAILED');
    const url = new URL(response.headers.get('location'));
    if (url.protocol !== 'https:' || url.username || url.password ||
        !(url.hostname.endsWith('.blob.core.windows.net') || url.hostname.endsWith('.githubusercontent.com'))) fail('ARTIFACT_HOST_REJECTED');
    // Never forward the GitHub token to artifact storage.
    const download = await this.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!download.ok) fail('ARTIFACT_DOWNLOAD_FAILED');
    const zip = await readBounded(download, MAX_PLAN_BYTES);
    const digest = `sha256:${sha256(zip)}`;
    if (artifact.digest !== digest) fail('ARTIFACT_DIGEST_MISMATCH');
    const extracted = command(process.platform === 'win32' ? 'python' : 'python3',
      [fileURLToPath(new URL('./read-plan-archive.py', import.meta.url))], { input: zip, maxBuffer: MAX_PLAN_BYTES });
    return { plan: parseStrictJson(extracted), digest };
  }
  async verify() {
    assertReady(this.config); // Before any use of Supabase secrets or downloaded evidence.
    const context = await this.context();
    if (context.run.event !== 'workflow_dispatch') fail('APPLY_REQUIRES_MANUAL_DISPATCH');
    const runId = id(this.env.PREVIEW_RUN_ID), commentId = id(this.env.APPROVAL_COMMENT_ID);
    const run = await this.github(`actions/runs/${runId}`);
    const attempt = id(run.run_attempt);
    const jobs = await this.pages(`actions/runs/${runId}/attempts/${attempt}/jobs`, 'jobs');
    const plans = jobs.filter((job) => job.name === 'plan');
    const artifacts = (await this.pages(`actions/runs/${runId}/artifacts`, 'artifacts'))
      .filter((item) => item.name === `db-deployment-plan-${runId}-${attempt}`);
    if (plans.length !== 1 || artifacts.length !== 1) fail('AMBIGUOUS_PLAN_EVIDENCE');
    const artifact = artifacts[0];
    const { plan, digest } = await this.download(artifact);
    const comment = await this.github(`issues/comments/${commentId}`);
    if (plan.preview.workflowId !== context.workflow.id) fail('WORKFLOW_ID_MISMATCH');
    const evidence = { config: this.config, plan, run, planJob: plans[0], planJobAttempt: attempt, artifact,
      expectedArtifactId: artifact.id, downloadedArtifactDigest: digest, comment, expectedCommentId: commentId,
      currentMainSha: context.sha, applyActorId: context.run.actor.id,
      applyTriggeringActorId: context.run.triggering_actor.id, now: Date.now() };
    verifyEvidence(evidence);
    // The approved inventory must match this trusted checkout even without DB access.
    if (canonicalJson(plan.migrations) !== canonicalJson(readMigrations())) fail('CHECKOUT_INVENTORY_MISMATCH');
    this.evidence = evidence;
    return plan;
  }
  async recheckForReservation(plan) {
    if (!this.evidence || planHash(this.evidence.plan) !== planHash(plan)) fail('MISSING_VERIFIED_EVIDENCE');
    // Keep the last gate small: slow archive/history reads have already finished.
    // A deleted/edited comment or newer main must stop the reservation.
    const branch = await this.github('branches/main');
    const comment = await this.github(`issues/comments/${id(this.env.APPROVAL_COMMENT_ID)}`);
    verifyEvidence({ ...this.evidence, currentMainSha: branch.commit.sha, comment, now: Date.now() });
  }
  async makePlan() {
    const { run, workflow, sha } = await this.context();
    this.link();
    const state = await this.state();
    const plan = createPlan({ schemaVersion: 1, repository: { id: this.config.repositoryId, fullName: this.config.repository },
      projectRef: this.config.projectRef, environment: this.config.environment, commitSha: sha,
      preview: { workflowId: workflow.id, workflowPath: workflow.path, runId: run.id, runAttempt: run.run_attempt },
      cliVersion: this.config.cliVersion, ...state }, this.config);
    this.preview(plan);
    const after = await this.state();
    if (canonicalJson(state) !== canonicalJson(after)) fail('PREVIEW_STATE_CHANGED');
    const directory = path.join(ROOT, 'work', 'db-deployment-plan');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'plan.json'), canonicalJson(plan) + '\n');
    const summary = ['## Database deployment plan', `Commit: \`${sha}\``, `Target: \`${this.config.projectRef}\``,
      `Pending migrations: ${plan.pendingVersions.length}`, ...plan.migrations.filter((file) => plan.pendingVersions.includes(file.version)).map((file) => `- ${file.path}`),
      '', 'Human approval text (copy only after review; automated apply is disabled until activation):',
      '```text', approvalStatement(plan), '```', 'Approver and automation must use separate credentials.', ''].join('\n');
    if (this.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(this.env.GITHUB_STEP_SUMMARY, summary);
    return plan;
  }
  async apply() {
    const plan = await this.verify();
    this.link();
    await applyApprovedPlan({ config: this.config, plan, verify: () => this.verify(), readState: () => this.state(),
      preview: (current) => this.preview(current), reserve: async (approved) => {
        await this.recheckForReservation(approved);
        const rows = await this.query(reservationQuery(this.config, approved, id(this.env.APPROVAL_COMMENT_ID),
          id(this.env.GITHUB_RUN_ID), id(this.env.GITHUB_RUN_ATTEMPT)), false);
        return Array.isArray(rows) && rows.length === 1 && rows[0].approval_comment_id === String(id(this.env.APPROVAL_COMMENT_ID));
      }, push: () => { this.cli(['db', 'push', '--linked', '--include-all', '--skip-vault', '--yes']); } });
    if (this.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(this.env.GITHUB_STEP_SUMMARY,
      `## Database apply verified\nCommit: ${plan.commitSha}\nApproval: ${id(this.env.APPROVAL_COMMENT_ID)} (consumed)\n`);
  }
}

export async function main(mode) {
  const config = parseStrictJson(fs.readFileSync(CONFIG, 'utf8'));
  const runtime = new Runtime(config);
  if (mode === 'plan') await runtime.makePlan();
  else if (mode === 'verify') await runtime.verify();
  else if (mode === 'apply') await runtime.apply();
  else fail('UNKNOWN_MODE');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(() => {
    // No raw error, API body, SQL or CLI output: any could contain secrets.
    console.error('Database deployment blocked or failed. Check configuration and approval evidence; never reuse a consumed approval.');
    process.exitCode = 1;
  });
}
