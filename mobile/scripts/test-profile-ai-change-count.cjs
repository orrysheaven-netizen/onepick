const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'supabase/functions/_shared/pickChangeCount.ts'), 'utf8');
const mod = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: mod.exports, module: mod },
);
const { countPickChanges } = mod.exports;

const pick = (categoryKey, itemKey, review = 'r') => ({ categoryKey, itemKey, review });

// One-pick categories behave exactly like the old per-category comparison.
assert.equal(countPickChanges([pick('ramen', 'a')], [pick('ramen', 'a')]), 0);
assert.equal(countPickChanges([pick('ramen', 'a')], [pick('ramen', 'b')]), 1, 'a swap is one change');
assert.equal(countPickChanges([pick('ramen', 'a')], [pick('ramen', 'a', 'edited')]), 1, 'an edited review is one change');
assert.equal(countPickChanges([], [pick('ramen', 'a')]), 1, 'a new category is one change');
assert.equal(countPickChanges([pick('ramen', 'a')], []), 1, 'a dropped category is one change');

// Several picks in one category are compared by item, not collapsed to one.
const movies = ['m1', 'm2', 'm3'].map((id) => pick('movie', id));
assert.equal(countPickChanges(movies, [...movies].reverse()), 0, 'reordering is not a change');
assert.equal(countPickChanges(movies, [...movies, pick('movie', 'm4')]), 1, 'adding a fourth movie is one change');
assert.equal(countPickChanges(movies, movies.slice(1)), 1, 'removing a movie is one change');
assert.equal(
  countPickChanges(movies, [pick('movie', 'm1'), pick('movie', 'x2'), pick('movie', 'x3')]),
  2,
  'replacing two movies is two changes',
);
assert.equal(
  countPickChanges(movies, [pick('movie', 'm1', 'edited'), pick('movie', 'm2'), pick('movie', 'm3'), pick('movie', 'm4')]),
  2,
  'an edit plus an addition in one category are two changes',
);
assert.equal(
  countPickChanges([...movies, pick('ramen', 'a')], [pick('movie', 'm1'), pick('ramen', 'b')]),
  3,
  'changes add up across categories',
);

for (const file of ['analyze-profile-taste/index.ts', 'profile-ai-status/index.ts']) {
  const text = fs.readFileSync(path.join(root, 'supabase/functions', file), 'utf8');
  assert.match(text, /from '\.\.\/_shared\/pickChangeCount\.ts'/, `${file} must use the shared change counter`);
}

console.log('Profile AI change count checks passed: picks are compared per item inside each category.');
