const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name) => { assert.ok(name in imports, name); return imports[name]; } });
  return exports;
}
async function main() {
  const { AppError } = load('errors/appError.ts');
  const tree = load('lib/categories/categoryTree.ts');
  const base = { status: 'open', isVisible: true, isPickable: true, parentId: null, sortOrder: 0, rankingMinSample: 20 };
  const parent = { ...base, id: 'food', name: '음식', slug: 'food', isPickable: false };
  const child = { ...base, id: 'new', name: '새 분류', slug: 'new', parentId: 'food' };
  const categories = [parent, child];
  assert.equal(tree.selectableCategories(categories).map((c) => c.id).join(','), 'new');
  assert.equal(tree.categoryLabel(child, categories), '음식 › 새 분류');
  for (const patch of [{ status: 'paused' }, { isVisible: false }, { isPickable: true }]) {
    assert.equal(tree.selectableCategories([{ ...parent, ...patch }, child]).length, 0);
  }
  assert.equal(tree.selectableCategories([child]).length, 0, 'Missing or inaccessible parent blocks eligibility');
  let admin = true, writes = [], aliases = [];
  const repo = {
    isAdmin: async () => admin, getCategories: async () => categories,
    createCategory: async (value) => { writes.push(value); return value; },
    updateCategory: async (id, value) => { writes.push(value); return value; },
    getProductById: async (id) => id === 'already-approved'
      ? { id, status: 'active', normalizedName: '기존제품' }
      : { id, status: 'active', normalizedName: '테스트제품', categoryId: 'new' },
    createProductAlias: async (productId, alias) => { aliases.push({ productId, alias }); return { productId, alias }; },
    removeProductAlias: async (id) => { aliases = aliases.filter((item) => item.id !== id); },
  };
  const identity = load('lib/products/productIdentity.ts');
  const { AdminService } = load('services/adminService.ts', {
    '@/errors/appError': { AppError }, '@/lib/categories/categoryTree': tree, '@/lib/products/productIdentity': identity,
  });
  const service = new AdminService(repo, {});
  await service.createCategory({ name: '  새   카테고리 ', slug: 'new-category', parentId: 'food', isPickable: true });
  assert.equal(writes[0].name, '새 카테고리');
  await assert.rejects(() => service.createCategory({ name: '잘못된 하위', slug: 'bad', parentId: 'new' }), (e) => e.code === 'CATEGORY_INVALID');
  await assert.rejects(() => service.updateCategory('food', { isPickable: true }), (e) => e.code === 'CATEGORY_INVALID');
  await assert.rejects(() => service.updateCategory('new', { slug: 'changed' }), (e) => e.code === 'CATEGORY_INVALID');
  await assert.rejects(() => service.updateCategory('new', { parentId: 'new' }), (e) => e.code === 'CATEGORY_INVALID');
  await assert.rejects(() => service.createCategory({ name: '순서 오류', slug: 'bad', sortOrder: NaN }), (e) => e.code === 'CATEGORY_INVALID');
  await assert.rejects(() => service.approveProduct('already-approved'), (e) => e.code === 'PICK_CONFLICT');
  await assert.rejects(() => service.addProductAlias('product', '테스트 제품'), (e) => e.code === 'PRODUCT_ALIAS_REDUNDANT');
  await service.addProductAlias('product', '다른 검색 이름');
  assert.equal(aliases[0].alias, '다른 검색 이름');
  admin = false;
  await assert.rejects(() => service.createCategory({ name: '금지', slug: 'denied' }), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(() => service.addProductAlias('product', '금지 별칭'), (e) => e.code === 'FORBIDDEN');
  assert.equal(writes.length, 1, 'Invalid or unauthorized changes never reach repository');
  const { queryKeys } = load('lib/query/queryKeys.ts');
  const invalidated = [];
  const client = { invalidateQueries: async ({ queryKey }) => invalidated.push(queryKey[0]) };
  const hooks = load('hooks/useAdmin.ts', {
    '@tanstack/react-query': { useQuery: (options) => options, useMutation: (options) => options, useQueryClient: () => client },
    '@/lib/query/queryKeys': { queryKeys }, '@/services': { adminService: service },
  });
  assert.equal(hooks.useAdminDashboard().enabled, false);
  assert.notEqual(JSON.stringify(hooks.useAdminDashboard('a').queryKey), JSON.stringify(hooks.useAdminDashboard('b').queryKey));
  await hooks.useAdminActions().updateCategory.onSuccess();
  assert.equal(invalidated.sort().join(','), 'admin,categories,explore,home,picks,products,profiles');
  invalidated.length = 0;
  await hooks.useAdminActions().addProductAlias.onSuccess();
  assert.equal(invalidated.sort().join(','), 'admin,categories,explore,home,picks,products,profiles');
  console.log('Admin checks passed: category tree, alias validation, permissions and cache refresh.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
