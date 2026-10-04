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
  const publicCounts = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: [{
        category_id: 'ramen', category_name: '라면', group_category_id: 'noodles',
        pick_count: 7, rank: 1, is_tied: false, cover_item_id: 'jin',
        thumbnail_path: 'menu/ramen.jpg', image_path: null, image_source_url: null,
      }], error: null };
    },
  };
  const client = {
    rpc: () => assert.fail('Recent menu ranking must use the public aggregate client'),
    storage: { from: () => ({ getPublicUrl: (file) => ({ data: { publicUrl: `https://onepick.test/${file}` } }) }) },
  };
  const repository = new SupabaseReadRepository(client, publicCounts);
  const rows = await repository.getFoodMenuRecentRanking('noodles', 'offline', 4);
  assert.equal(calls[0].name, 'food_menu_recent_ranking');
  assert.equal(calls[0].args.p_group_category_id, 'noodles');
  assert.equal(calls[0].args.p_channel, 'offline');
  assert.equal(calls[0].args.p_limit, 4);
  assert.equal(rows[0].categoryId, 'ramen');
  assert.equal(rows[0].pickCount, 7);
  assert.equal(rows[0].thumbnailUrl, 'https://onepick.test/menu/ramen.jpg');

  await repository.getFoodMenuRecentRanking(null, null, 999);
  assert.equal(calls[1].args.p_group_category_id, null);
  assert.equal(calls[1].args.p_limit, 50, 'Client mirrors the RPC max limit');

  // Store×menu ranking (10-05): same public client, store name + menu name per row.
  const itemCalls = [];
  const itemRepository = new SupabaseReadRepository(client, { rpc: async (name, args) => {
    itemCalls.push({ name, args });
    return { data: [{ item_id: 'seoul', item_name: '서울집', category_id: 'soup', category_name: '미역국',
      pick_count: '23', rank: 1, is_tied: false, thumbnail_path: 'item/seoul.jpg', image_path: null, image_source_url: null }], error: null };
  } });
  const items = await itemRepository.getFoodItemRecentRanking('offline', 999);
  assert.equal(itemCalls[0].name, 'food_item_recent_ranking');
  assert.deepEqual({ ...itemCalls[0].args }, { p_channel: 'offline', p_limit: 50 }, 'Channel scope and the RPC max limit');
  assert.deepEqual({ ...items[0] }, { itemId: 'seoul', itemName: '서울집', categoryId: 'soup', categoryName: '미역국',
    pickCount: 23, rank: 1, isTied: false, thumbnailUrl: 'https://onepick.test/item/seoul.jpg' });

  let hookArgs;
  const hookModule = load('hooks/useHomeData.ts', {
    '@tanstack/react-query': {
      keepPreviousData: (value) => value,
      useQuery: (options) => options,
      useInfiniteQuery: (options) => options,
    },
    '@/lib/query/queryKeys': {
      queryKeys: {
        home: {
          menuRanking: (groupId, channel) => ['home', 'menu-ranking', groupId ?? 'all', channel ?? 'all'],
          data: () => ['home'],
        },
      },
    },
    '@/services/homeServiceInstance': {
      homeService: {
        getRecentMenuRanking: (...args) => { hookArgs = args; return []; },
      },
    },
  });
  const rankingOptions = hookModule.useHomeMenuRanking('noodles', 'offline', true);
  await rankingOptions.queryFn();
  assert.equal(hookArgs[2], 20, 'Home fetches enough candidates to backfill photo-less legacy rows');

  const tree = load('lib/categories/categoryTree.ts');
  const filters = load('lib/home/homeCategoryFilters.ts', { '@/lib/categories/categoryTree': tree });
  const categories = [
    { id: 'food', parentId: null, name: '먹을것', slug: 'food', status: 'open', isVisible: true, isPickable: false, sortOrder: 1 },
    { id: 'soup', parentId: 'food', name: '국/탕', slug: 'soup', status: 'open', isVisible: true, isPickable: false, sortOrder: 2 },
    { id: 'noodles', parentId: 'food', name: '면', slug: 'noodles', status: 'open', isVisible: true, isPickable: false, sortOrder: 1 },
    { id: 'ramen', parentId: 'noodles', name: '라면', slug: 'ramen', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
    { id: 'miyeokguk', parentId: 'soup', name: '미역국', slug: 'miyeokguk', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 },
  ];
  assert.deepEqual(Array.from(filters.homeMenuRankingGroups(categories), (g) => g.id), ['noodles', 'soup']);
  console.log('Home recent menu ranking: public RPC mapping, limit guard and food-group chips passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
