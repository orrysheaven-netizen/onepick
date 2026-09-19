const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/items/itemIdentity.ts'), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject });
const request = { id: 'request', categoryId: 'ramen', normalizedName: '신라면', name: '신라면', status: 'pending' };
const candidate = (id, name, patch = {}) => ({ ...request, id, name, normalizedName: name, status: 'active', ...patch });
const result = exportsObject.similarItems(request, [
  request, candidate('other-category', '신라면', { categoryId: 'snacks' }),
  candidate('hidden', '신라면', { status: 'hidden' }),
  candidate('unrelated', '짜파게티'), candidate('partial', '신라면블랙'),
  candidate('exact', '신라면', { status: 'discontinued' }), candidate('extra', '진라면'),
]);
assert.equal(result.length, 3);
assert.equal(result[0].id, 'exact');
assert.equal(result[1].id, 'partial');
assert.ok(result.every((item) => !['request', 'other-category', 'hidden'].includes(item.id)));
console.log('Admin merge candidates passed: exact/partial ranking, category isolation, eligible status and bounded list.');
