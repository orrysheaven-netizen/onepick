const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const home = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/index.tsx'), 'utf8');

assert.match(home, /OnePickSpace\.gutter/, 'Home must use the Foundations 16px gutter token');
assert.match(home, /OnePickType\.(?:headline|bodyMedium|body|captionMedium|caption)/, 'Home must use the shared Foundations type scale');
assert.match(home, /OnePickRadius\.(?:lg|full)/, 'Home must use the shared Foundations radius scale');
assert.match(home, /OnePick\.(?:bgDefault|bgMuted|borderDefault|textPrimary|textSecondary)/, 'Home must use semantic Foundations colors');
assert.doesNotMatch(home, /fontWeight:\s*['"](?:800|900)['"]/, 'Home must not reintroduce 800/900 font weights');
assert.doesNotMatch(home, /fontSize:\s*\d+/, 'Home text must use the seven shared typography styles instead of ad-hoc font sizes');

console.log('Home Foundations checks passed: typography, spacing, radius and semantic colors.');
