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
assert.doesNotMatch(profileLayout, /initialRouteName|anchor/,
  'Direct public-profile links must not synthesize /profile underneath the deep link');
assert.match(nativeTabs, /<NativeTabs\.Trigger name="\(profile\)"[^>]*listeners=\{\{ tabPress: \(\) => router\.replace\('\/profile'\) \}\}/,
  'Native Profile tab owns the nested Stack and an explicit tab press returns to the own-profile root');
assert.doesNotMatch(nativeTabs, /<NativeTabs\.Trigger name="profile">/);

assert.match(webTabs,
  /href === '\/profile'\) return pathname === '\/profile' \|\| pathname\.startsWith\('\/profile\/'\) \|\| pathname\.startsWith\('\/u\/'\)/,
  'Web public-profile URLs keep the Profile tab selected');

const publicSource = read(publicProfile);
assert.match(publicSource, /router\.replace\('\/profile'\)/,
  'Own public profile can still return to the Profile tab root');

const home = read('src/app/(tabs)/index.tsx');
const dishPeople = read('src/components/dish-people-picks.tsx');
const pickReplies = read('src/components/pick-replies.tsx');
const itemReview = read('src/components/item-review-card.tsx');
const itemDetail = read('src/app/item/[itemId].tsx');

assert.match(publicSource, /const \{ username, returnTo \} = useLocalSearchParams/);
assert.match(publicSource, /const returnHref = profileReturnHref\(returnTo\)/);
assert.match(publicSource, /useNavigation\(\)/);
assert.match(publicSource, /navigation\.addListener\('beforeRemove'[\s\S]*?router\.dismissTo\(returnHref\)/,
  'Native back returns toward the real origin instead of stale nested Profile history');
assert.match(publicSource, /router\.replace\(returnHref \?\? '\/'\)/,
  'Cold public-profile links still fall back Home when there is no app history');
assert.match(home, /params: \{ username, returnTo: '\/' \}/,
  'Home -> public profile records Home as the return target');
assert.match(publicSource, /value\.startsWith\('\/auth\/'\)/);
assert.match(publicSource, /value\.startsWith\('\/admin\/'\)/);
assert.match(publicSource, /value\.startsWith\('\/u\/'\)/,
  'Untrusted returnTo cannot bounce through auth/admin/another public profile');
assert.match(dishPeople, /params: \{ username: pick\.username, returnTo \}/);
assert.match(pickReplies, /returnTo: `\/pick\/\$\{pickId\}`/);
assert.match(itemReview, /returnTo: `\/item\/\$\{itemId\}`/);
assert.match(itemDetail, /returnTo: `\/item\/\$\{item\.id\}`/);

const authIntent = read('src/lib/auth/authIntent.ts');
assert.match(authIntent, /case 'follow_profile': return \{ pathname: '\/u\/\[username\]'/,
  'Login-resume follow intent keeps the existing public-profile deep link');

console.log('Profile tab stack checks passed: /profile and /u/:username retain URLs while the bottom tab stays mounted.');
