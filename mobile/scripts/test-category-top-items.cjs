const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient } = require('@tanstack/react-query');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name) => { assert.ok(name in imports, name); return imports[name]; } });
  return exports;
}
async function main() {
  const { AppError } = load('errors/appError.ts');
  const { mapSupabaseError } = load('errors/mapSupabaseError.ts', { './appError': { AppError } });
  const imports = { '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError } };
  for (const name of ['category', 'comment', 'pick', 'item', 'profile']) {
    imports[`@/repositories/mappers/${name}Mapper`] = load(`repositories/mappers/${name}Mapper.ts`);
  }
  const { SupabaseReadRepository } = load('repositories/supabase/supabaseReadRepository.ts', imports);
  const calls = [];
  let failed = false;
  const publicCounts = { rpc: async (name, args) => {
    calls.push({ name, args });
    return failed ? { error: { message: 'Offline' } } : { data: args.p_category_id === 'ramen' ? [
      { item_id: 'winner', name: '대표 라면', thumbnail_path: 'public/thumb.jpg', pick_count: 101, rank: 1, is_tied: false },
    ] : [] };
  } };
  const client = { rpc: () => assert.fail('Rankings must use the public aggregate client'), storage: { from: () => ({
    getPublicUrl: (file) => ({ data: { publicUrl: `https://onepick.test/${file}` } }),
  }) } };
  const repository = new SupabaseReadRepository(client, publicCounts);
  const { ExploreService } = load('services/exploreService.ts');
  const service = new ExploreService({}, repository);
  const result = await service.getCategoryTopItems('ramen');
  assert.equal(result[0].pickCount, 101);
  assert.equal(result[0].thumbnailUrl, 'https://onepick.test/public/thumb.jpg');
  assert.equal(calls[0].name, 'category_top_items');
  assert.equal(calls[0].args.p_category_id, 'ramen');
  assert.equal((await service.getCategoryTopItems('snack')).length, 0);
  failed = true;
  await assert.rejects(() => service.getCategoryTopItems('ramen'));

  const { queryKeys } = load('lib/query/queryKeys.ts');
  const { invalidatePickData } = load('lib/query/invalidatePickData.ts', { './queryKeys': { queryKeys } });
  const cache = new QueryClient();
  cache.setQueryData(queryKeys.explore.topItems('ramen'), result);
  cache.setQueryData(queryKeys.explore.topItems('snack'), []);
  assert.notDeepEqual(queryKeys.explore.topItems('ramen'), queryKeys.explore.topItems('snack'));
  await invalidatePickData(cache);
  assert.equal(cache.getQueryState(queryKeys.explore.topItems('ramen')).isInvalidated, true);
  assert.equal(cache.getQueryState(queryKeys.explore.topItems('snack')).isInvalidated, true);
  cache.clear();
  console.log('Category top items: public aggregate client, photo mapping, category scope, errors and mutation invalidation passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
