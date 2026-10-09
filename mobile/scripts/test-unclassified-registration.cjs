const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    URL,
    require: (name) => { assert.ok(name in imports, name); return imports[name]; },
  });
  return exports;
}

async function main() {
  const { AppError } = load('errors/appError.ts');
  const { RegistrationService } = load('services/registrationService.ts', {
    '@/errors/appError': { AppError },
    '@/lib/items/itemIdentity': load('lib/items/itemIdentity.ts'),
  });
  const calls = [];
  let failure;
  const result = { itemId: 'item', pickId: 'pick', published: false, replacedPickId: null, retried: false };
  const service = new RegistrationService({}, {
    registerUnclassifiedPick: async input => { calls.push(['save', input]); if (failure) throw failure; return result; },
    registerItemPick: async () => { throw new Error('Must not choose an arbitrary category'); },
  }, {}, {
    cleanupUnused: async () => { calls.push(['cleanup']); },
    upload: async () => { calls.push(['upload']); return { imagePath: 'owner/full.jpg', thumbnailPath: 'owner/thumb.jpg' }; },
    removeUnused: async paths => { calls.push(['removeUnused', [...paths]]); },
  }, {});
  const input = { userId: 'owner', categoryId: null, menuName: '  비법   국수  ', channel: 'offline',
    oneLineReview: '  맛있어요  ', requestId: 'request', expectedPreviousPickId: null,
    catalogId: 'store', photo: { uri: 'photo' } };
  assert.equal(await service.registerImmediatePick(input), result);
  const saved = calls.find(([name]) => name === 'save')[1];
  assert.equal(saved.menuName, '비법 국수');
  assert.equal(saved.oneLineReview, '맛있어요');
  assert.equal(saved.requestId, 'request');
  assert.equal(saved.catalogId, 'store');
  assert.equal(saved.imagePath, 'owner/full.jpg');
  assert.equal(calls.at(-1)[0], 'removeUnused');
  calls.length = 0;
  await service.registerImmediatePick({ ...input, catalogId: undefined,
    newPlace: { name: '새 매장', mapUrl: 'https://map.naver.com/p/search/store' } });
  assert.equal(calls.find(([name]) => name === 'save')[1].placeName, '새 매장');
  for (const [change, code] of [
    [{ photo: null }, 'PHOTO_REQUIRED'], [{ menuName: '' }, 'CATEGORY_NOT_PICKABLE'],
    [{ menuName: 'x'.repeat(41) }, 'CATEGORY_NOT_PICKABLE'],
    [{ channel: 'online' }, 'ITEM_SELECTION_REQUIRED'], [{ itemId: 'other' }, 'ITEM_SELECTION_REQUIRED'],
    [{ catalogId: undefined }, 'ITEM_SELECTION_REQUIRED'], [{ oneLineReview: '' }, 'REVIEW_INVALID'],
    [{ userId: '' }, 'AUTH_REQUIRED'],
  ]) {
    calls.length = 0;
    await assert.rejects(() => service.registerImmediatePick({ ...input, ...change }), error => error.code === code);
    assert.equal(calls.length, 0, 'Invalid input must never upload or save');
  }
  failure = new Error('Response lost'); calls.length = 0;
  await assert.rejects(() => service.registerImmediatePick(input), /Response lost/);
  assert.equal(calls.at(-1)[0], 'removeUnused', 'Best-effort cleanup also runs after an ambiguous RPC response; Storage RLS protects attached files');
  console.log('Unclassified registration checks passed: input preservation, store selection, validation and upload cleanup.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
