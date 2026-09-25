const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function load(relativePath, sandbox, dependencies) {
  const exportsObject = {};
  vm.runInNewContext(ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    ...sandbox,
    exports: exportsObject,
    require: (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error('Unexpected dependency: ' + name);
    },
  });
  return exportsObject;
}

async function main() {
  const calls = [];
  const api = load('src/lib/admin-api.ts', {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ database_bytes: 1 }) };
    },
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' } },
    globalThis: {},
    URLSearchParams,
    JSON,
  }, {
    '@/lib/supabase/client': { supabase: {} },
    '@/lib/items/itemIdentity': { canonicalItemName: (value) => value },
    '@/lib/admin/adminSession': { getAdminAccessToken: async () => 'token' },
  });
  await api.getDatabaseUsage();
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/admin_database_usage$/);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer token', 'Usage is read with the admin (AAL2) session');

  const card = load('src/components/admin/database-usage-card.tsx', {}, {
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: 'Fragment' },
    react: { useCallback: (fn) => fn, useEffect: () => {}, useState: (value) => [value, () => {}] },
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', StyleSheet: { create: (styles) => styles }, Text: 'Text', View: 'View' },
    '@/components/admin/admin-shell': { adminStyles: {} },
    '@/lib/admin-api': api,
    '@/constants/onepick': { OnePick: {} },
  });
  assert.equal(card.formatBytes(512), '512B');
  assert.equal(card.formatBytes(1536), '1.5KB');
  assert.equal(card.formatBytes(12 * 1024 * 1024), '12.0MB');
  assert.equal(card.formatBytes(500 * 1024 * 1024), '500MB');
  assert.equal(card.formatBytes(1024 * 1024 * 1024), '1.0GB');

  const source = read('src/components/admin/database-usage-card.tsx');
  assert.match(source, /DATABASE_LIMIT_BYTES = 500 \* 1024 \* 1024/);
  assert.match(source, /STORAGE_LIMIT_BYTES = 1024 \* 1024 \* 1024/);
  assert.match(source, /Free 플랜 한도/, 'The bars say which plan limit they compare against');
  assert.match(read('src/app/admin/dashboard.tsx'), /<DatabaseUsageCard \/>/, 'The dashboard shows the usage card');

  console.log('Admin database usage checks passed: AAL2 RPC call, byte formatting, plan-limit labelling and dashboard placement.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
