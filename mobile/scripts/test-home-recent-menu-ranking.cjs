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
  const { mapSupabaseError } = load('errors/mapSupabaseError.ts', { './appError': { AppError } });
  const imports = {
    '@/errors/appError': { AppError },
    '@/errors/mapSupabaseError': { mapSupabaseError },
    '@/repositories/supabase/itemChannels': { fetchItemChannels: async () => new Map() },
    '@/repositories/supabase/itemProviders': { fetchItemProviderIds: async () => new Map() },
  };
  for (const name of ['category', 'comment', 'pick', 'item', 'profile']) {
    imports[`@/repositories/mappers/${name}Mapper`] = load(`repositories/mappers/${name}Mapper.ts`);
  }
  const { SupabaseReadRepository } = load('repositories/supabase/supabaseReadRepository.ts', imports);

  const calls = [];
  let failed = false;
  const publicCounts = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (failed) return { data: null, error: { message: 'Offline' } };
      assert.equal(name, 'food_menu_recent_ranking');
      return { data: [{
        category_id: 'ramen',
        category_name: '라면',
        group_category_id: 'noodles',
        pick_count: 4,
        rank: 1,
        is_tied: false,
        cover_item_id: 'cover',
        thumbnail_path: 'public/ramen-thumb.jpg',
        image_path: 'public/ramen.jpg',
        image_source_url: null,
      }], error: null };
    },
  };
  const client = {
    rpc: () => assert.fail('Recent menu ranking must use the public aggregate client'),
    storage: { from: (bucket) => {
      assert.equal(bucket, 'item-photos');
      return { getPublicUrl: (file) => ({ data: { publicUrl: `https://onepick.test/${file}` } }) };
    } },
  };

  const repository = new SupabaseReadRepository(client, publicCounts);
  const rows = await repository.getFoodMenuRecentRanking(null, 4);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'food_menu_recent_ranking');
  assert.deepEqual({ ...calls[0].args }, { p_group_category_id: null, p_limit: 4 });
  assert.deepEqual({ ...rows[0] }, {
    categoryId: 'ramen',
    categoryName: '라면',
    groupCategoryId: 'noodles',
    pickCount: 4,
    rank: 1,
    isTied: false,
    coverItemId: 'cover',
    thumbnailUrl: 'https://onepick.test/public/ramen-thumb.jpg',
  });

  await repository.getFoodMenuRecentRanking('noodles', 99);
  assert.equal(calls[1].args.p_group_category_id, 'noodles');
  assert.equal(calls[1].args.p_limit, 20, 'Client stays within the RPC limit');

  failed = true;
  await assert.rejects(() => repository.getFoodMenuRecentRanking(null, 4));
  console.log('Home recent menu ranking: public RPC, group scope, bounded limit, image mapping and errors passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
