const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(relative);
    return /\.tsx?$/.test(entry.name) ? [relative] : [];
  });
}

// A screen opened straight from a shared link (카카오톡, a web refresh) has no app history, so a
// bare router.back() silently does nothing. Every back control must check canGoBack and fall back.
for (const file of walk('src/app')) {
  const source = read(file);
  for (const line of source.split('\n')) {
    if (!line.includes('router.back()')) continue;
    assert.ok(line.includes('canGoBack'), `${file}: router.back() without a canGoBack fallback`);
  }
}

for (const file of ['src/app/u/[username].tsx', 'src/app/settings.tsx', 'src/app/auth/login.tsx', 'src/app/pick/link.tsx',
  'src/app/lab/[username].tsx', 'src/app/legal/terms.tsx', 'src/app/legal/privacy.tsx']) {
  assert.match(read(file), /router\.canGoBack\(\) \? router\.back\(\) : router\.replace\('\/'\)/, `${file}: back falls back to home`);
}

const profile = read('src/app/u/[username].tsx');
assert.match(profile, /프로필을 찾을 수 없어요[\s\S]{0,200}label: '홈으로'/, 'missing profile screen needs a way home');
assert.match(profile, /const goBack = \(\) => router\.canGoBack\(\) \? router\.back\(\) : router\.replace\('\/'\);/);
assert.match(profile, /onBlocked=\{goBack\}/);

// Onboarding: a signed-out visit or a failed load must not spin forever.
const onboarding = read('src/app/onboarding.tsx');
assert.match(onboarding, /const signedOut = !sessionLoading && !user;/);
assert.match(onboarding, /const profileMissing = profile\.isError && \(profile\.error as \{ code\?: string \} \| null\)\?\.code === 'PROFILE_NOT_FOUND';/);
assert.match(onboarding, /const loadFailed = !signedOut && \(\(profile\.isError && !profileMissing\) \|\| categories\.isError \|\| progress\.isError\);/);
assert.match(onboarding, /if \(profileMissing \|\| !profile\.data\) return[\s\S]{0,200}'\/auth\/username'/, 'a new sign-in without a profile goes to the username step');
assert.match(onboarding, /const loading = !signedOut && !loadFailed/);
const signedOutAt = onboarding.indexOf('if (signedOut) return');
const failedAt = onboarding.indexOf('if (loadFailed) return');
const loadingAt = onboarding.indexOf('if (loading) return');
assert.ok(signedOutAt > 0 && failedAt > signedOutAt && loadingAt > failedAt, 'signed-out and failure states must render before the loading state');
assert.match(onboarding, /label: '다시 불러오기'/);

console.log('dead-end navigation checks passed');
