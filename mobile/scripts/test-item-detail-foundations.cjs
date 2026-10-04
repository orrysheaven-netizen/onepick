const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/app/item/[itemId].tsx'), 'utf8');
const legacy = fs.readFileSync(path.join(__dirname, '../src/app/pick/[pickId].tsx'), 'utf8');

assert.match(source, /OnePickType\.pageTitle/, 'item detail must use the shared type scale');
assert.match(source, /OnePickSpace\.gutter/, 'item detail must use the shared gutter');
assert.match(source, /OnePickRadius\.(?:md|lg|full)/, 'item detail must use the shared radius scale');
assert.match(source, /OnePick\.borderDefault/, 'item detail must use semantic borders');
assert.doesNotMatch(source, /fontWeight:\s*['"](?:800|900)['"]/, 'item detail must not use 800/900 weights');
// 10-04: no separate conversation screen. /pick/[pickId] hands off to the item
// detail, whose review cards expand their own comment thread.
assert.match(legacy, /<Redirect href=\{\{ pathname: '\/item\/\[itemId\]', params: \{ itemId, pickId, thread: '1'/, 'pick route opens the review thread on the item detail');
assert.doesNotMatch(legacy, /<PickReplies/, 'pick route no longer renders its own thread');
const card = fs.readFileSync(path.join(__dirname, '../src/components/item-review-card.tsx'), 'utf8');
assert.match(card, /<PickReplies pickId=\{pick\.id\} canWrite=\{Boolean\(pick\.canComment\)\}/, 'review card owns the inline thread with viewer-scoped write permission');
assert.match(card, /preview=\{\{ limit: 3, totalCount: commentCount \}\}/, 'inline thread previews three recent comments');

console.log('Item detail Foundations checks passed: item list + inline review threads use shared visual tokens.');
