const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/categories/categoryTree.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exported });

const category = (id, parentId = null, extra = {}) => ({
  id,
  parentId,
  name: id,
  status: 'open',
  isVisible: true,
  isPickable: Boolean(parentId),
  sortOrder: 0,
  ...extra,
});

const rows = [
  category('food'),
  category('shopping', 'food', { isPickable: false }),
  category('kimchi', 'shopping'),
  category('ramen', 'food'),
  category('hidden', 'food', { isVisible: false }),
  category('closed', 'food', { status: 'closed' }),
  category('unpublished', null, { isVisible: false }),
  category('invisible-parent-child', 'unpublished'),
  category('orphan', 'missing'),
  category('empty'),
  category('snack', null, { isPickable: true }),
];

const selectable = exported.selectableCategories(rows);
assert.deepEqual(Array.from(selectable, (c) => c.id).sort(), ['kimchi', 'ramen', 'snack']);
assert.equal(exported.categoryLabel(rows.find((c) => c.id === 'kimchi'), rows), 'food › shopping › kimchi');

const groups = exported.browseCategoryGroups(rows);
assert.equal(groups.length, 3);
assert.deepEqual(Array.from(groups.find((g) => g.category.id === 'food').children, (c) => c.id), ['ramen', 'kimchi']);
assert.equal(groups.find((g) => g.category.id === 'food').directlySelectable, false);
assert.equal(groups.find((g) => g.category.id === 'empty').children.length, 0);
assert.equal(groups.find((g) => g.category.id === 'snack').directlySelectable, true);

rows.push(category('reading', null, { sortOrder: -1 }), category('books', 'reading'));
assert.equal(exported.browseCategoryGroups(rows)[0].category.id, 'reading', 'New categories use admin sort order without code changes');
assert.equal(exported.browseCategoryGroups(rows)[0].children[0].id, 'books');

const tooDeep = [...rows, category('fourth', 'kimchi')];
assert.equal(exported.selectableCategories(tooDeep).some((c) => c.id === 'fourth'), false, 'A fourth category level is never selectable');

console.log('Explore category checks passed: 1-3 levels, full paths, visibility, empty groups, legacy leaves and ordering.');
