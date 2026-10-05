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
assert.ok(!profile.includes("navigation.addListener('beforeRemove'"),
  'native stack back/swipe must not be intercepted with beforeRemove');
assert.ok(!profile.includes('event.preventDefault()'),
  'native swipe-back must not cancel an in-flight native pop');
assert.ok(profile.includes('router.dismissTo(returnHref);'),
  'safe edge swipe restores the validated origin after its own gesture completes');
assert.ok(profile.includes("router.replace(returnHref ?? '/');"),
  'cold public-profile links fall back Home when there is no app history');
assert.ok(!profile.includes("const goBack = () => router.replace"),
  'public-profile header back must not always recreate the origin route');
assert.match(profile, /onBlocked=\{goBack\}/);

console.log('dead-end navigation checks passed');
