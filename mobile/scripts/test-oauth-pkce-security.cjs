const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');

const client = fs.readFileSync(path.join(root,'mobile/src/lib/supabase/client.ts'),'utf8');
const authRepo = fs.readFileSync(path.join(root,'mobile/src/repositories/supabase/supabaseAuthRepository.ts'),'utf8');
const adminApi = fs.readFileSync(path.join(root,'mobile/src/lib/admin-api.ts'),'utf8');

assert.match(client,/flowType:\s*'pkce'/,'shared Supabase auth client must use PKCE');
assert.match(authRepo,/exchangeCodeForSession\(code\)/);
assert.doesNotMatch(authRepo,/auth\.setSession\(\{[\s\S]*?refresh_token/,
  'app OAuth callback must not install URL tokens');
assert.match(adminApi,/exchangeCodeForSession\(code\)/);
assert.doesNotMatch(adminApi,/auth\.setSession\(\{\s*access_token/,
  'admin OAuth callback must not install URL tokens');

console.log('OAuth security checks passed: PKCE is configured and callback completion is code-only.');
