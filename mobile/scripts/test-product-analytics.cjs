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
  const inserted = [];
  const fakeClient = {
    from: (name) => ({
      insert: async (payload) => { inserted.push([name, payload]); return { error: null }; },
    }),
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
  assert.equal(inserted[0][0], 'product_analytics_events');
  assert.equal(inserted[0][1].event_name, 'pick_link_opened');
  assert.equal(inserted[0][1].pick_id, 'pick');
  assert.equal(Object.hasOwn(inserted[0][1], 'user_id'), false,
    'Client analytics must never choose another user id; DB auth context supplies it');

  let mutationOptions, events = [], invalidations = 0;
  const reactQuery = {
    useQueryClient: () => ({ id: 'cache' }),
    useMutation: (options) => { mutationOptions = options; return options; },
    useQuery: (options) => options,
  };
  const sharedImports = {
    '@tanstack/react-query': reactQuery,
    '@/lib/query/invalidatePickData': { invalidatePickData: () => { invalidations++; } },
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
  assert.deepEqual(events[0], {
    eventName: 'pick_created',
    pickId: 'pick-a',
    itemId: 'item-a',
    categoryId: 'cat-a',
    source: 'choose_pick',
    path: '/pick/choose',
  });

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
  assert.match(source('components/pick-share-card.tsx'), /eventName: 'pick_share_clicked'/);
  assert.match(source('app/pick/[pickId].tsx'), /eventName: 'pick_link_opened'/);
  assert.match(source('app/item/[itemId].tsx'), /eventName: 'item_detail_viewed'/);
  assert.match(source('app/auth/login.tsx'), /eventName: 'auth_started'/);
  assert.match(source('app/auth/callback.tsx'), /eventName: 'auth_completed'/);

  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260919001751_add_product_analytics_events.sql'), 'utf8');
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /for insert\s+to anon, authenticated\s+with check \(user_id is not distinct from \(select auth\.uid\(\)\)\)/i);
  assert.match(migration, /for select\s+to authenticated\s+using \(\(select private\.is_admin/i);
  assert.doesNotMatch(migration, /grant\s+(update|delete)/i);

  console.log('Product analytics checks passed: safe DB payload, Pick completion events, funnel instrumentation and insert-only RLS contract.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
