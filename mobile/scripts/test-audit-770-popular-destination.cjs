const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const home = read('src/app/(tabs)/index.tsx');
const layout = read('src/app/_layout.tsx');

assert.doesNotMatch(home, /router\.push\('\/popular'\)|accessibilityLabel="인기 메뉴 더보기"/);
assert.doesNotMatch(layout, /Stack\.Screen name="popular"/);
assert.equal(fs.existsSync(path.join(root, 'src/app/popular.tsx')), false);

console.log('PASS #770 keeps popular-menu destination undecided');
