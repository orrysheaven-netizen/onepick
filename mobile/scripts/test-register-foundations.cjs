const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/app/pick/new.tsx'), 'utf8');

assert.doesNotMatch(source, /const V6\s*=/, 'registration must not keep a screen-local design token palette');
assert.match(source, /OnePickType\.pageTitle/, 'registration title must use the shared type scale');
assert.match(source, /OnePickType\.bodyMedium/, 'registration actions and labels must use the shared type scale');
assert.match(source, /OnePickSpace\.gutter/, 'registration must use the shared 16px gutter');
assert.match(source, /OnePickRadius\.md/, 'inputs/buttons/results must use the shared radius scale');
assert.match(source, /OnePickRadius\.full/, 'chips must use the shared full radius');
assert.match(source, /OnePick\.bgOverlay/, 'dialog overlay must use the semantic overlay role');
assert.doesNotMatch(source, /fontWeight:\s*['"](?:800|900)['"]/, 'registration must not use 800/900 weights');
assert.doesNotMatch(source, /#[0-9A-Fa-f]{6}/, 'registration screen must not embed six-digit hex colors');

console.log('Registration Foundations checks passed: shared type, spacing, radius and color roles.');
