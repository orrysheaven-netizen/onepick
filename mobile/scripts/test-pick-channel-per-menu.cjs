const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name) => {
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  } });
  return exports;
}

async function main() {
  // Food menus hold one current Pick per channel; other categories one per category.
  const categories = [
    { id: 'food', parentId: null, slug: 'food' },
    { id: 'soups', parentId: 'food', slug: 'food-soups-rice' },
    { id: 'miyeokguk', parentId: 'soups', slug: 'miyeokguk' },
    { id: 'books', parentId: null, slug: 'books' },
  ];
  const items = {
    store: { id: 'store', categoryId: 'miyeokguk', status: 'active', channels: ['offline'] },
    hybrid: { id: 'hybrid', categoryId: 'miyeokguk', status: 'active', channels: ['offline', 'online'] },
    seller: { id: 'seller', categoryId: 'miyeokguk', status: 'active', channels: ['online'] },
    video: { id: 'video', categoryId: 'miyeokguk', status: 'active', channels: [], externalSource: 'youtube_video' },
    packaged: { id: 'packaged', categoryId: 'miyeokguk', status: 'active', channels: [] },
    book: { id: 'book', categoryId: 'books', status: 'active' },
    book2: { id: 'book2', categoryId: 'books', status: 'active' },
  };
  let mine = [];
  const { ItemService } = load('services/itemService.ts', { '@/errors/appError': { AppError: Error } });
  const service = new ItemService(
    { getById: async (id) => items[id] },
    { getCurrentPicksInCategory: async (_user, categoryId) => mine.filter((pick) => pick.categoryId === categoryId) },
    { getById: async (id) => categories.find((category) => category.id === id), getOpenCategories: async () => categories },
    { getPicks: async () => [], getPickById: async () => null },
  );

  mine = [{ id: 'p-store', itemId: 'store', categoryId: 'miyeokguk', channel: 'offline', oneLineReview: '동네 최고' }];
  let detail = await service.getItemDetail('seller', 'me');
  assert.equal(detail.myPickStatus.type, 'not_selected', 'An online item does not replace the offline Pick of the same menu');
  assert.equal(detail.pickChannel, 'online');

  detail = await service.getItemDetail('store', 'me');
  assert.equal(detail.myPickStatus.type, 'selected_this');
  assert.equal(detail.pickChannel, 'offline', 'My own Pick keeps its channel');

  mine = [{ id: 'p-hybrid', itemId: 'hybrid', categoryId: 'miyeokguk', channel: 'offline', oneLineReview: '매장' }];
  detail = await service.getItemDetail('hybrid', 'me', undefined, undefined, 'online');
  assert.equal(detail.myPickStatus.type, 'not_selected', 'An explicit other channel must not edit this item\'s existing Pick');
  assert.equal(detail.pickChannel, 'online', 'The route channel wins over the item\'s existing Pick channel');

  mine = [{ id: 'p-store', itemId: 'store', categoryId: 'miyeokguk', channel: 'offline', oneLineReview: '동네 최고' }];
  mine.push({ id: 'p-seller', itemId: 'seller', categoryId: 'miyeokguk', channel: 'online', oneLineReview: '택배' });
  detail = await service.getItemDetail('packaged', 'me');
  assert.equal(detail.myPickStatus.type, 'selected_other', 'A packaged product without channels would replace the online Pick');
  assert.equal(detail.myPickStatus.currentPickId, 'p-seller');
  assert.equal(detail.pickChannel, 'online');

  detail = await service.getItemDetail('packaged', 'me', undefined, undefined, 'offline');
  assert.equal(detail.myPickStatus.currentPickId, 'p-store', 'A chosen channel decides which Pick is replaced');
  assert.equal(detail.pickChannel, 'offline');

  detail = await service.getItemDetail('video', 'me');
  assert.equal(detail.myPickStatus.type, 'not_selected', 'A recipe is its own channel');
  assert.equal(detail.pickChannel, 'recipe');

  mine = [{ id: 'p-book', itemId: 'book', categoryId: 'books', channel: null, oneLineReview: '좋은 책' }];
  detail = await service.getItemDetail('book2', 'me');
  assert.equal(detail.myPickStatus.type, 'selected_other', 'Other categories keep one Pick per category');
  assert.equal(detail.pickChannel, null);

  // The repository sends the channel only when it is known.
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: name === 'remove_pick' ? true : { id: 'p', channel: args.p_channel ?? null }, error: null }; } };
  const { SupabasePickRepository } = load('repositories/supabase/supabasePickRepository.ts', {
    '@/errors/appError': { AppError: Error },
    '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
    '@/repositories/mappers/pickMapper': load('repositories/mappers/pickMapper.ts'),
  });
  const repository = new SupabasePickRepository(client);
  await repository.changePick({ categoryId: 'miyeokguk', itemId: 'video', oneLineReview: '집밥', channel: 'recipe' });
  await repository.changePick({ categoryId: 'books', itemId: 'book', oneLineReview: '책' });
  await repository.removePick('miyeokguk', 'online');
  await repository.removePick('books');
  assert.equal(calls[0][1].p_channel, 'recipe');
  assert.equal('p_channel' in calls[1][1], false, 'Non-food Picks send no channel');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[2])), ['remove_pick', { p_category_id: 'miyeokguk', p_channel: 'online' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[3])), ['remove_pick', { p_category_id: 'books' }]);

  const { mapPickRow } = load('repositories/mappers/pickMapper.ts');
  assert.equal(mapPickRow({ channel: 'recipe' }).channel, 'recipe');
  assert.equal(mapPickRow({ channel: 'delivery' }).channel, null, 'Unknown channel values are dropped');
  assert.equal(mapPickRow({ channel: null }).channel, null);

  // Labels cover the recipe channel.
  const home = load('lib/home/homeChannels.ts');
  assert.equal(home.channelLabel('recipe'), '레시피');
  assert.equal(home.homeChannelLabel(['recipe', 'offline']), '오프라인 맛집·레시피');
  assert.equal(home.isPickChannel('recipe'), true);

  const choose = fs.readFileSync(path.join(__dirname, '../src/app/pick/choose.tsx'), 'utf8');
  assert.match(choose, /routeChannel && !OnePickFeatures\.foodChannelPicker \? OnePickMvp\.publicPickChannel : routeChannel/,
    'Initial MVP normalizes crafted future-channel choose routes to the public channel');
  assert.match(choose, /\.\.\.\(pickChannel \? \{ channel: pickChannel \} : \{\}\)/, 'The choose screen saves under the resolved channel');
  assert.match(choose, /저장하면 \$\{itemQuery\.data\?\.category\?\.name\?\.trim\(\) \|\| \(pickChannel \? '이 메뉴' : '이 카테고리'\)\}의 원픽이 바뀌어요\./, 'Replacing names the menu (Figma 61-2)');
  const find = fs.readFileSync(path.join(__dirname, '../src/app/pick/find.tsx'), 'utf8');
  assert.match(find, /\.\.\.\(isPlaceCategory \? \{ channel \} : \{\}\)/, '매장/온라인 search passes its channel to the choose screen');

  console.log('Pick channels passed: one Pick per menu and channel, recipe channel, channel-aware remove and labels.');
}

main().catch((error) => { console.error(error); process.exit(1); });
