const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText, {
    exports,
    require(name) {
      if (name === '@/types/domain/category') return {};
      assert.fail('Unexpected dependency: ' + name);
    },
  });
  return exports;
}

const { chooseOnboardingCategory } = load('lib/onboarding/categorySequence.ts');
const category = (id, slug, parentId = null) => ({
  id, slug, parentId, name: slug, label: slug, status: 'open',
  isVisible: true, isPickable: true, sortOrder: 0,
});
const categories = [
  category('food', 'food'),
  category('ramen', 'ramen', 'food'),
  category('content', 'content'),
  category('movie', 'movie', 'content'),
  category('drama', 'drama', 'content'),
  category('music', 'music', 'content'),
  category('daily', 'daily-use'),
  category('notebook', 'notebook', 'daily'),
  category('alcohol', 'alcohol'),
  category('beer', 'beer', 'alcohol'),
].filter((item) => !['food','content','daily','alcohol'].includes(item.id));

const base = {
  categories,
  currentCategoryId: null,
  handledCategoryIds: [],
  events: [],
  userId: 'owner',
};
assert.equal(chooseOnboardingCategory(base).slug, 'ramen', 'First starter is ramen');
assert.equal(chooseOnboardingCategory({
  ...base, handledCategoryIds: ['ramen'], events: [{ categoryId: 'ramen', sequenceNo: 1 }],
}).slug, 'movie', 'Second starter is movie');

const resumed = chooseOnboardingCategory({
  ...base,
  currentCategoryId: 'music',
  handledCategoryIds: ['ramen', 'movie'],
  events: [{ categoryId: 'ramen', sequenceNo: 1 }, { categoryId: 'movie', sequenceNo: 2 }],
});
assert.equal(resumed.id, 'music', 'Exit/resume keeps the current category');

const afterContent = chooseOnboardingCategory({
  ...base,
  handledCategoryIds: ['ramen', 'movie', 'drama'],
  events: [
    { categoryId: 'ramen', sequenceNo: 1 },
    { categoryId: 'movie', sequenceNo: 2 },
    { categoryId: 'drama', sequenceNo: 3 },
  ],
});
assert.notEqual(afterContent.parentId, 'content', 'Random phase prefers a different parent group when available');
assert.notEqual(afterContent.slug, 'beer', 'Alcohol is never a promoted starter');

const completed = chooseOnboardingCategory({
  ...base,
  handledCategoryIds: categories.map((item) => item.id),
  events: categories.map((item, index) => ({ categoryId: item.id, sequenceNo: index + 1 })),
});
assert.equal(completed, null, 'No handled category is shown twice');

console.log('Taste onboarding checks passed: starters, resume, diversity and no repeats.');
