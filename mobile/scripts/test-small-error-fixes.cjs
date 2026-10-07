const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function load(relative, imports = {}, globals = {}) {
  const exports = {};
  const output = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, {
    exports, Error, Map, Set, ...globals,
    require: (name) => {
      if (name in imports) return imports[name];
      assert.fail(`Unexpected import: ${name}`);
    },
  }, { filename: relative });
  return exports;
}

// Network failures and expired sessions get their own codes instead of INTERNAL_ERROR.
const appError = load('src/errors/appError.ts');
const { mapSupabaseError } = load('src/errors/mapSupabaseError.ts', { './appError': appError });
assert.equal(mapSupabaseError({ code: '', message: 'TypeError: Failed to fetch' }).code, 'NETWORK_ERROR');
assert.equal(mapSupabaseError({ message: 'TypeError: Network request failed' }).code, 'NETWORK_ERROR');
assert.equal(mapSupabaseError({ code: '', message: 'Load failed' }).code, 'NETWORK_ERROR');
assert.equal(mapSupabaseError({ code: 'PGRST303', message: 'JWT expired' }).code, 'AUTH_REQUIRED');
assert.equal(mapSupabaseError({ code: 'PGRST301', message: 'x' }).code, 'AUTH_REQUIRED');
assert.equal(mapSupabaseError({ code: 'XX000', message: 'Failed to fetch something server side' }).code, 'INTERNAL_ERROR', 'a server error with a code is not a network failure');
assert.equal(mapSupabaseError({ code: '', message: 'boom' }).code, 'INTERNAL_ERROR');
assert.equal(mapSupabaseError({ message: 'USERNAME_TAKEN' }).code, 'USERNAME_TAKEN');

// Blocked browser storage must not blank the page at module load.
const throwingWindow = { get localStorage() { throw new Error('SecurityError: The operation is insecure.'); } };
const blocked = load('src/lib/supabase/storage.web.ts', {}, { window: throwingWindow });
blocked.authStorage.setItem('k', 'v');
assert.equal(blocked.authStorage.getItem('k'), 'v', 'memory fallback keeps the session for this tab');
blocked.authStorage.removeItem('k');
assert.equal(blocked.authStorage.getItem('k'), null);

const values = new Map();
const realStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
const normal = load('src/lib/supabase/storage.web.ts', {}, { window: { localStorage: realStorage } });
assert.equal(normal.authStorage, realStorage, 'uses localStorage when it works');
assert.equal(values.size, 0, 'the probe key is cleaned up');
assert.equal(load('src/lib/supabase/storage.web.ts').authStorage, undefined, 'static rendering has no storage');

// Item detail keeps showing loaded data when only a background refetch failed.
const item = read('src/app/item/[itemId].tsx');
assert.match(item, /if \(!itemId \|\| !query\.data\) \{/);
assert.doesNotMatch(item, /if \(!itemId \|\| query\.isError \|\| !query\.data\)/);
assert.match(item, /query\.isError \? <StateCard compact tone="danger"[^>]*title="최신 정보를 불러오지 못했어요\."/);

// Unblock failures are shown, not swallowed as unhandled rejections.
const settings = read('src/app/settings.tsx');
assert.match(settings, /unblockUser\.mutateAsync\(\{[\s\S]*?\}\)\.catch\(\(\) => undefined\)/);
assert.match(settings, /unblockUser\.isError \? <Text accessibilityRole="alert"/);

// OAuth: a profile lookup failure after a successful exchange is "unknown", not "missing".
const oauth = read('src/hooks/useCompleteOAuth.ts');
assert.match(oauth, /profileService\.getById\(user\.id\)\s*\.catch\(\(\) => profileService\.getById\(user\.id\)\)\s*\.catch\(\(\) => undefined\)/);
assert.match(read('src/app/auth/callback.tsx'), /getPostAuthRoute\(intent, result\.profile === null\)/);

// Sign-out is intentionally global (see test-auth-session); the label now says so.
assert.match(read('src/repositories/supabase/supabaseAuthRepository.ts'), /async signOut\(\) \{[\s\S]*?signOut\(\{ scope: 'global' \}\)/);
assert.match(read('src/components/sign-out-button.tsx'), /모든 기기에서 로그아웃하기/);
assert.doesNotMatch(read('src/components/sign-out-button.tsx'), /이 기기에서 로그아웃/);

// Recipe: same-frame double taps are blocked; a sent request refreshes the profile request list.
const recipe = read('src/app/pick/recipe.tsx');
assert.equal((recipe.match(/if \(submitting\.current\) return;\s*submitting\.current = true;/g) ?? []).length, 2);
assert.equal((recipe.match(/finally \{\s*submitting\.current = false;\s*\}/g) ?? []).length, 2);
assert.match(read('src/hooks/useYouTubeCatalog.ts'), /useRequestYouTubeVideo\(\) \{[\s\S]*?onSuccess: \(\) => queryClient\.invalidateQueries\(\{ queryKey: \['profiles', 'requests'\] \}\)/);

console.log('small error fix checks passed');
