import fs from 'node:fs';

const DEFAULT_BASE_URL = 'https://onepick-5cl.pages.dev';
const DEFAULT_PROJECT_REF = 'ygoipwzakzdnkaaxyrgb';

export function evaluateCloudflare(deployment, expectedSha, expectedBranch = 'main') {
  if (!deployment || typeof deployment !== 'object') {
    return { ok: false, reason: 'deployment.json is unavailable or invalid' };
  }
  if (deployment.branch !== expectedBranch) {
    return { ok: false, reason: `Cloudflare branch is ${deployment.branch ?? 'unknown'}, expected ${expectedBranch}` };
  }
  if (deployment.commitSha !== expectedSha) {
    return { ok: false, reason: `Cloudflare commit is ${deployment.commitSha ?? 'unknown'}, expected ${expectedSha}` };
  }
  return { ok: true, reason: 'Cloudflare deployment matches main HEAD' };
}

export function evaluateFunctions(functions, changedSlugs, minimumUpdatedAtMs) {
  if (!changedSlugs.length) {
    return { ok: true, reason: 'No Edge Function source changed in this push', functions: [] };
  }
  const bySlug = new Map((functions ?? []).map((fn) => [fn.slug, fn]));
  const results = changedSlugs.map((slug) => {
    const fn = bySlug.get(slug);
    if (!fn) return { slug, ok: false, reason: 'function is not deployed' };
    if (fn.status !== 'ACTIVE') return { slug, ok: false, reason: `status is ${fn.status ?? 'unknown'}` };
    if (!Number.isFinite(fn.updated_at) || fn.updated_at < minimumUpdatedAtMs) {
      return { slug, ok: false, reason: 'deployment predates this main commit' };
    }
    return { slug, ok: true, reason: `ACTIVE version ${fn.version ?? 'unknown'}` };
  });
  return {
    ok: results.every((entry) => entry.ok),
    reason: results.every((entry) => entry.ok)
      ? 'Changed Edge Functions are ACTIVE with deployments newer than this main commit'
      : 'One or more changed Edge Functions have not caught up to main',
    functions: results,
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function checkOnce(config) {
  let deployment = null;
  let cloudflare;
  try {
    deployment = await fetchJson(`${config.baseUrl}/deployment.json?sha=${encodeURIComponent(config.expectedSha)}`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    cloudflare = evaluateCloudflare(deployment, config.expectedSha, config.expectedBranch);
  } catch (error) {
    cloudflare = { ok: false, reason: `deployment.json read failed: ${error instanceof Error ? error.message : 'unknown error'}` };
  }

  let edge = { ok: true, reason: 'No Edge Function source changed in this push', functions: [] };
  if (config.changedSlugs.length) {
    if (!config.supabaseToken) {
      edge = {
        ok: false,
        reason: 'SUPABASE_QA_ACCESS_TOKEN is missing; cannot verify changed Edge Functions',
        functions: config.changedSlugs.map((slug) => ({ slug, ok: false, reason: 'verification token missing' })),
      };
    } else {
      try {
        const functions = await fetchJson(
          `https://api.supabase.com/v1/projects/${config.projectRef}/functions`,
          { headers: { Authorization: `Bearer ${config.supabaseToken}` } },
        );
        edge = evaluateFunctions(functions, config.changedSlugs, config.minimumUpdatedAtMs);
      } catch (error) {
        edge = {
          ok: false,
          reason: `Supabase function status read failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          functions: config.changedSlugs.map((slug) => ({ slug, ok: false, reason: 'status read failed' })),
        };
      }
    }
  }

  return {
    ok: cloudflare.ok && edge.ok,
    checkedAt: new Date().toISOString(),
    expectedSha: config.expectedSha,
    expectedBranch: config.expectedBranch,
    deployment,
    cloudflare,
    edge,
  };
}

export async function run(config) {
  let report;
  for (let attempt = 1; attempt <= config.attempts; attempt += 1) {
    report = await checkOnce(config);
    report.attempt = attempt;
    if (report.ok) return report;
    if (attempt < config.attempts) {
      await new Promise((resolve) => setTimeout(resolve, config.intervalMs));
    }
  }
  return report;
}

function parseSlugs(value) {
  return [...new Set((value ?? '').split(',').map((item) => item.trim()).filter(Boolean))].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const expectedSha = process.env.EXPECTED_SHA?.trim();
  if (!expectedSha) throw new Error('EXPECTED_SHA is required');

  const report = await run({
    baseUrl: (process.env.DEPLOYMENT_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    expectedSha,
    expectedBranch: process.env.EXPECTED_BRANCH || 'main',
    projectRef: process.env.SUPABASE_PROJECT_REF || DEFAULT_PROJECT_REF,
    supabaseToken: process.env.SUPABASE_QA_ACCESS_TOKEN?.trim() || '',
    changedSlugs: parseSlugs(process.env.CHANGED_EDGE_FUNCTIONS),
    minimumUpdatedAtMs: Number(process.env.COMMIT_TIMESTAMP_MS || 0),
    attempts: Number(process.env.DEPLOYMENT_CHECK_ATTEMPTS || 24),
    intervalMs: Number(process.env.DEPLOYMENT_CHECK_INTERVAL_MS || 30_000),
  });

  const output = process.env.DEPLOYMENT_CHECK_OUTPUT || 'deployment-consistency.json';
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: report.ok,
    expectedSha: report.expectedSha,
    cloudflare: report.cloudflare,
    edge: report.edge,
    attempt: report.attempt,
  }, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
