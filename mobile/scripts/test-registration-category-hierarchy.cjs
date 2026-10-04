const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function load(relative) {
  const moduleExports = {};
  vm.runInNewContext(ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: moduleExports,
    require: (name) => { assert.fail('Unexpected import: ' + name); },
  });
  return moduleExports;
}

const tree = load('src/lib/categories/categoryTree.ts');

const parent = (id, name, sortOrder) => ({
  id, parentId: null, name, slug: id, status: 'open',
  isVisible: true, isPickable: false, sortOrder,
});
const leaf = (id, parentId, name, sortOrder) => ({
  id, parentId, name, slug: id, status: 'open',
  isVisible: true, isPickable: true, sortOrder,
});

const catalog = [
  parent('food', '음식', 10),
  parent('culture', '문화', 20),
  leaf('ramen', 'food', '라면', 1),
  leaf('snacks', 'food', '과자', 2),
  leaf('movie', 'culture', '영화', 1),
  leaf('drama', 'culture', '드라마', 2),
];
const selectable = catalog.filter((category) => category.isPickable);

const groups = tree.selectionCategoryGroups(catalog, selectable);
assert.deepEqual(Array.from(groups, (group) => group.name ?? group.category.name), ['음식', '문화']);
assert.deepEqual(Array.from(groups[0].children, (category) => category.name), ['라면', '과자']);
assert.deepEqual(Array.from(groups[1].children, (category) => category.name), ['영화', '드라마']);
assert.equal(groups[0].directlySelectable, false);

const foodPath = tree.categoryPath(selectable[0], catalog);
assert.equal(foodPath.parent.name, '음식');
assert.equal(foodPath.label, '음식 › 라면');

const fallback = tree.selectionCategoryGroups([], selectable.slice(0, 2));
assert.equal(fallback.length, 2, 'catalog failure keeps selectable leaves visible');
assert.equal(fallback.every((group) => group.directlySelectable), true);
assert.deepEqual(Array.from(fallback, (group) => group.category.name), ['라면', '과자']);

console.log('Registration category hierarchy checks passed: shared parent-child taxonomy and fallback leaves.');
