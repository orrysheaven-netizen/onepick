const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relativePath, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports,
    require: (name) => {
      if (name in imports) return imports[name];
      throw new Error('Unexpected runtime dependency: ' + name);
    },
    URL,
    AbortController,
  });
  return exports;
}

async function main() {
  const calls = [];
  const fakeRepository = {
    search: async (query, signal) => { calls.push(['search', query, signal]); return [{ catalogId: 'catalog' }]; },
    selectPlace: async (catalogId, categoryId) => { calls.push(['select', catalogId, categoryId]); return { itemId: 'item', categoryId, created: true }; },
  };
  const { PlaceCatalogService } = load('services/placeCatalogService.ts');
  const service = new PlaceCatalogService(fakeRepository);
  const signal = new AbortController().signal;

  assert.deepEqual(await service.search(' '), []);
  assert.deepEqual(await service.search(' a '), []);
  assert.equal(calls.length, 0, 'invalid place queries never reach the repository');
  assert.equal((await service.search('  을지로   냉면  ', signal))[0].catalogId, 'catalog');
  assert.equal(calls[0][1], '을지로 냉면');
  assert.equal(calls[0][2], signal);
  assert.equal((await service.selectPlace('catalog-id', 'category-id')).created, true);
  assert.deepEqual(calls[1], ['select', 'catalog-id', 'category-id']);

  const intents = load('lib/auth/authIntent.ts', { 'expo-router': {} });
  const categoryId = '11111111-1111-4111-8111-111111111111';
  const catalogId = '22222222-2222-4222-8222-222222222222';
  const intent = intents.getAuthIntent({ action: 'choose_place', categoryId, externalPlaceId: catalogId });
  assert.equal(JSON.stringify(intent), JSON.stringify({ action: 'choose_place', categoryId, externalPlaceId: catalogId }));
  assert.equal(JSON.stringify(intents.getPostAuthRoute(intent)), JSON.stringify({ pathname: '/pick/find', params: { categoryId, externalPlaceId: catalogId } }));
  assert.equal(intents.getPostAuthRoute(intents.getAuthIntent({ action: 'choose_place', categoryId, externalPlaceId: '../../bad' })), '/');

  const finder = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'pick', 'find.tsx'), 'utf8');
  assert.match(finder, /PlaceCatalogResults/);
  assert.match(finder, /startsWith\('먹을것 ›'\)/);
  assert.match(finder, /externalPlaceId/);

  const repository = fs.readFileSync(path.join(__dirname, '..', 'src', 'repositories', 'supabase', 'supabasePlaceCatalogRepository.ts'), 'utf8');
  assert.match(repository, /from\('place_catalog'\)/);
  assert.match(repository, /rpc\('select_place_catalog_item'/);
  assert.doesNotMatch(repository, /from\('places'\)\.insert/);
  assert.doesNotMatch(repository, /from\('items'\)\.insert/);

  console.log('Place catalog checks passed: normalized search, auth return, trusted catalog selection and existing finder integration.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
