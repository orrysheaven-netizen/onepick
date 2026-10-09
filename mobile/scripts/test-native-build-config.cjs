const assert = require('node:assert/strict');
const configFromEnv = require('../app.config.js');
const { expo } = require('../app.json');
const eas = require('../eas.json');
const { resolveProfile, validateNativeBuild } = require('./check-native-build.cjs');

const names = ['ONEPICK_IOS_BUNDLE_IDENTIFIER', 'ONEPICK_ANDROID_PACKAGE', 'ONEPICK_EAS_PROJECT_ID', 'ONEPICK_EXPO_OWNER'];
const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
try {
  for (const name of names) delete process.env[name];
  const baseline = structuredClone(expo);
  assert.deepEqual(configFromEnv({ config: expo }), baseline, 'Web config must work unchanged without native account values');
  const preview = resolveProfile(eas, 'preview');
  const simulator = resolveProfile(eas, 'preview-simulator');
  assert.equal(preview.distribution, 'internal');
  assert.equal(simulator.ios.simulator, true);
  assert.equal(simulator.env.EXPO_PUBLIC_SHARE_BASE_URL, preview.env.EXPO_PUBLIC_SHARE_BASE_URL);
  assert.equal(eas.submit, undefined, 'This preparation must not add a store submission profile');
  assert.equal(eas.build.production, undefined);
  assert.throws(() => resolveProfile(eas, 'missing'));
  assert.throws(() => resolveProfile({ build: { a: { extends: 'b' }, b: { extends: 'a' } } }, 'a'));

  const missing = validateNativeBuild(expo, preview, 'ios', {});
  assert(missing.some((message) => message.includes('BUNDLE_IDENTIFIER')));
  assert(missing.some((message) => message.includes('EAS_PROJECT_ID')));

  // Fixtures only: none of these values is a proposed or registered app identity.
  Object.assign(process.env, {
    ONEPICK_IOS_BUNDLE_IDENTIFIER: 'test.fixture.onepick',
    ONEPICK_ANDROID_PACKAGE: 'test.fixture.onepick',
    ONEPICK_EAS_PROJECT_ID: '11111111-1111-4111-8111-111111111111',
    ONEPICK_EXPO_OWNER: 'fixture-owner',
  });
  const configured = configFromEnv({ config: expo });
  const env = {
    EXPO_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
    ...preview.env,
  };
  for (const platform of ['ios', 'android']) assert.deepEqual(validateNativeBuild(configured, preview, platform, env), []);
  assert.deepEqual(validateNativeBuild(configured, simulator, 'ios', env), []);
  assert(validateNativeBuild(configured, simulator, 'android', env).length > 0);
  assert(validateNativeBuild(configured, { ...preview, distribution: 'store' }, 'ios', env).length > 0);
  assert.deepEqual(expo, baseline, 'Dynamic config must not mutate the shared app.json object');
  assert.deepEqual(configured.web, baseline.web);
  assert.deepEqual(configured.plugins, baseline.plugins);
  assert.deepEqual(configured.ios.icon, baseline.ios.icon);
  assert.deepEqual(configured.android.adaptiveIcon, baseline.android.adaptiveIcon);

  const jwt = (role) => `e30.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  for (const key of ['sb_secret_fixture', jwt('service_role'), 'replace-with-your-publishable-key']) {
    assert(validateNativeBuild(configured, preview, 'android', { ...env, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }).some((message) => message.includes('PUBLISHABLE_KEY')));
  }
  assert.deepEqual(validateNativeBuild(configured, preview, 'android', { ...env, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt('anon') }), []);
  for (const url of ['http://fixture.supabase.co', 'https://user:pass@fixture.supabase.co', 'https://fixture.supabase.co/auth', 'invalid']) {
    assert(validateNativeBuild(configured, preview, 'ios', { ...env, EXPO_PUBLIC_SUPABASE_URL: url }).some((message) => message.includes('SUPABASE_URL')));
  }
  assert(validateNativeBuild(configured, preview, 'ios', { ...env, EXPO_PUBLIC_SHARE_BASE_URL: 'onepick://pick' }).some((message) => message.includes('SHARE_BASE_URL')));
} finally {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
console.log('Native build config: web baseline, inherited test profiles, missing identity and public-key guards passed.');
