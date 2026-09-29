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
assert.doesNotMatch(legacy, /<Redirect href=\{\{ pathname: '\/item\/\[itemId\]'/, 'pick detail is now the dedicated review conversation');
assert.match(legacy, /useItemDetail\(itemId, user\?\.id, pickId/, 'conversation detail resolves viewer-scoped review permissions');
assert.match(legacy, /<PickReplies/, 'conversation detail owns the comment thread');

console.log('Item detail Foundations checks passed: item list + dedicated review conversation use shared visual tokens.');
