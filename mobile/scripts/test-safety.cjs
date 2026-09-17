const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(relativePath, imports = {}) {
  const file = path.join(__dirname, '..', 'src', relativePath);
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports,
    require: (name) => {
      assert.ok(name in imports, 'Unexpected runtime dependency: ' + name);
      return imports[name];
    },
  });
  return exports;
}

async function main() {
  const { AppError } = loadSource('errors/appError.ts');
  const calls = [];
  const repository = {
    getBlocks: async () => [],
    blockUser: async (...args) => { calls.push(['block', ...args]); return {}; },
    unblockUser: async (...args) => { calls.push(['unblock', ...args]); },
    submitReport: async (input) => { calls.push(['report', input]); return input; },
    getReports: async () => [],
    updateReportStatus: async (...args) => { calls.push(['status', ...args]); return {}; },
  };
  const { SafetyService } = loadSource('services/safetyService.ts', {
    '@/errors/appError': { AppError },
  });
  const service = new SafetyService(repository);

  assert.throws(() => service.blockUser('me', 'me'), (error) => error.code === 'BLOCK_SELF');
  assert.equal(calls.length, 0, 'Self-block never reaches repository');
  await service.blockUser('me', 'other');
  assert.deepEqual(calls[0], ['block', 'me', 'other']);

  await service.submitReport({
    reporterUserId: 'me', targetType: 'pick', targetId: 'pick-1', reason: 'spam', details: '  detail  ',
  });
  assert.equal(calls[1][1].details, 'detail');
  assert.throws(
    () => service.submitReport({ reporterUserId: 'me', targetType: 'pick', targetId: '', reason: 'spam' }),
    (error) => error.code === 'REPORT_INVALID',
  );
  assert.throws(
    () => service.submitReport({ reporterUserId: 'me', targetType: 'pick', targetId: 'p', reason: 'other', details: 'x'.repeat(501) }),
    (error) => error.code === 'REPORT_INVALID',
  );

  const { SupabaseSafetyRepository } = loadSource('repositories/supabase/supabaseSafetyRepository.ts', {
    '@/errors/appError': { AppError },
    '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
  });
  const auth = { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }) };
  const duplicateBuilder = {
    insert: () => duplicateBuilder,
    select: () => duplicateBuilder,
    single: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }),
  };
  const safetyRepo = new SupabaseSafetyRepository({ auth, from: () => duplicateBuilder });
  await assert.rejects(
    () => safetyRepo.submitReport({ reporterUserId: 'me', targetType: 'profile', targetId: 'other', reason: 'spam' }),
    (error) => error.code === 'REPORT_DUPLICATE',
  );

  const { SupabaseAuthRepository } = loadSource('repositories/supabase/supabaseAuthRepository.ts', {
    '@supabase/supabase-js': {},
    'expo-web-browser': {},
    'react-native': { Platform: { OS: 'ios' } },
    '@/errors/appError': { AppError },
  });
  let localSignOut = false;
  const authRepo = new SupabaseAuthRepository({
    functions: { invoke: async () => ({ data: { ok: true }, error: null }) },
    auth: { signOut: async () => { localSignOut = true; return { error: null }; } },
  });
  await authRepo.deleteAccount();
  assert.equal(localSignOut, true, 'Successful account deletion clears local auth session');

  const failingAuthRepo = new SupabaseAuthRepository({
    functions: { invoke: async () => ({ data: { ok: false, code: 'ACCOUNT_AUTH_DELETE_FAILED' }, error: null }) },
    auth: { signOut: async () => ({ error: null }) },
  });
  await assert.rejects(() => failingAuthRepo.deleteAccount(), (error) => error.code === 'ACCOUNT_DELETE_FAILED');

  console.log('Safety checks passed: block/report validation, duplicate report mapping, and account deletion session cleanup.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
