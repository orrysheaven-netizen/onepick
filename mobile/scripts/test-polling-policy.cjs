const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hooksDir = path.join(__dirname, '../src/hooks');
const notifications = fs.readFileSync(path.join(hooksDir, 'useNotifications.ts'), 'utf8');
const itemPickCount = fs.readFileSync(path.join(hooksDir, 'useItemPickCount.ts'), 'utf8');

const countStart = notifications.indexOf('export function useNotificationCount');
const listStart = notifications.indexOf('export function useNotifications');
const readStart = notifications.indexOf('export function useReadNotification');
assert.ok(countStart >= 0 && listStart > countStart && readStart > listStart);

const countBlock = notifications.slice(countStart, listStart);
const listBlock = notifications.slice(listStart, readStart);

assert.match(countBlock, /refetchInterval:\s*30_000/);
assert.match(countBlock, /staleTime:\s*20_000/);
assert.doesNotMatch(listBlock, /refetchInterval:\s*\d/);
assert.match(listBlock, /staleTime:\s*30_000/);
assert.match(listBlock, /refetchIntervalInBackground:\s*false/);

assert.match(itemPickCount, /staleTime:\s*60_000/);
assert.match(itemPickCount, /refetchInterval:\s*120_000/);
assert.doesNotMatch(itemPickCount, /refetchInterval:\s*(?:20_000|30_000|60_000)/);

console.log('Polling policy checks passed: only notification count polls frequently and item pick count is at least two minutes.');
