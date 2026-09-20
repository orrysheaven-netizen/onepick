const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateReleaseEnv, loadReleaseEnv } = require('./build-web-release.cjs');

const releaseBuilderSource = fs.readFileSync(path.join(__dirname, 'build-web-release.cjs'), 'utf8');
assert.match(releaseBuilderSource, /fs\.rmSync\(releaseDir, \{ recursive: true, force: true \}\)/);
assert.match(releaseBuilderSource, /'--clear'/);
assert.match(releaseBuilderSource, /deploy-meta\.json/);
assert.match(releaseBuilderSource, /CF_PAGES_COMMIT_SHA/);
assert.match(releaseBuilderSource, /CF_PAGES_BRANCH/);

// Deliberately fabricated fixtures; no request is sent with these values.
const valid = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_release_fixture_0123456789',
};
assert.doesNotThrow(() => validateReleaseEnv(valid));
assert.doesNotThrow(() => validateReleaseEnv({ ...valid, EXPO_PUBLIC_SHARE_BASE_URL: 'https://onepick.app/' }));
assert.doesNotThrow(() => validateReleaseEnv({ ...valid, EXPO_PUBLIC_SUPABASE_URL: 'https://api.onepick.app' }));
assert.throws(() => validateReleaseEnv({}), /EXPO_PUBLIC_SUPABASE_URL[\s\S]*EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);

for (const value of [
  'http://live.supabase.co', 'https://onepick-ci.invalid', 'https://localhost',
  'https://127.0.0.1', 'https://[::1]', 'https://preview.local',
  'https://onepick.example', 'https://example.com', 'https://sub.example.org',
  'https://your-project.supabase.co', 'not-a-url',
  'https://live.supabase.co/path', 'https://live.supabase.co/path/..',
  'https://user:private_password@live.supabase.co',
  'https://live.supabase.co?token=private_token', 'https://live.supabase.co#private_token',
]) {
  for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SHARE_BASE_URL']) {
    assert.throws(() => validateReleaseEnv({ ...valid, [name]: value }), (error) => {
      assert.ok(error.message.includes(name));
      assert.ok(!error.message.includes(value), 'Configuration values must not appear in errors');
      return true;
    });
  }
}
for (const key of [
  '', 'replace-with-your-publishable-key', 'sb_publishable_ci_placeholder',
  'sb_publishable_', 'sb_secret_private_token',
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"role":"service_role"}').toString('base64url')}.private_signature`,
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"role":"anon"}').toString('base64url')}.legacy_signature`,
]) {
  assert.throws(() => validateReleaseEnv({ ...valid, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }), (error) => {
    if (key && key !== 'sb_publishable_') assert.ok(!error.message.includes(key), 'Never print a rejected secret');
    return /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/.test(error.message);
  });
}

// Exercise the actual Expo env loader and production precedence, not a mock.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onepick-release-test-'));
const files = ['.env', '.env.production', '.env.local', '.env.production.local'];
const originalNoDotenv = process.env.EXPO_NO_DOTENV;
delete process.env.EXPO_NO_DOTENV;
try {
  for (const [i, file] of files.entries()) {
    fs.writeFileSync(path.join(root, file), [
      `EXPO_PUBLIC_SUPABASE_URL=${valid.EXPO_PUBLIC_SUPABASE_URL}`,
      `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_priority_${i}`,
    ].join('\n'));
  }
  const dotenv = loadReleaseEnv(root, {});
  assert.equal(dotenv.NODE_ENV, 'production');
  assert.equal(dotenv.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'sb_publishable_priority_3');
  assert.equal(loadReleaseEnv(root, { ...valid }).EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, valid.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  assert.throws(() => loadReleaseEnv(root, { ...valid, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' }), /is required/);
} finally {
  if (originalNoDotenv === undefined) delete process.env.EXPO_NO_DOTENV;
  else process.env.EXPO_NO_DOTENV = originalNoDotenv;
  for (const file of files) fs.unlinkSync(path.join(root, file));
  fs.rmdirSync(root);
}

function cli(values) {
  return spawnSync(process.execPath, [path.join(__dirname, 'build-web-release.cjs'), '--check'], {
    encoding: 'utf8',
    env: { ...process.env, ...valid, EXPO_PUBLIC_SHARE_BASE_URL: '', EXPO_NO_DOTENV: '1', ...values },
  });
}
const success = cli({});
assert.ifError(success.error);
assert.equal(success.status, 0, success.stderr);
assert.match(success.stdout, /Release configuration checks passed/);
const secret = 'sb_secret_should_never_appear_in_logs';
const failure = cli({ EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret });
assert.equal(failure.status, 1);
assert.match(failure.stderr, /Release configuration failed/);
assert.ok(!`${failure.stdout}${failure.stderr}`.includes(secret));
assert.equal(cli({ EXPO_PUBLIC_SUPABASE_URL: 'https://onepick-ci.invalid' }).status, 1);
console.log('Release checks passed: required settings, public key/origins, production dotenv precedence, host overrides and redacted CLI failures.');
