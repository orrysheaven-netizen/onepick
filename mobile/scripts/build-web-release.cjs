const path = require('node:path');
const { isIP } = require('node:net');
const { spawnSync } = require('node:child_process');

// Offline configuration checks only: validity/revocation of a key and OAuth
// allowlists must still be verified against the chosen deployment.
function validateReleaseEnv(env) {
  const errors = [];
  function origin(name, optional = false) {
    const value = env[name]?.trim();
    if (!value) {
      if (!optional) errors.push(`${name} is required.`);
      return;
    }
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/\.$/, '');
      const reserved = /(^|\.)(localhost|local|test|invalid|example)$/.test(host)
        || /(^|\.)example\.(com|net|org)$/.test(host)
        || host === 'your-project.supabase.co';
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || value.replace(/\/$/, '') !== url.origin || !host.includes('.')
        || isIP(host) || host.startsWith('[') || reserved) throw new Error();
    } catch {
      // Never echo input: misconfigured URLs can contain credentials or tokens.
      errors.push(`${name} must be a public HTTPS origin without credentials, a path, query or fragment; local/example/CI hosts are not release targets.`);
    }
  }
  origin('EXPO_PUBLIC_SUPABASE_URL');
  origin('EXPO_PUBLIC_SHARE_BASE_URL', true);

  const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!key) {
    errors.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required.');
  } else if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)
    || /placeholder|replace[-_]with|your[-_]publishable/i.test(key)) {
    errors.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key (sb_publishable_...), not a placeholder, secret key or legacy JWT.');
  }
  if (errors.length) throw new Error(`Release configuration failed:\n- ${errors.join('\n- ')}`);
}

function loadReleaseEnv(root, systemEnv = process.env) {
  // Resolve the env loader shipped with the installed Expo CLI, using the same
  // production dotenv precedence as expo export. No new dependency is required.
  const expoRoot = path.dirname(require.resolve('expo/package.json'));
  const cliRoot = path.dirname(require.resolve('@expo/cli/package.json', { paths: [expoRoot] }));
  const { loadProjectEnv } = require(require.resolve('@expo/env', { paths: [cliRoot] }));
  systemEnv.NODE_ENV = 'production';
  loadProjectEnv(root, { mode: 'production', systemEnv, silent: true });
  validateReleaseEnv(systemEnv);
  return systemEnv;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--check')) {
    throw new Error('Usage: node scripts/build-web-release.cjs [--check]');
  }
  const root = path.resolve(__dirname, '..');
  const env = loadReleaseEnv(root);
  console.log('Release configuration checks passed (offline; no key values printed).');
  if (args[0] === '--check') return;

  function run(args) {
    const result = spawnSync(process.execPath, args, {
      cwd: root, env, stdio: 'inherit', shell: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Release build/check failed; do not deploy this output.');
  }
  // Keep real settings separate from the CI fixture output in dist/.
  run([require.resolve('expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', 'dist-release']);
  run([path.join(__dirname, 'check-web-export.cjs'), 'dist-release']);
  console.log('Verified release output: mobile/dist-release. Hosting and actual login verification are still required.');
}

module.exports = { validateReleaseEnv, loadReleaseEnv };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
