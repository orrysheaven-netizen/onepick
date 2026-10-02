const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../src');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));

const tabs = read('components/app-tabs.tsx');
for (const group of ['(home)', '(explore)', '(notifications)', '(profile)']) {
  assert.match(tabs, new RegExp('NativeTabs\\.Trigger name="' + group.replace(/[()]/g, '\\$&') + '"'));
}
assert.doesNotMatch(tabs, /NativeTabs\.Trigger name="u"/, 'Public profile is a shared stack route, never a hidden tab');
assert.match(tabs, /NativeTabs\.Trigger name="register" disabled/, 'The center add action keeps the existing non-tab behavior');

const layouts = {
  '(home)/_layout.tsx': 'index',
  '(explore)/_layout.tsx': 'explore',
  '(notifications)/_layout.tsx': 'notifications',
  '(profile)/_layout.tsx': 'profile',
};
for (const [file, anchor] of Object.entries(layouts)) {
  const source = read('app/(tabs)/' + file);
  assert.match(source, /<Stack screenOptions=\{\{ headerShown: false \}\} \/>/);
  assert.match(source, new RegExp("anchor: '" + anchor + "'"));
}

assert.ok(exists('app/(tabs)/(home)/index.tsx'));
assert.ok(exists('app/(tabs)/(explore)/explore.tsx'));
assert.ok(exists('app/(tabs)/(notifications)/notifications.tsx'));
assert.ok(exists('app/(tabs)/(profile)/profile.tsx'));
assert.ok(exists('app/(tabs)/(home,explore,notifications,profile)/u/[username].tsx'));
assert.ok(exists('app/(tabs)/(home,explore,notifications,profile)/u/[username]/connections.tsx'));
assert.equal(exists('app/u/[username].tsx'), false, 'The root duplicate must be removed so /u/[username] resolves inside tabs');

const connections = read('app/(tabs)/(home,explore,notifications,profile)/u/[username]/connections.tsx');
assert.match(connections, /FollowConnectionsView/);
assert.match(connections, /router\.canGoBack\(\)/);
assert.match(connections, /pathname: '\/u\/\[username\]'/);
assert.match(connections, /pathname: '\/auth\/login'/);
assert.match(connections, /armFollowProfileIntent\(targetUsername\)/);
assert.match(connections, /direction === 'following'/);

const authIntent = read('lib/auth/authIntent.ts');
assert.match(authIntent, /case 'view_profile': return \{ pathname: '\/u\/\[username\]'/);
assert.match(authIntent, /case 'follow_profile': return \{ pathname: '\/u\/\[username\]'/);

console.log('Follow route-shell checks passed: shared profile URL, nested tab stacks, connections route, auth return and back behavior.');
