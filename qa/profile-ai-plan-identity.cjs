// Hashes identify a QA recipe, not a signed attestation or an approval.
const { createHash } = require('node:crypto');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
function planFingerprint(plan) {
  if (plan?.identityVersion !== 2 || !['direct', 'warm'].includes(plan.tone)) {
    throw new Error('QA_PLAN_IDENTITY_V2_REQUIRED');
  }
  return sha256(JSON.stringify({
    identityVersion: 2, tone: plan.tone, datasetHash: plan.datasetHash,
    repeats: plan.repeats, model: plan.model, promptVersion: plan.promptVersion,
    promptHash: plan.promptHash, schemaHash: plan.schemaHash,
    contractVersion: plan.contractVersion,
    maximumCalls: plan.maximumCalls,
    maximumOutputTokensPerCall: plan.maximumOutputTokensPerCall,
    sources: Object.entries(plan.sourceHashes).sort(([a], [b]) => a.localeCompare(b)),
    requests: plan.cases.map(({ id, inputHash, requestHash }) => ({ id, inputHash, requestHash })),
  }));
}
module.exports = { planFingerprint, sha256 };
