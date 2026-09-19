const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(relativePath, imports = {}) {
  const file = path.join(__dirname, '..', 'src', relativePath);
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports,
    process: { env: { NODE_ENV: 'production' } },
    console: { error() {}, warn() {} },
    require: (name) => {
      if (name in imports) return imports[name];
      throw new Error('Unexpected runtime dependency: ' + name);
    },
  });
  return exports;
}

async function main() {
  const { AppError } = loadSource('errors/appError.ts');
  const captured = [];
  const productEvents = [];
  let fail = false;
  const repository = {
    captureClientError: async (input) => {
      if (fail) throw new Error('offline');
      captured.push(input);
    },
    captureProductEvent: async (input) => {
      if (fail) throw new Error('offline');
      productEvents.push(input);
    },
  };
  const { ObservabilityService } = loadSource('services/observabilityService.ts', {
    'expo-constants': { expoConfig: { version: '1.2.3' } },
    'react-native': { Platform: { OS: 'ios' } },
    '@/errors/appError': { AppError },
  });
  const service = new ObservabilityService(repository);

  await service.captureError(new AppError('FORBIDDEN'), '  admin_screen  ');
  assert.equal(captured[0].context, 'admin_screen');
  assert.equal(captured[0].errorCode, 'FORBIDDEN');
  assert.equal(captured[0].platform, 'ios');
  assert.equal(captured[0].appVersion, '1.2.3');

  await service.captureError(new Error('private raw message'), 'x'.repeat(120));
  assert.equal(captured[1].errorCode, 'UNEXPECTED_ERROR');
  assert.equal(captured[1].context.length, 80);
  assert.equal('message' in captured[1], false, 'Raw error messages must not be persisted');
  assert.equal('stack' in captured[1], false, 'Raw stacks must not be persisted');

  await service.captureProductEvent({
    eventName: 'pick_share_clicked',
    pickId: 'pick-id',
    source: '  image_card  ',
    path: ' /pick/[pickId] ',
  });
  assert.equal(productEvents[0].eventName, 'pick_share_clicked');
  assert.equal(productEvents[0].pickId, 'pick-id');
  assert.equal(productEvents[0].source, 'image_card');
  assert.equal(productEvents[0].path, '/pick/[pickId]');
  assert.equal(productEvents[0].platform, 'ios');
  assert.equal(productEvents[0].appVersion, '1.2.3');

  await service.captureProductEvent({
    eventName: 'item_detail_viewed',
    source: 'x'.repeat(100),
    path: '/' + 'y'.repeat(300),
  });
  assert.equal(productEvents[1].source.length, 40);
  assert.equal(productEvents[1].path.length, 160);

  fail = true;
  await service.captureError(new Error('capture failure must be swallowed'), 'root_error_boundary');
  await service.captureProductEvent({ eventName: 'auth_started', source: 'home' });

  console.log('Observability checks passed: errors and product events are sanitized, metadata-only and non-blocking.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
