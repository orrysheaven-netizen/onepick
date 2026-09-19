const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file) {
  const source = readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const local = { exports: {} };
  new Function('module', 'exports', compiled)(local, local.exports);
  return local.exports;
}
const helper = load(path.join(__dirname, '../src/lib/profileAiRetry.ts'));
let passed=0;
function test(name, fn){ fn(); passed++; console.log('PASS '+name); }

test('accepts safe server retry seconds only', () => {
  for (const value of [1, 59, 60, 599, 600, 3600]) assert.equal(helper.parseRetryAfterSeconds(value), value);
  for (const value of [0, -1, 1.5, NaN, Infinity, '600', null, 3601]) assert.equal(helper.parseRetryAfterSeconds(value), null);
});
test('reads only retry metadata from an AppError cause-shaped object', () => {
  assert.equal(helper.retryAfterSecondsFromCause({ retryAfterSeconds: 125, secret: 'ignored' }), 125);
  assert.equal(helper.retryAfterSecondsFromCause({ retryAfterSeconds: '125' }), null);
  assert.equal(helper.retryAfterSecondsFromCause(null), null);
});
test('formats seconds without false precision', () => {
  assert.equal(helper.formatRetryDelay(1), '1초');
  assert.equal(helper.formatRetryDelay(59), '59초');
  assert.equal(helper.formatRetryDelay(60), '1분');
  assert.equal(helper.formatRetryDelay(61), '2분');
  assert.equal(helper.formatRetryDelay(600), '10분');
});
const server=readFileSync(path.join(__dirname, '../../supabase/functions/analyze-profile-taste/index.ts'),'utf8');
test('server returns retry metadata without rereading a successful reservation', () => {
  assert.match(server,/retryAfterSeconds: Math\.max/);
  assert.match(server,/reserved !== true[\s\S]*retryAfterSeconds: await readRetryAfterSeconds/);
  assert.match(server,/reservationGrantedAt = Date\.now\(\)/);
  assert.match(server,/AI_PROVIDER_FAILED[\s\S]*reservedRetryAfterSeconds\(\)/);
  assert.match(server,/AI_REVIEW_STALE[\s\S]*reservedRetryAfterSeconds\(\)/);
  assert.doesNotMatch(server,/retryAfterReservation = await readRetryAfterSeconds/);
});
console.log(`${passed} AI retry metadata tests passed. No network or model calls.`);
