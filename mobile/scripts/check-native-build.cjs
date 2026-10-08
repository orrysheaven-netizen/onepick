const fs = require('node:fs');
const path = require('node:path');

function resolveProfile(eas, name, seen = new Set()) {
  const profile = eas.build?.[name];
  if (!profile || seen.has(name)) throw new Error('Unknown or circular EAS build profile');
  seen.add(name);
  const base = profile.extends ? resolveProfile(eas, profile.extends, seen) : {};
  return {
    ...base,
    ...profile,
    env: { ...base.env, ...profile.env },
    android: { ...base.android, ...profile.android },
    ios: { ...base.ios, ...profile.ios },
  };
}

function isHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname === '/';
  } catch {
    return false;
  }
}

function isPublicSupabaseKey(value) {
  if (typeof value !== 'string') return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  // Support the existing legacy anon format, but never accept service-role JWTs.
  try {
    const parts = value.split('.');
    return parts.length === 3 &&
      JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'anon';
  } catch {
    return false;
  }
}

function validateNativeBuild(config, profile, platform, env) {
  const errors = [];
  if (!['ios', 'android'].includes(platform)) errors.push('Choose --platform ios or --platform android.');
  if (profile.distribution !== 'internal') errors.push('Only internal test distribution is prepared.');
  if (platform === 'android' && profile.ios?.simulator) errors.push('Use preview for Android, not preview-simulator.');
  if (platform === 'android' && profile.android?.buildType !== 'apk') errors.push('The Android test build must be an APK.');
  if (config.scheme !== 'onepick') errors.push('Keep the existing onepick URL scheme.');
  if (platform === 'ios' && !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(config.ios?.bundleIdentifier ?? '')) {
    errors.push('Set the owner-confirmed ONEPICK_IOS_BUNDLE_IDENTIFIER.');
  }
  if (platform === 'android' && !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(config.android?.package ?? '')) {
    errors.push('Set the owner-confirmed ONEPICK_ANDROID_PACKAGE.');
  }
  if (!config.owner?.trim()) errors.push('Set ONEPICK_EXPO_OWNER to the confirmed Expo owner.');
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(config.extra?.eas?.projectId ?? '')) {
    errors.push('Set ONEPICK_EAS_PROJECT_ID from the owner-controlled EAS project.');
  }
  if (!isHttpsOrigin(env.EXPO_PUBLIC_SUPABASE_URL)) errors.push('Set EXPO_PUBLIC_SUPABASE_URL to the intended HTTPS backend origin.');
  if (!isPublicSupabaseKey(env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
    errors.push('Set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to a client-safe publishable/anon key.');
  }
  if (!isHttpsOrigin(env.EXPO_PUBLIC_SHARE_BASE_URL)) errors.push('Set EXPO_PUBLIC_SHARE_BASE_URL to the existing HTTPS web origin.');
  return errors;
}

function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--platform', '--profile'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Usage: npm run check:native -- --platform ios|android [--profile preview|preview-simulator]');
    }
    options[args[i].slice(2)] = args[i + 1];
  }
  const projectRoot = path.join(__dirname, '..');
  const eas = JSON.parse(fs.readFileSync(path.join(projectRoot, 'eas.json'), 'utf8'));
  const profile = resolveProfile(eas, options.profile ?? 'preview');
  require('@expo/env').load(projectRoot, { silent: true });
  // EAS profile env overrides the local shell/dotenv environment on the builder.
  Object.assign(process.env, profile.env);
  const { exp } = require('expo/config').getConfig(projectRoot);
  const errors = validateNativeBuild(exp, profile, options.platform, process.env);
  if (errors.length) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('Native configuration check passed. No build or upload was started.');
  console.log('Confirm account ownership, signing, redirect allowlists and available free build quota separately.');
}

if (require.main === module) {
  try { main(); } catch {
    // Config evaluation can include environment data. Do not echo error objects or values.
    console.error('Native configuration could not be checked. See docs/native-build-readiness.md and check the profile/options.');
    process.exitCode = 1;
  }
}

module.exports = { resolveProfile, validateNativeBuild };
