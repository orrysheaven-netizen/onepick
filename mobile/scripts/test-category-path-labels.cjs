const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name) => { if (name in imports) return imports[name]; throw new Error(name); } });
  return exports;
}
const tree = load('lib/categories/categoryTree.ts');
const mapper = load('repositories/mappers/categoryMapper.ts');
const rows = [
  { id:'food', parent_id:null, name:'먹을것', slug:'food', status:'open', is_visible:true, is_pickable:false, ranking_min_sample:1, sort_order:1, image_url:null, created_at:'', updated_at:'' },
  { id:'mall', parent_id:'food', name:'쇼핑몰', slug:'mall', status:'open', is_visible:true, is_pickable:false, ranking_min_sample:1, sort_order:1, image_url:null, created_at:'', updated_at:'' },
  { id:'kimchi', parent_id:'mall', name:'김치', slug:'kimchi', status:'open', is_visible:true, is_pickable:true, ranking_min_sample:1, sort_order:1, image_url:null, created_at:'', updated_at:'' },
];
let fromCalls = 0, orders = [];
const chain = {
  select() { return chain; }, eq() { return chain; },
  order(...args) { orders.push(args); return orders.length === 2 ? Promise.resolve({ data: rows, error: null }) : chain; },
};
const client = { from(table) { fromCalls++; assert.equal(table, 'categories'); return chain; } };
const { SupabaseCategoryRepository } = load('repositories/supabase/supabaseCategoryRepository.ts', {
  '@/errors/mapSupabaseError': { mapSupabaseError: (e) => e },
  '@/lib/categories/categoryTree': tree,
  '@/repositories/mappers/categoryMapper': mapper,
});
(async () => {
  const repo = new SupabaseCategoryRepository(client);
  const open = await repo.getOpenCategories();
  assert.equal(fromCalls, 1, 'Full labels come from one category-tree read, not parent N+1 queries');
  assert.equal(open.length, 1);
  assert.equal(open[0].id, 'kimchi');
  assert.equal(open[0].label, '먹을것 › 쇼핑몰 › 김치');
  console.log('Category path labels passed: three-level registration label with one tree read.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
