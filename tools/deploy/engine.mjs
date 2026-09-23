import { assertReady, validatePlan, planHash, assertPlanMatches, canonicalJson } from './policy.mjs';

// Dependencies keep the state machine testable without credentials or a live DB.
// Reservation commits independently of migrations; never release it on failure.
export async function applyApprovedPlan({ config, plan, verify, readState, preview, reserve, push }) {
  assertReady(config);
  validatePlan(plan, config);
  if (!plan.pendingVersions.length) throw new Error('No pending migrations to approve');
  const expectedHash = planHash(plan);
  const recheck = async () => {
    const current = await verify();
    if (planHash(current) !== expectedHash) throw new Error('Approval evidence changed');
  };
  await recheck();
  assertPlanMatches({ plan, ...await readState() });
  await preview(plan);
  // Includes a new main-ref, comment, timestamp and artifact check.
  await recheck();
  assertPlanMatches({ plan, ...await readState() });
  if (await reserve(plan) !== true) throw new Error('Approval already consumed or reservation uncertain');
  await push();
  const after = await readState();
  const expectedHistoryVersions = plan.migrations.map((migration) => migration.version);
  if (after.pendingVersions.length ||
      JSON.stringify(after.remoteHistory.map((row) => row.version)) !== JSON.stringify(expectedHistoryVersions) ||
      canonicalJson(after.migrations) !== canonicalJson(plan.migrations)) {
    throw new Error('Post-deployment verification failed; approval remains consumed');
  }
  // Historical rows must not be rewritten by deployment.
  for (const before of plan.remoteHistory) {
    const row = after.remoteHistory.find((item) => item.version === before.version);
    if (!row || canonicalJson(row) !== canonicalJson(before)) throw new Error('Existing migration history changed');
  }
  await preview({ ...plan, ...after });
}
