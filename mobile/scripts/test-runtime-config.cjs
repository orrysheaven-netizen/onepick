const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const babel = require('@babel/core');

const filename = path.join(__dirname, '../src/lib/supabase/env.ts');
const source = fs.readFileSync(filename, 'utf8');
const expected = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};
const previous = Object.fromEntries(Object.keys(expected).map((key) => [key, process.env[key]]));
try {
  Object.assign(process.env, expected);
  // Run the real Expo compiler, then evaluate with an empty browser environment.
  // Dynamic process.env[name] passes TypeScript but fails this bundle check.
  for (const platform of ['web', 'android', 'ios']) {
    const { code } = babel.transformSync(source, {
      filename, configFile: false, babelrc: false,
      presets: [['babel-preset-expo', { enableBabelRuntime: false }]],
      caller: { name: 'metro', platform, isDev: false, isServer: false },
    });
    const exports = {};
    vm.runInNewContext(code, { exports, process: { env: {} } });
    const config = exports.getSupabaseEnv();
    assert.equal(config.url, expected.EXPO_PUBLIC_SUPABASE_URL);
    assert.equal(config.publishableKey, expected.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  }
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function loadStorage(globals) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/supabase/storage.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, ...globals });
  return exports.authStorage;
}
assert.equal(loadStorage({}), undefined, 'Static rendering must not access window or SQLite');
const localStorage = { getItem() {}, setItem() {}, removeItem() {} };
assert.equal(loadStorage({ window: { localStorage } }), localStorage, 'Web sessions use browser storage');
console.log('Runtime config checks passed: Expo env inlining on web/iOS/Android and web/static-render storage.');
