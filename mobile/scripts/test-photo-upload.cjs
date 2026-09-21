const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, Response, require: (name) => {
    assert.ok(name in imports, name);
    return imports[name];
  } });
  return exports;
}
async function main() {
  const { AppError } = load('errors/appError.ts');
  const { SupabasePhotoRepository } = load('repositories/supabase/supabasePhotoRepository.ts', {
    'base64-arraybuffer': require('base64-arraybuffer'),
    '@/errors/appError': { AppError },
    '@/errors/mapSupabaseError': { mapSupabaseError: (error) => new AppError(error.message) },
    '@/types/domain/photo': {},
  });
  const saved = new Map();
  let failThumbnail = true, duplicateStatus = '400', uploadCount = 0;
  const repository = new SupabasePhotoRepository({ storage: { from: (bucket) => {
    assert.equal(bucket, 'item-photos');
    return { upload: async (name, bytes, options) => {
      uploadCount++;
      assert.equal(options.upsert, false, 'Retries never overwrite a shared image');
      assert.equal(options.contentType, 'image/jpeg');
      if (saved.has(name)) return { error: { statusCode: duplicateStatus, message: 'The resource already exists' } };
      if (name.endsWith('-thumb.jpg') && failThumbnail) return { error: { statusCode: '500', message: 'Interrupted' } };
      saved.set(name, Buffer.from(bytes));
      return { error: null };
    } };
  } } });
  const photo = { uploadId: 'stable-draft', base64: 'YWJj', thumbnailBase64: 'eA==' };
  await assert.rejects(() => repository.upload('user', photo), (e) => e.code === 'PHOTO_UPLOAD_FAILED');
  assert.equal(saved.size, 1, 'Partial upload retains the full image for a safe retry');
  failThumbnail = false;
  const result = await repository.upload('user', photo);
  assert.equal(saved.size, 2, 'Legacy duplicate response allows the missing thumbnail to finish');
  assert.equal(result.imagePath, 'user/stable-draft.jpg');
  assert.equal(saved.get(result.imagePath).toString(), 'abc');
  duplicateStatus = '409';
  await repository.upload('user', photo);
  assert.equal(saved.size, 2, 'Current duplicate response also reuses the immutable pair');
  const largePhoto = {
    uploadId: 'large-draft',
    base64: Buffer.alloc(1024 * 1024 + 1, 1).toString('base64'),
    thumbnailBase64: Buffer.alloc(200 * 1024, 1).toString('base64'),
  };
  await repository.upload('user', largePhoto);
  assert.equal(saved.get('user/large-draft.jpg').byteLength, 1024 * 1024 + 1,
    'Client does not reject an optimized JPEG because it exceeds the old 768 KiB cap');
  assert.equal(saved.get('user/large-draft-thumb.jpg').byteLength, 200 * 1024,
    'Thumbnail is not rejected by the old 96 KiB cap');
  const invalid = new SupabasePhotoRepository({ storage: { from: () => ({ upload: async () => ({ error: { statusCode: '400', message: 'Invalid request' } }) }) } });
  await assert.rejects(() => invalid.upload('user', photo), (e) => e.code === 'PHOTO_UPLOAD_FAILED');
  console.log('Photo upload checks passed: partial failure/retry, immutable paths, duplicate retries and no client byte cap.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
