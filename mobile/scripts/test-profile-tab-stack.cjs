const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const nativeTabs = read('src/components/app-tabs.tsx');
const webTabs = read('src/components/app-tabs.web.tsx');
const profileLayout = read('src/app/(tabs)/(profile)/_layout.tsx');
const ownProfile = 'src/app/(tabs)/(profile)/profile.tsx';
const publicProfile = 'src/app/(tabs)/(profile)/u/[username].tsx';

assert.ok(fs.existsSync(path.join(root, ownProfile)), 'Own profile lives inside the Profile tab stack');
assert.ok(fs.existsSync(path.join(root, publicProfile)), 'Public profile lives inside the Profile tab stack');
assert.equal(fs.existsSync(path.join(root, 'src/app/(tabs)/profile.tsx')), false, 'Old own-profile route is removed');
assert.equal(fs.existsSync(path.join(root, 'src/app/u/[username].tsx')), false, 'Old public-profile Stack route is removed');

assert.match(profileLayout, /<Stack[^>]*screenOptions=\{\{ headerShown: false \}\}/);
assert.match(profileLayout, /initialRouteName:\s*'profile'/);
assert.match(nativeTabs, /<NativeTabs\.Trigger name="\(profile\)">/,
  'Native Profile tab owns the nested Stack');
assert.doesNotMatch(nativeTabs, /<NativeTabs\.Trigger name="profile">/);

assert.match(webTabs,
  /href === '\/profile'\) return pathname === '\/profile' \|\| pathname\.startsWith\('\/profile\/'\) \|\| pathname\.startsWith\('\/u\/'\)/,
  'Web public-profile URLs keep the Profile tab selected');

const publicSource = read(publicProfile);
assert.match(publicSource, /router\.replace\('\/profile'\)/,
  'Own public profile can still return to the Profile tab root');

const authIntent = read('src/lib/auth/authIntent.ts');
assert.match(authIntent, /case 'follow_profile': return \{ pathname: '\/u\/\[username\]'/,
  'Login-resume follow intent keeps the existing public-profile deep link');

console.log('Profile tab stack checks passed: /profile and /u/:username retain URLs while the bottom tab stays mounted.');
