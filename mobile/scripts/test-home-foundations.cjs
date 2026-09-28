const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const home = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/index.tsx'), 'utf8');

assert.match(home, /paddingHorizontal: OnePickSpace\.gutter/);
assert.match(home, /OnePickType\.headline/);
assert.match(home, /OnePickType\.bodyMedium/);
assert.match(home, /OnePickType\.caption/);
assert.match(home, /borderRadius: OnePickRadius\.lg/);
assert.match(home, /scopeTabSelected: \{ backgroundColor: OnePick\.actionPrimary/);
assert.doesNotMatch(home, /fontWeight: ['"](?:800|900)['"]/);
assert.doesNotMatch(home, /paddingHorizontal: 20/);

console.log('Home Foundations checks passed: gutter, type scale, semantic radius and selected-state ink are enforced.');
