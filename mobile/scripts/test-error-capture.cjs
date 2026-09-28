const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function load(relative) {
  const exports = {};
  const output = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { exports, Error, Number, Map, Set, String }, { filename: relative });
  return exports;
}

class AppError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AppError';
    this.code = code;
  }
}

// Which failures get recorded.
const capture = load('src/lib/query/errorCapture.ts');
for (const code of ['INTERNAL_ERROR', 'FORBIDDEN', 'AUTH_FAILED', 'CATALOG_NOT_CONFIGURED', 'ACCOUNT_DELETE_FAILED', 'RATE_LIMITED']) {
  assert.equal(capture.capturedErrorCode(new AppError(code)), code, `${code} is an operational error`);
}
for (const code of ['PROFILE_NOT_FOUND', 'ITEM_NOT_FOUND', 'USERNAME_TAKEN', 'REVIEW_INVALID', 'AUTH_REQUIRED', 'NETWORK_ERROR', 'REPORT_DUPLICATE']) {
  assert.equal(capture.capturedErrorCode(new AppError(code)), null, `${code} is an expected outcome, not recorded`);
}
assert.equal(capture.capturedErrorCode(new TypeError('Failed to fetch')), 'UNEXPECTED_ERROR');
assert.equal(capture.capturedErrorCode({ code: 'PGRST116', message: 'raw' }), 'UNEXPECTED_ERROR', 'unmapped errors are unexpected');
assert.equal(capture.capturedErrorCode('boom'), 'UNEXPECTED_ERROR');

// Context labels stay within the spike monitor's safe alphabet.
assert.equal(capture.errorCaptureContext('query', ['profiles', 'mine', 'id']), 'query:profiles');
assert.equal(capture.errorCaptureContext('mutation', undefined), 'mutation:unnamed');
assert.equal(capture.errorCaptureContext('query', ['내 프로필 <x>']), 'query:_______x_');
assert.match(capture.errorCaptureContext('query', ['x'.repeat(200)]), /^query:x{60}$/);

// Rate limit: same key once per window, and a global cap per window.
const gate = capture.createErrorCaptureGate(60_000, 3);
assert.equal(gate('a', 0), true);
assert.equal(gate('a', 1_000), false, 'same failure is not recorded twice within a minute');
assert.equal(gate('b', 2_000), true);
assert.equal(gate('c', 3_000), true);
assert.equal(gate('d', 4_000), false, 'global cap per window');
assert.equal(gate('a', 61_000), true, 'recorded again after the window');

// Stale deploy chunk handling.
const chunk = load('src/lib/web/chunkReload.ts');
assert.equal(chunk.isChunkLoadError(Object.assign(new Error('Loading chunk 42 failed.'), { name: 'ChunkLoadError' })), true);
assert.equal(chunk.isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/_expo/a.js')), true);
assert.equal(chunk.isChunkLoadError(new SyntaxError("Unexpected token '<'")), true);
assert.equal(chunk.isChunkLoadError(new Error('Cannot read properties of undefined')), false);
assert.equal(chunk.isChunkLoadError('Loading chunk 1 failed'), false);

const memory = new Map();
const store = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
assert.equal(chunk.claimChunkReload(store, 100_000), true, 'first stale chunk reloads');
assert.equal(chunk.claimChunkReload(store, 110_000), false, 'no reload loop within the cooldown');
assert.equal(chunk.claimChunkReload(store, 140_000), true, 'allowed again after the cooldown');
assert.equal(chunk.claimChunkReload(undefined, 0), true, 'no storage still allows one reload');
assert.equal(chunk.claimChunkReload({ getItem() { throw new Error('blocked'); }, setItem() {} }, 0), true);

// Wiring.
const queryClient = read('src/lib/query/queryClient.ts');
assert.match(queryClient, /queryCache: new QueryCache\(\{\s*onError: \(error, query\) => captureFailure\(error, errorCaptureContext\('query', query\.queryKey\)\)/);
assert.match(queryClient, /mutationCache: new MutationCache\(/);
assert.match(queryClient, /if \(!code \|\| !shouldCapture\(/);

const boundary = read('src/components/root-error-boundary.tsx');
assert.match(boundary, /if \(chunkError && IS_WEB && claimChunkReload\(sessionStore\(\), Date\.now\(\)\)\) window\.location\.reload\(\);/);
assert.match(boundary, /label="홈으로" onPress=\{this\.goHome\}/, 'the error screen always offers a way home');
assert.match(boundary, /captureError\(error, chunkError \? 'chunk_load' : 'root_error_boundary'\)/);

console.log('error capture checks passed');
