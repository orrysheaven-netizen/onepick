const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const notifications = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/notifications.tsx'), 'utf8');
const itemDetail = fs.readFileSync(path.join(__dirname, '../src/app/item/[itemId].tsx'), 'utf8');

assert.match(notifications, /OnePickType\.pageTitle/, 'notifications title must use the shared type scale');
assert.match(notifications, /OnePickSpace\.gutter/, 'notifications must use the shared 16px gutter');
assert.match(notifications, /OnePickRadius\.sm/, 'notification kind tags must use the shared small radius');
assert.match(notifications, /OnePick\.borderDefault/, 'notification dividers must use the semantic border role');
assert.match(notifications, /OnePick\.bgAccent/, 'unread dot may use the brand accent role');

assert.match(notifications, /item\.kind === 'fix_needed'/, 'grouped inbox must retain the fix-needed behavior');
assert.match(notifications, /item\.unread_count > 0/, 'grouped inbox must render unread state from the grouped contract');
assert.doesNotMatch(notifications, /useReadNotificationGroup|markGroupRead/, 'opening the inbox must not mark groups read');
assert.match(itemDetail, /useReadNotificationGroup/, 'destination must own the grouped read receipt');
assert.match(itemDetail, /notificationSnapshot/, 'destination read receipt must preserve the server snapshot');

console.log('Notifications Foundations checks passed: shared visual tokens and grouped read-after-destination behavior.');
