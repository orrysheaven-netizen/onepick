const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/app/settings.tsx'), 'utf8');
const signOut = fs.readFileSync(path.join(__dirname, '../src/components/sign-out-button.tsx'), 'utf8');

assert.match(source, /OnePickType\.pageTitle/, 'settings must use the shared type scale');
assert.match(source, /OnePickSpace\.gutter/, 'settings must use the shared 16px gutter');
assert.match(source, /OnePickRadius\.lg/, 'settings cards must use the shared large radius');
assert.match(source, /OnePick\.borderDefault/, 'settings must use semantic borders');
assert.match(source, /trackColor=\{\{ true: OnePick\.actionPrimary, false: OnePick\.borderDefault \}\}/, 'switch must use semantic action/border roles');
assert.match(source, /useDeleteAccount/, 'account deletion behavior must remain intact');
assert.match(source, /useBlockedUsers/, 'blocked-user behavior must remain intact');
assert.doesNotMatch(source, /fontWeight:\s*['"](?:800|900)['"]/, 'settings must not use 800/900 weights');

console.log('Settings Foundations checks passed: visual tokens changed without changing account/safety behavior.');

assert.match(source, /<SignOutButton showSettingsLink=\{false\} \/>/, 'settings must not link back to itself');
assert.match(signOut, /showSettingsLink \? <Pressable[\s\S]*router\.push\('\/settings'\)/, 'other screens may still expose the settings shortcut');
