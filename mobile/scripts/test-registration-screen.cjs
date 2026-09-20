const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/app/pick/register.tsx'), 'utf8');

assert.match(source, /RegisterPickCompatibilityRoute/, 'Old registration links stay compatible');
assert.match(source, /pathname: '\/pick\/choose'/, 'Known items continue through the choose screen');
assert.match(source, /pathname: '\/pick\/find'/, 'Unknown or old name links return to the product-first search');
assert.doesNotMatch(source, /categories\.data.*map|카테고리.*선택/s, 'Legacy route must not expose user category picking');
assert.doesNotMatch(source, /TextInput|제품 등록 요청하기/, 'The old all-in-one registration form is retired');

console.log('Registration screen checks passed: legacy links redirect into product-first search/choose without category-picking UI.');
