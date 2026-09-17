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
    assert.ok(name in imports, name);
    return imports[name];
  } });
  return exports;
}

async function main() {
  const { AppError } = load('errors/appError.ts');
  const { RegistrationService } = load('services/registrationService.ts', {
    '@/errors/appError': { AppError },
    '@/lib/items/itemIdentity': { canonicalItemName: (name) => name.trim() },
  });

  const photo = { uri: 'file://photo.jpg', base64: 'YWJj', thumbnailBase64: 'eA==', uploadId: 'draft' };
  const blankItem = { id: 'item', status: 'active', imagePath: null };
  const uploaded = { imagePath: 'user/draft.jpg', thumbnailPath: 'user/draft-thumb.jpg' };
  const removed = [];
  let uploadCount = 0;
  let attachCount = 0;
  let currentItem = blankItem;
  let attachedItem = { ...blankItem, ...uploaded };

  const itemRepository = {
    getById: async () => currentItem,
    attachPhoto: async (input) => {
      attachCount++;
      assert.equal(JSON.stringify(input), JSON.stringify({ itemId: 'item', ...uploaded }));
      return attachedItem;
    },
  };
  const photoRepository = {
    cleanupUnused: async () => {},
    upload: async () => { uploadCount++; return uploaded; },
    removeUnused: async (paths) => { removed.push([...paths]); },
  };
  const service = new RegistrationService({}, {}, itemRepository, photoRepository, {});

  const result = await service.attachItemPhoto({ userId: 'user', itemId: 'item', photo });
  assert.equal(result.imagePath, uploaded.imagePath);
  assert.equal(uploadCount, 1);
  assert.equal(attachCount, 1);
  assert.equal(removed.length, 0, 'Winning contribution remains referenced');

  attachedItem = { ...blankItem, imagePath: 'other/winner.jpg', thumbnailPath: 'other/winner-thumb.jpg' };
  await service.attachItemPhoto({ userId: 'user', itemId: 'item', photo });
  assert.deepEqual(removed.pop(), [uploaded.imagePath, uploaded.thumbnailPath], 'Concurrent losing upload is cleaned');

  currentItem = attachedItem;
  await service.attachItemPhoto({ userId: 'user', itemId: 'item', photo });
  assert.equal(uploadCount, 2, 'Existing image skips another upload');
  assert.equal(attachCount, 2, 'Existing image skips another RPC');

  currentItem = blankItem;
  itemRepository.attachPhoto = async () => { throw new AppError('NETWORK_ERROR'); };
  await assert.rejects(() => service.attachItemPhoto({ userId: 'user', itemId: 'item', photo }), (error) => error.code === 'NETWORK_ERROR');
  assert.deepEqual(removed.pop(), [uploaded.imagePath, uploaded.thumbnailPath], 'Failed attachment cleans the unused upload');

  await assert.rejects(() => service.attachItemPhoto({ userId: '', itemId: 'item', photo }), (error) => error.code === 'AUTH_REQUIRED');
  console.log('Item photo contribution checks passed: first win, race cleanup, existing image reuse and failure cleanup.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
