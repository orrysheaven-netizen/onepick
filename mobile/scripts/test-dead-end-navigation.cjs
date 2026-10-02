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

for (const file of ['src/app/settings.tsx', 'src/app/auth/login.tsx', 'src/app/pick/link.tsx',
  'src/app/lab/[username].tsx', 'src/app/legal/terms.tsx', 'src/app/legal/privacy.tsx']) {
  assert.match(read(file), /router\.canGoBack\(\) \? router\.back\(\) : router\.replace\('\/'\)/, `${file}: back falls back to home`);
}

const profile = read('src/app/(tabs)/(profile)/u/[username].tsx');
assert.match(profile, /프로필을 찾을 수 없어요[\s\S]{0,200}label: '홈으로'/, 'missing profile screen needs a way home');
assert.ok(profile.includes('const returnHref = profileReturnHref(returnTo);'));
assert.ok(profile.includes('if (router.canGoBack()) { router.back(); return; }'),
  'public profile header back first uses real history when available');
assert.ok(profile.includes("navigation.addListener('beforeRemove'"),
  'native back removal is intercepted for explicit profile origins');
assert.ok(profile.includes("actionType !== 'GO_BACK' && actionType !== 'POP' && actionType !== 'POP_TO_TOP'"));
assert.ok(profile.includes('router.dismissTo(returnHref);'),
  'native hardware and swipe back dismiss to the explicit origin instead of stale Profile-stack history');
assert.ok(profile.includes("router.replace(returnHref ?? '/');"),
  'cold public-profile links fall back Home when there is no app history');
assert.ok(!profile.includes("const goBack = () => router.replace"),
  'public-profile header back must not always recreate the origin route');
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
