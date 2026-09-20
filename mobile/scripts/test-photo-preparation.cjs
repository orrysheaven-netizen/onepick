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
    Date,
    Math,
    require: (name) => {
      assert.ok(name in imports, name);
      return imports[name];
    },
  });
  return exports;
}

async function main() {
  const { AppError } = load('errors/appError.ts');
  const limits = load('types/domain/photo.ts');
  const resizeCalls = [];

  function dimensions(uri) {
    const match = /^mock:\/\/(\d+)x(\d+)$/.exec(uri);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
    if (uri === 'file://normal.jpg') return { width: 769, height: 512 };
    if (uri === 'file://huge.jpg') return { width: 5000, height: 4000 };
    throw new Error(`Unknown mock URI: ${uri}`);
  }

  const ImageManipulator = {
    manipulate(uri) {
      const source = dimensions(uri);
      let resize;
      return {
        resize(value) {
          resize = value;
          resizeCalls.push({ uri, ...value });
          return this;
        },
        async renderAsync() {
          let width = source.width;
          let height = source.height;
          if (resize?.width && resize.width < width) {
            height = Math.max(1, Math.round(height * (resize.width / width)));
            width = resize.width;
          } else if (resize?.height && resize.height < height) {
            width = Math.max(1, Math.round(width * (resize.height / height)));
            height = resize.height;
          }
          return {
            width,
            height,
            release() {},
            async saveAsync() {
              const maxSide = Math.max(width, height);
              const bytes = maxSide > 1000 ? 900 * 1024 : maxSide > 400 ? 130 * 1024 : 50 * 1024;
              return {
                uri: `mock://${width}x${height}`,
                width,
                height,
                base64: 'A'.repeat(Math.ceil(bytes / 0.75)),
              };
            },
          };
        },
        release() {},
      };
    },
  };

  const { DevicePhotoRepository } = load('repositories/device/devicePhotoRepository.ts', {
    'expo-image-manipulator': { ImageManipulator, SaveFormat: { JPEG: 'jpeg' } },
    'expo-image-picker': { launchImageLibraryAsync: async () => ({ canceled: true }) },
    '@/errors/appError': { AppError },
    '@/types/domain/photo': limits,
  });

  const repository = new DevicePhotoRepository();

  resizeCalls.length = 0;
  const normal = await repository.preparePhoto('file://normal.jpg');
  assert.ok(normal.base64.length > 0);
  assert.equal(normal.uri, 'mock://769x512', '769px source is accepted without a pixel-dimension rejection');
  assert.deepEqual(
    resizeCalls.filter((call) => call.uri === 'file://normal.jpg'),
    [],
    'A normal source that already fits the byte budget is not resized just because its width is 769px',
  );
  assert.ok(
    resizeCalls.some((call) => call.uri === 'mock://769x512' && call.width === 320),
    'A separate thumbnail is still optimized for list rendering',
  );

  resizeCalls.length = 0;
  const huge = await repository.preparePhoto('file://huge.jpg');
  assert.ok(huge.base64.length > 0);
  assert.ok(
    resizeCalls.some((call) => call.uri === 'file://huge.jpg' && call.width === 1200),
    'Large sources are optimized automatically instead of asking the user to resize them',
  );
  assert.ok(
    resizeCalls.some((call) => call.uri === 'file://huge.jpg' && call.width === 900),
    'If compression alone cannot fit the byte budget, dimensions are reduced and retried automatically',
  );

  console.log('Photo preparation checks passed: 769px images are accepted and oversized sources are auto-optimized.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
