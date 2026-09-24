import assert from 'node:assert/strict';
import { evaluateCloudflare, evaluateFunctions } from './check-deployment-consistency.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';

assert.deepEqual(
  evaluateCloudflare({ branch: 'main', commitSha: sha }, sha),
  { ok: true, reason: 'Cloudflare deployment matches main HEAD' },
);
assert.equal(evaluateCloudflare({ branch: 'preview', commitSha: sha }, sha).ok, false);
assert.equal(evaluateCloudflare({ branch: 'main', commitSha: 'deadbeef' }, sha).ok, false);

assert.equal(evaluateFunctions([], [], 100).ok, true);

const synced = evaluateFunctions([
  { slug: 'movie-catalog', status: 'ACTIVE', version: 4, updated_at: 200 },
], ['movie-catalog'], 100);
assert.equal(synced.ok, true);
assert.equal(synced.functions[0].ok, true);

const stale = evaluateFunctions([
  { slug: 'movie-catalog', status: 'ACTIVE', version: 4, updated_at: 99 },
], ['movie-catalog'], 100);
assert.equal(stale.ok, false);
assert.match(stale.functions[0].reason, /predates/);

const missing = evaluateFunctions([], ['movie-catalog'], 100);
assert.equal(missing.ok, false);
assert.match(missing.functions[0].reason, /not deployed/);

const inactive = evaluateFunctions([
  { slug: 'movie-catalog', status: 'FAILED', version: 5, updated_at: 200 },
], ['movie-catalog'], 100);
assert.equal(inactive.ok, false);
assert.match(inactive.functions[0].reason, /FAILED/);

console.log('Deployment consistency evaluator checks passed.');
