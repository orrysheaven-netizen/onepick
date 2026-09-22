const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mobileRoot = path.join(__dirname, '..');
const repoRoot = path.join(mobileRoot, '..');
const edge = fs.readFileSync(path.join(repoRoot, 'supabase', 'functions', 'sbiz-place-catalog', 'index.ts'), 'utf8');
const api = fs.readFileSync(path.join(mobileRoot, 'src', 'lib', 'admin-api.ts'), 'utf8');
const screen = fs.readFileSync(path.join(mobileRoot, 'src', 'app', 'admin', 'place-catalog-qa.tsx'), 'utf8');
const shell = fs.readFileSync(path.join(mobileRoot, 'src', 'components', 'admin', 'admin-shell.tsx'), 'utf8');

assert.match(edge, /SUPABASE_ANON_KEY/, 'SBIZ auth must use the caller-scoped public client');
assert.doesNotMatch(edge, /SUPABASE_SERVICE_ROLE_KEY/, 'Service role must not erase auth.uid() for the admin RPC');
assert.match(edge, /global:\s*\{\s*headers:\s*\{\s*Authorization:\s*authorization/, 'Caller Authorization header must reach PostgREST');
assert.match(edge, /getAuthenticatorAssuranceLevel\(token\)/, 'SBIZ sample access must require the MFA assurance level');
assert.match(edge, /assurance\.currentLevel !== 'aal2'/, 'AAL2 must be required server-side');
assert.match(edge, /rpc\('current_user_is_admin'\)/, 'Allowlist membership must still be checked');

assert.match(api, /getSbizPlaceSample/);
assert.match(api, /\/functions\/v1\/sbiz-place-catalog/);
assert.match(screen, /서울 20개 샘플 불러오기/);
assert.match(screen, /OnePick DB에 장소를 저장하지 않습니다/);
assert.doesNotMatch(screen, /place_import_raw|select_place_catalog_item|change_pick/, 'QA screen must not stage, promote or pick rows');
assert.match(shell, /\/admin\/place-catalog-qa/);

console.log('SBIZ admin sample checks passed: caller auth, MFA gate, read-only QA route.');
