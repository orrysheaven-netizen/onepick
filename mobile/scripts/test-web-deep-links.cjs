const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const webTabs = fs.readFileSync(path.join(root, 'src/components/app-tabs.web.tsx'), 'utf8');
const directRouteCheck = fs.readFileSync(path.join(root, 'scripts/check-web-export.cjs'), 'utf8');
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));

assert.match(webTabs, /\bSlot\b/, 'Web tab shell must render the current file route through Slot');
assert.match(webTabs, /<Slot\s*\/>/, 'Web tab shell must render Slot directly');
for (const href of ['/', '/explore', '/notifications', '/profile']) {
  assert.ok(webTabs.includes(`href: '${href}'`), `Missing URL-backed tab ${href}`);
}
assert.ok(fs.existsSync(path.join(root, 'src/app/(tabs)/notifications.tsx')));
assert.ok(fs.existsSync(path.join(root, 'src/app/comments.tsx')));
assert.ok(!fs.existsSync(path.join(root, 'src/app/(tabs)/comments.tsx')));
assert.doesNotMatch(webTabs, /expo-router\/ui|\bTabSlot\b|\bTabList\b|\bTabTrigger\b/,
  'Web routes must not be owned by a second client-side tab navigator');

assert.equal(appConfig.expo.web.output, 'single', 'Web deep links require the SPA output contract');
assert.match(directRouteCheck, /'\/explore'/, 'Export smoke check must include /explore');
assert.match(directRouteCheck, /'\/profile'/, 'Export smoke check must include /profile');
assert.match(directRouteCheck, /'\/comments'/, 'Export smoke check must include /comments');
assert.match(directRouteCheck, /'\/pick\//, 'Export smoke check must include shared Pick URLs');
assert.match(directRouteCheck, /'\/u\//, 'Export smoke check must include shared public-profile URLs');

console.log('Web deep-link checks passed: URL-backed tab links, Slot routing and direct-route export coverage.');
