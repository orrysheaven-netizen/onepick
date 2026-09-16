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
  const identity = load('lib/products/productIdentity.ts');
  const { canonicalProductName } = identity;

  for (const [input, slug, expected] of [
    ['진라면 매운맛 컵라면 110g', 'ramen', '진라면 매운맛'],
    ['진라면 매운맛 봉지면 120g 5봉', 'ramen', '진라면 매운맛'],
    ['진라면 순한맛 용기', 'ramen', '진라면 순한맛'],
    ['신라면큰사발', 'ramen', '신라면'],
    ['컵누들 매콤한맛', 'ramen', '컵누들 매콤한맛'],
    ['카스 프레시 500ml 캔', 'beer', '카스 프레시'],
    ['카스 0.0 330ml 병', 'beer', '카스 0.0'],
    ['참이슬 후레쉬 360ml 병', 'soju', '참이슬 후레쉬'],
    ['새우깡 매운맛 90g', 'snacks', '새우깡 매운맛'],
    ['새우깡 미니', 'snacks', '새우깡 미니'],
    ['신라면 컵 120g', 'future', '신라면 컵 120g'],
  ]) assert.equal(canonicalProductName(input, slug), expected, input);

  let calls = [];
  let product = null;
  let submittedStatus = 'pending';
  const category = { id: 'ramen', slug: 'ramen', isVisible: true, isPickable: true, status: 'open' };
  const futureCategory = { ...category, id: 'future', slug: 'future' };
  const hiddenCategory = { ...category, id: 'hidden', isPickable: false };

  const productRecord = (overrides = {}) => ({
    id: 'product',
    name: '진라면 매운맛',
    categoryId: 'ramen',
    status: 'active',
    imagePath: null,
    ...overrides,
  });

  const { RegistrationService } = load('services/registrationService.ts', {
    '@/errors/appError': { AppError },
    '@/lib/products/productIdentity': identity,
  });

  const service = new RegistrationService(
    { getById: async () => category, getOpenCategories: async () => [category, futureCategory, hiddenCategory] },
    { registerPick: async (input) => { calls.push(['save', input]); return { id: 'pick', oneLineReview: input.oneLineReview }; } },
    {
      getById: async () => product,
      submitProduct: async (input) => {
        calls.push(['submit', input]);
        return productRecord({
          id: 'submitted',
          name: input.productName,
          categoryId: input.categoryId,
          status: submittedStatus,
          imagePath: input.imagePath ?? null,
        });
      },
    },
    {
      cleanupUnused: async () => calls.push(['cleanup']),
      upload: async () => { calls.push(['upload']); return { imagePath: 'photo', thumbnailPath: 'thumb' }; },
      removeUnused: async (paths) => calls.push(['removeUnused', paths]),
      importFromUrl: async (url) => ({ dataUri: 'data:image/jpeg;base64,eA==', sourceUrl: url }),
    },
    { preparePhoto: async (uri, sourceUrl) => ({ uri, sourceUrl }), choosePhoto: async () => null },
  );

  assert.equal((await service.getCategories()).length, 2, 'All visible pickable categories are available without hardcoded slugs');

  const input = {
    userId: 'me',
    categoryId: 'ramen',
    productName: '진라면 매운맛 컵라면',
    variant: '',
    oneLineReview: '',
  };

  const pending = await service.register(input);
  assert.equal(pending.type, 'pending_product', 'Unknown product becomes an approval request');
  assert.deepEqual(calls.map(([name]) => name), ['submit'], 'Image-free product request only submits the product');
  assert.equal(calls[0][1].productName, '진라면 매운맛');

  calls = [];
  product = productRecord({ id: 'existing', imagePath: 'shared' });
  const existing = await service.register({ ...input, productId: product.id, oneLineReview: '  이유  ', photo: { base64: 'unused' } });
  assert.equal(existing.type, 'pick');
  assert.deepEqual(calls.map(([name]) => name), ['save'], 'Existing representative image is reused');
  assert.equal(calls[0][1].oneLineReview, '이유');

  calls = [];
  product = productRecord({ id: 'existing', imagePath: null });
  const withPhoto = await service.register({
    ...input,
    productId: product.id,
    oneLineReview: '사진 있는 이유',
    photo: { base64: 'image', sourceUrl: 'https://www.otoki.com/test' },
  });
  assert.equal(withPhoto.type, 'pick');
  assert.deepEqual(calls.map(([name]) => name), ['cleanup', 'upload', 'save', 'removeUnused']);
  assert.equal(calls[2][1].imageSourceUrl, 'https://www.otoki.com/test');

  calls = [];
  await assert.rejects(
    () => service.register({ ...input, productId: product.id, oneLineReview: ' ', photo: { base64: 'image' } }),
    (error) => error.code === 'REVIEW_INVALID',
  );
  assert.equal(calls.length, 0, 'Existing-product review is validated before any upload');

  calls = [];
  product = null;
  submittedStatus = 'active';
  const resolved = await service.register(input);
  assert.equal(resolved.type, 'existing_product', 'A concurrent duplicate resolves to the existing approved product');
  assert.deepEqual(calls.map(([name]) => name), ['submit']);

  calls = [];
  submittedStatus = 'pending';
  category.isVisible = false;
  await assert.rejects(() => service.register(input), (error) => error.code === 'CATEGORY_NOT_PICKABLE');
  assert.equal(calls.length, 0, 'Validate category availability before uploading or submitting');
  category.isVisible = true;

  await assert.rejects(() => service.importPhoto('http://localhost/test'), (error) => error.code === 'IMAGE_SOURCE_UNSUPPORTED');
  const imported = await service.importPhoto('https://www.otoki.com/product');
  assert.equal(imported.sourceUrl, 'https://www.otoki.com/product');

  console.log('Registration checks passed: generic categories, pending approval, existing-product picks, photo reuse, validation and URL import.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });