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
const source = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');

async function main() {
  const { AppError } = load('errors/appError.ts');
  const { mapSupabaseError } = load('errors/mapSupabaseError.ts', { './appError': { AppError } });
  const imports = { '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError },
    '@/repositories/supabase/itemChannels': { fetchItemChannels: async () => new Map() } };
  for (const name of ['category', 'comment', 'pick', 'item', 'profile']) {
    imports[`@/repositories/mappers/${name}Mapper`] = load(`repositories/mappers/${name}Mapper.ts`);
  }
  const { SupabaseReadRepository } = load('repositories/supabase/supabaseReadRepository.ts', imports);
  const calls = [];
  const publicCounts = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: [
      { channel: 'offline', item_id: 'store', item_name: '미역국집', thumbnail_path: 'public/store.jpg', image_path: null, image_source_url: null, pick_count: 3 },
      { channel: 'online', item_id: 'mall', item_name: '미역국몰', thumbnail_path: null, image_path: null, image_source_url: null, pick_count: '0' },
      { channel: 'unknown', item_id: 'odd', item_name: '이상한 채널', thumbnail_path: null, image_path: null, image_source_url: null, pick_count: 1 },
    ] };
  } };
  const client = { rpc: () => assert.fail('Menu channel counts must use the public aggregate client'), storage: { from: () => ({
    getPublicUrl: (file) => ({ data: { publicUrl: `https://onepick.test/${file}` } }),
  }) } };
  const { ExploreService } = load('services/exploreService.ts');
  const service = new ExploreService({}, new SupabaseReadRepository(client, publicCounts));
  const rows = await service.getMenuChannelItems('miyeokguk');
  assert.equal(calls[0].name, 'explore_menu_channel_items');
  assert.equal(JSON.stringify(calls[0].args), JSON.stringify({ p_category_id: 'miyeokguk' }));
  assert.deepEqual([...rows].map((row) => `${row.channel}:${row.itemId}:${row.pickCount}`), ['offline:store:3', 'online:mall:0']);
  assert.equal(rows[0].thumbnailUrl, 'https://onepick.test/public/store.jpg');

  const { queryKeys } = load('lib/query/queryKeys.ts');
  assert.notDeepEqual(queryKeys.explore.menuChannels('a'), queryKeys.explore.menuChannels('b'));
  assert.equal(queryKeys.explore.menuChannels('a')[0], 'explore', 'Pick changes invalidate explore, including menu lists');

  const results = source('components/menu-channel-results.tsx');
  assert.match(results, /\{ key: 'offline', label: '매장' \},\s*\{ key: 'online', label: '온라인' \},\s*\{ key: 'recipe', label: '레시피' \}/,
    'Menu tabs are 매장, 온라인, 레시피 in that order');
  assert.match(results, /useItemSearch\(menu\.name, undefined, recipeCategory \? \[recipeCategory\.id\] : \[\]\)/,
    'Recipes search the 레시피 category by the menu name, and never search everything when it is missing');
  assert.match(results, /레시피는 준비 중이에요/);

  const explore = source('app/(tabs)/explore.tsx');
  assert.match(explore, /homeMenuCategories\(categoryCatalog\)\.filter\(\(menu\) => menu\.slug !== 'recipe'\)/,
    'The 레시피 category is a tab, not a menu');
  assert.match(explore, /onQueryChange=\{setSearchQuery\}/);
  assert.match(explore, /<MenuChannelResults key=\{activeMenu\.id\}/);
  assert.match(explore, /params: \{ categoryId: menu\.id, channel: tab \}/, 'Empty 매장/온라인 tabs start registration in that channel');
  assert.match(source('components/item-search.tsx'), /\{resultsHeader\}/);
  console.log('Explore menu channels: public counts, channel filter, tab order, recipe search scope and registration routes passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
