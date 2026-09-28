const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/notifications.tsx'), 'utf8');

assert.match(source, /OnePickType\.pageTitle/, 'notifications title must use the shared type scale');
assert.match(source, /OnePickSpace\.gutter/, 'notifications must use the shared 16px gutter');
assert.match(source, /OnePickRadius\.sm/, 'notification kind tags must use the shared small radius');
assert.match(source, /OnePick\.borderDefault/, 'notification dividers must use the semantic border role');
assert.match(source, /OnePick\.bgAccent/, 'unread dot may use the brand accent role');
assert.match(source, /item\.kind === 'item_review'/, 'notification behavior contract must remain intact');
assert.match(source, /useReadNotification/, 'read-state mutation must remain intact');

console.log('Notifications Foundations checks passed: visual tokens changed without changing notification behavior.');
