const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, require: (name) => {
    if (name in imports) return imports[name];
    assert.fail(`Unexpected dependency: ${name}`);
  } });
  return exports;
}

const { AppError } = load('errors/appError.ts');
const { mapSupabaseError } = load('errors/mapSupabaseError.ts', {
  './appError': { AppError },
});

async function main() {
  // The repository must call the deployed public RPC and preserve every
  // idempotency/concurrency argument plus the response ids.
  const rpcCalls = [];
  const fakeClient = {
    rpc: async (name, args) => {
      rpcCalls.push([name, args]);
      return {
        data: {
          item_id: 'item-result',
          pick_id: 'pick-result',
          published: false,
          replaced_pick_id: 'old-pick',
          retried: true,
        },
        error: null,
      };
    },
  };
  const { SupabasePickRepository } = load('repositories/supabase/supabasePickRepository.ts', {
    '@/errors/appError': { AppError },
    '@/errors/mapSupabaseError': { mapSupabaseError },
    '@/repositories/mappers/pickMapper': { mapPickRow: (row) => row },
  });
  const repository = new SupabasePickRepository(fakeClient);
  const result = await repository.registerItemPick({
    categoryId: 'category',
    channel: 'offline',
    oneLineReview: '좋아요',
    itemId: 'item',
    expectedPreviousPickId: 'previous-pick',
    requestId: 'request-id',
  });
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0][0], 'register_item_pick');
  assert.equal(rpcCalls[0][1].p_request_id, 'request-id');
  assert.equal(rpcCalls[0][1].p_expected_previous_pick_id, 'previous-pick');
  assert.equal(rpcCalls[0][1].p_item_id, 'item');
  assert.equal(result.itemId, 'item-result');
  assert.equal(result.pickId, 'pick-result');
  assert.equal(result.published, false);
  assert.equal(result.retried, true);
  assert.equal(result.replacedPickId, 'old-pick');

  // stage_user_place_item keeps its legacy p_road_address parameter; the app sends ''.
  const itemRpcCalls = [];
  const { SupabaseItemRepository } = load('repositories/supabase/supabaseItemRepository.ts', {
    '@/errors/appError': { AppError },
    '@/errors/mapSupabaseError': { mapSupabaseError },
    '@/repositories/mappers/itemMapper': { mapItemRow: (row) => row },
    '@/repositories/supabase/itemChannels': { fetchItemChannels: async () => new Map() },
    '@/repositories/supabase/itemProviders': { fetchItemProviderIds: async () => new Map() },
  });
  const supabaseItems = new SupabaseItemRepository({
    rpc: async (name, args) => { itemRpcCalls.push([name, args]); return { data: { id: 'staged' }, error: null }; },
  });
  await supabaseItems.stageUserPlaceItem({ categoryId: 'category', name: '새 가게', mapUrl: 'https://naver.me/new-place' });
  assert.equal(itemRpcCalls[0][0], 'stage_user_place_item');
  assert.equal(itemRpcCalls[0][1].p_road_address, '');
  assert.equal(itemRpcCalls[0][1].p_map_url, 'https://naver.me/new-place');

  // Supabase P0001 concurrency errors must remain distinguishable in the UI.
  const mapped = mapSupabaseError({ code: 'P0001', message: 'PICK_CHANGED_ELSEWHERE', details: 'actual-pick' });
  assert.ok(mapped instanceof AppError);
  assert.equal(mapped.code, 'PICK_CHANGED_ELSEWHERE');
  assert.equal(mapped.cause.details, 'actual-pick');

  // The UI reads the current slot before confirmation. The service must preserve
  // that visible snapshot even if the database changes before the write.
  const registerCalls = [];
  const photoCalls = [];
  const placeStageCalls = [];
  const brandStageCalls = [];
  let current = [{ id: 'previous-online', channel: 'online' }];
  let currentReads = 0;
  const pickRepository = {
    getCurrentPicksInCategory: async () => { currentReads += 1; return current; },
    registerItemPick: async (input) => {
      registerCalls.push(input);
      return { itemId: input.itemId ?? 'server-item', pickId: 'server-pick', published: false, replacedPickId: null, retried: false };
    },
  };
  const itemRepository = {
    stageUserPlaceItem: async (input) => {
      placeStageCalls.push(input);
      return { id: 'staged-item' };
    },
    stageBrandItem: async (input) => {
      brandStageCalls.push(input);
      return { id: 'brand-staged-item' };
    },
  };
  const photoRepository = {
    cleanupUnused: async () => {},
    upload: async (_userId, photo) => {
      photoCalls.push(['upload', photo.uploadId]);
      return { imagePath: 'owner/full.jpg', thumbnailPath: 'owner/thumb.jpg' };
    },
    removeUnused: async (paths) => { photoCalls.push(['cleanup', paths.join(',')]); },
  };
  const { RegistrationService } = load('services/registrationService.ts', {
    '@/errors/appError': { AppError },
    '@/lib/items/itemIdentity': { canonicalItemName: (name) => name },
  });
  const service = new RegistrationService(
    { getOpenCategories: async () => [] },
    pickRepository,
    itemRepository,
    photoRepository,
    { choosePhoto: async () => null, preparePhoto: async () => null },
  );

  const visibleSlot = await service.getCurrentPickSlot('owner', 'category', 'online');
  assert.equal(visibleSlot.id, 'previous-online');
  current = [{ id: 'changed-after-screen', channel: 'online' }];
  await service.registerImmediatePick({
    userId: 'owner',
    categoryId: 'category',
    channel: 'online',
    oneLineReview: '온라인 원픽',
    requestId: 'same-request',
    expectedPreviousPickId: visibleSlot.id,
    itemId: 'existing-item',
  });
  assert.equal(registerCalls[0].expectedPreviousPickId, 'previous-online',
    'the write must use the screen snapshot, not a last-moment repository read');
  assert.equal(currentReads, 1, 'registerImmediatePick must not silently refresh the visible concurrency snapshot');
  assert.equal(registerCalls[0].requestId, 'same-request');

  // A catalog-missing Figma 75 store must keep place/provider identity:
  // stage_user_place_item first, then register_item_pick owns the current Pick.
  current = [];
  await service.registerImmediatePick({
    userId: 'owner',
    categoryId: 'category',
    channel: 'offline',
    oneLineReview: '신규 원픽',
    requestId: 'new-request',
    expectedPreviousPickId: null,
    newPlace: {
      name: '새 가게',
      mapUrl: 'https://naver.me/new-place',
    },
    photo: { uri: 'file://photo', base64: 'x', thumbnailBase64: 'y', uploadId: 'photo-1' },
  });
  assert.equal(placeStageCalls.length, 1);
  assert.equal(placeStageCalls[0].name, '새 가게');
  assert.equal(placeStageCalls[0].roadAddress, undefined, 'New stores are staged without a road address (#593)');
  assert.equal(placeStageCalls[0].mapUrl, 'https://naver.me/new-place');
  assert.equal(registerCalls[1].itemId, 'staged-item');
  assert.equal(registerCalls[1].imagePath, 'owner/full.jpg');
  assert.equal(registerCalls[1].thumbnailPath, 'owner/thumb.jpg');
  assert.equal(registerCalls[1].expectedPreviousPickId, null);
  assert.equal(registerCalls[1].requestId, 'new-request');
  assert.ok(photoCalls.some(([name]) => name === 'cleanup'));

  // A brand-wide choice stages brand × menu, never the selected branch catalog.
  await service.registerImmediatePick({
    userId: 'owner',
    categoryId: 'category',
    channel: 'offline',
    oneLineReview: '브랜드 전체 원픽',
    requestId: 'brand-request',
    expectedPreviousPickId: null,
    brandId: 'brand-1',
  });
  assert.equal(brandStageCalls.length, 1);
  assert.deepEqual({ ...brandStageCalls[0] }, { categoryId: 'category', brandId: 'brand-1' });
  assert.equal(registerCalls[2].itemId, 'brand-staged-item');
  assert.equal(registerCalls[2].catalogId, undefined);
  assert.equal(registerCalls[2].providerId, undefined);
  assert.equal(registerCalls[2].requestId, 'brand-request');

  console.log('Immediate registration checks passed: public RPC wiring, visible concurrency snapshot, request id, user-place/brand staging, and photo forwarding.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
