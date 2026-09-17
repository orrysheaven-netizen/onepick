const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/services/adminMfaService.ts'), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exportsObject });
const { AdminMfaService, enrollmentError } = exportsObject;

async function main() {
  let user = 'admin', allowed = true, level = 'aal1', verified = [], pending = [];
  let failVerify = false, failList = false, failAssurance = false;
  const calls = [];
  let email = 'admin@example.invalid', confirmed = '2026-09-17', emailError = null;
  const service = new AdminMfaService({
    rpc: async () => ({ data: allowed, error: null }),
    auth: {
      getUser: async () => ({ data: { user: { id: user, email, email_confirmed_at: confirmed } }, error: null }),
      updateUser: async (input, options) => { calls.push({ input, options }); return { error: emailError }; },
      mfa: {
        listFactors: async () => failList ? { error: { message: 'internal details' } } : { data: { totp: verified, all: [...verified, ...pending] }, error: null },
        getAuthenticatorAssuranceLevel: async () => failAssurance ? { error: {} } : { data: { currentLevel: level }, error: null },
        enroll: async () => { calls.push('enroll'); return { data: { id: 'pending', totp: { secret: 'fixture-only', qr_code: '<svg />' } }, error: null }; },
        challengeAndVerify: async (input) => { calls.push(input); if (!failVerify) level = 'aal2'; return { error: failVerify ? { message: 'internal details' } : null }; },
        unenroll: async (input) => { calls.push(input); return { error: null }; },
      },
    },
  });
  await assert.rejects(() => service.verify('admin', 'factor', '12ab56'), /6자리/);
  assert.equal(calls.length, 0, 'Malformed codes never reach MFA');
  user = 'other';
  await assert.rejects(() => service.enroll('admin'), /로그인 상태/);
  assert.equal(calls.length, 0, 'Changed user cannot start enrollment');
  user = 'admin'; allowed = false;
  await assert.rejects(() => service.enroll('admin'), /관리자/);
  assert.equal(calls.length, 0, 'Non-admin cannot enroll through this service');
  allowed = true;
  email = ''; confirmed = null;
  assert.equal((await service.status('admin')).emailReady, false);
  await assert.rejects(() => service.enroll('admin'), /이메일/);
  assert.equal(calls.length, 0, 'Email-less Kakao account never reaches the broken TOTP endpoint');
  await assert.rejects(() => service.requestEmail('admin', 'invalid', 'http://localhost:4173/auth/callback'), /이메일/);
  await service.requestEmail('admin', ' admin@example.invalid ', 'http://localhost:4173/auth/callback');
  assert.equal(calls.at(-1).input.email, 'admin@example.invalid');
  assert.equal(calls.at(-1).options.emailRedirectTo, 'http://localhost:4173/auth/callback');
  assert.equal((await service.status('admin')).emailReady, false, 'Sending mail is not confirmation');
  emailError = { code: 'email_address_not_authorized' };
  await assert.rejects(() => service.requestEmail('admin', 'admin@example.invalid', 'http://localhost:4173/auth/callback'), /메일 발송 설정/);
  emailError = null; email = 'admin@example.invalid';
  await assert.rejects(() => service.requestEmail('admin', 'other@example.invalid', 'http://localhost:4173/auth/callback'), /이미 연결/);
  await assert.rejects(() => service.enroll('admin'), /이메일/);
  confirmed = '2026-09-17';
  assert.equal((await service.status('admin')).emailReady, true);
  assert.match(enrollmentError({ code: 'mfa_totp_enroll_not_enabled' }), /꺼져/);
  assert.match(enrollmentError({ status: 500 }), /server_error/);
  assert.ok(!enrollmentError({ code: 'secret=do-not-print' }).includes('do-not-print'));
  const enrollment = await service.enroll('admin');
  assert.equal(enrollment.id, 'pending');
  pending = [{ id: 'pending', factor_type: 'totp', status: 'unverified' }];
  await assert.rejects(() => service.enroll('admin'), /미완료/);
  await assert.rejects(() => service.cancelPending('admin', 'unknown'), /미완료/);
  await service.cancelPending('admin', 'pending');
  assert.equal(calls.at(-1).factorId, 'pending');
  pending = []; verified = [{ id: 'verified', factor_type: 'totp', status: 'verified' }];
  await assert.rejects(() => service.cancelPending('admin', 'verified'), /미완료/);
  await assert.rejects(() => service.enroll('admin'), /이미 등록/);
  failVerify = true;
  await assert.rejects(() => service.verify('admin', 'verified', '123456'), (error) => !error.message.includes('internal details') && /인증하지 못/.test(error.message));
  assert.equal((await service.status('admin')).elevated, false);
  failVerify = false;
  assert.equal((await service.verify('admin', 'verified', '654321')).elevated, true);
  failList = true;
  await assert.rejects(() => service.status('admin'), /확인하지 못/);
  failList = false; failAssurance = true;
  await assert.rejects(() => service.status('admin'), /확인하지 못/);
  console.log('Admin MFA checks passed: user/admin validation, enrollment conflicts, safe cancellation, invalid codes, verification retry and assurance failures.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
