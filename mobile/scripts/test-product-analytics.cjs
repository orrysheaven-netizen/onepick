const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relativePath, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      if (name in imports) return imports[name];
      throw new Error('Unexpected dependency: ' + name);
    },
  });
  return exports;
}

async function main() {
  const calls = [];
  let rpcError = null;
  const fakeClient = {
    from: () => { throw new Error('Product events must use the rate-limited RPC'); },
    rpc: async (name, payload) => { calls.push([name, payload]); return { error: rpcError }; },
    auth: { getUser: async () => ({ data: { user: { id: 'viewer' } }, error: null }) },
  };
  const { SupabaseObservabilityRepository } = load('repositories/supabase/supabaseObservabilityRepository.ts', {
    '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
  });
  const repository = new SupabaseObservabilityRepository(fakeClient);
  await repository.captureProductEvent({
    eventName: 'pick_link_opened',
    pickId: 'pick',
    source: 'shared_or_direct',
    path: '/pick/[pickId]',
    platform: 'web',
    appVersion: '1.0.0',
  });
  assert.equal(calls[0][0], 'capture_product_event');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), {
    p_event_name: 'pick_link_opened', p_pick_id: 'pick', p_item_id: null,
    p_category_id: null, p_source: 'shared_or_direct', p_path: '/pick/[pickId]',
    p_platform: 'web', p_app_version: '1.0.0',
  }, 'RPC payload includes event fields only; server supplies identity and time');
  rpcError = { code: 'P0001', message: 'RATE_LIMITED' };
  await assert.rejects(repository.captureProductEvent({ eventName: 'auth_started' }),
    (error) => error === rpcError, 'quota errors follow the existing error mapping path');
  rpcError = null;

  let mutationOptions, events = [], invalidations = 0;
  const reactQuery = {
    useQueryClient: () => ({ id: 'cache' }),
    useMutation: (options) => { mutationOptions = options; return options; },
    useQuery: (options) => options,
  };
  const sharedImports = {
    '@tanstack/react-query': reactQuery,
    '@/lib/query/invalidatePickData': { invalidatePickData: () => { invalidations++; } },
    '@/lib/home/firstPickNotice': load('lib/home/firstPickNotice.ts'),
    '@/services': {
      pickService: { choosePick: async () => null },
      registrationService: {},
      observabilityService: { captureProductEvent: async (event) => { events.push(event); } },
    },
  };

  const { useChoosePick } = load('hooks/useChoosePick.ts', sharedImports);
  useChoosePick();
  mutationOptions.onSuccess({ id: 'pick-a', itemId: 'item-a', categoryId: 'cat-a' });
  await new Promise(setImmediate);
  assert.equal(invalidations, 1);
  assert.equal(events[0].eventName, 'pick_created');
  assert.equal(events[0].pickId, 'pick-a');
  assert.equal(events[0].itemId, 'item-a');
  assert.equal(events[0].categoryId, 'cat-a');
  assert.equal(events[0].source, 'choose_pick');
  assert.equal(events[0].path, '/pick/choose');

  events = [];
  const { useRegisterPick } = load('hooks/useRegisterPick.ts', sharedImports);
  useRegisterPick();
  mutationOptions.onSuccess({ type: 'pick', pick: { id: 'pick-b', itemId: 'item-b', categoryId: 'cat-b' } });
  await new Promise(setImmediate);
  assert.equal(events[0].eventName, 'pick_created');
  assert.equal(events[0].source, 'register_pick');
  const before = events.length;
  mutationOptions.onSuccess({ type: 'pending_item', item: { id: 'pending' } });
  await new Promise(setImmediate);
  assert.equal(events.length, before, 'Pending item requests are not counted as completed Picks');

  const source = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  assert.match(source('components/pick-share-actions.tsx'), /eventName: 'pick_share_clicked'/);
  assert.match(source('app/pick/[pickId].tsx'), /eventName: 'pick_link_opened'/);
  assert.match(source('app/item/[itemId].tsx'), /eventName: 'item_detail_viewed'/);
  assert.match(source('app/auth/login.tsx'), /eventName: 'auth_started'/);
  assert.match(source('app/auth/callback.tsx'), /eventName: 'auth_completed'/);

  console.log('Product analytics checks passed: rate-limited RPC payload, error propagation, Pick completion events and funnel instrumentation.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

