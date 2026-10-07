const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(relativePath, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports,
    require: (name) => {
      if (name in imports) return imports[name];
      throw new Error('Unexpected runtime dependency: ' + name);
    },
  });
  return exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));

class AppError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function main() {
  const calls = [];
  const repository = {
    isEnabled: async (categoryId) => { calls.push(['enabled', categoryId]); return true; },
    search: async (categoryId, query, signal) => { calls.push(['search', categoryId, query, signal]); return [{ id: 'row' }]; },
    select: async (categoryId, catalogId) => { calls.push(['select', categoryId, catalogId]); return { itemId: 'item', categoryId }; },
  };
  const { PlaceCatalogService } = loadSource('services/placeCatalogService.ts', {
    '@/errors/appError': { AppError },
  });
  const service = new PlaceCatalogService(repository);
  const categoryId = '11111111-1111-1111-1111-111111111111';
  const catalogId = '22222222-2222-2222-2222-222222222222';

  assert.equal(await service.isEnabled('bad'), false);
  assert.equal(calls.length, 0, 'Invalid category ids never reach the repository');
  assert.deepEqual(plain(await service.search(categoryId, ' 한 ', undefined)), []);
  assert.equal(calls.length, 0, 'One-character place queries stay local');
  assert.deepEqual(plain(await service.search(categoryId, '  원픽   식당  ', undefined)), [{ id: 'row' }]);
  assert.deepEqual(plain(calls.pop().slice(0, 3)), ['search', categoryId, '원픽 식당']);
  assert.deepEqual(plain(await service.select(categoryId, catalogId)), { itemId: 'item', categoryId });
  assert.deepEqual(plain(calls.pop()), ['select', categoryId, catalogId]);
  assert.throws(() => service.select(categoryId, 'not-a-uuid'), (error) => error.code === 'ITEM_NOT_FOUND');

  const auth = loadSource('lib/auth/authIntent.ts');
  const placeIntent = { action: 'choose_place', categoryId, placeCatalogId: catalogId };
  assert.deepEqual(plain(auth.getAuthIntent(placeIntent)), placeIntent);
  assert.deepEqual(plain(auth.getPostAuthRoute(auth.getAuthIntent(placeIntent))), {
    pathname: '/pick/find', params: { categoryId, placeCatalogId: catalogId },
  });
  assert.equal(auth.getPostAuthRoute(auth.getAuthIntent({ ...placeIntent, placeCatalogId: '../../bad' })), '/');
  const onboarding = auth.getPostAuthRoute(auth.getAuthIntent(placeIntent), true);
  assert.equal(onboarding.pathname, '/auth/username');
  assert.deepEqual(
    plain(auth.getPostAuthRoute(auth.getAuthIntent(onboarding.params))),
    { pathname: '/pick/find', params: { categoryId, placeCatalogId: catalogId } },
    'Place selection survives username onboarding as well as ordinary OAuth return',
  );

  const finder = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'pick', 'find.tsx'), 'utf8');
  assert.match(finder, /usePlaceCatalogCapability/);
  assert.match(finder, /usePlaceCatalogSearch/);
  assert.match(finder, /selectPlace\.mutateAsync/);
  assert.match(finder, /action: 'choose_place'/);
  assert.match(finder, /externalSource === 'onepick_place'/,
    'Place-enabled categories must not surface legacy name-only items as physical branches');
  assert.match(finder, /장소가 확인되지 않은 이름만으로 맛집 원픽을 만들지는 않아요/,
    'No-result UX must not fall back to generic name-only restaurant registration');
  assert.match(finder, /아직 등록된 가게가 없어요/);
  assert.match(finder, /가게 등록 요청하기/);
  assert.match(finder, /pathname: '\/pick\/request'/,
    'Place-empty state may open the request flow without creating a name-only pick directly');

  const migration = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260922130000_add_place_catalog_user_selection.sql'), 'utf8');
  assert.match(migration, /place_catalog_enabled boolean not null default false/);
  assert.match(migration, /create or replace function public\.search_place_catalog/);
  assert.match(migration, /create or replace function public\.select_place_catalog_item/);
  assert.match(migration, /external_source,external_id[\s\S]*'onepick_place'/);
  assert.match(migration, /business_status='open'/);
  assert.match(migration, /if not v_place\.is_visible then[\s\S]*ITEM_NOT_ELIGIBLE/,
    'User selection must not reactivate a moderated canonical place');

  console.log('Place catalog checks passed: capability gate, search, login return, canonical materialization and no name-only fallback.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });