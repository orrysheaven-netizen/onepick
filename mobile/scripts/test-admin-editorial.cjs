const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/admin-api.ts'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const calls = [];
const fetch = async (url, init = {}) => {
  calls.push({ url, init });
  return { status: 200, ok: true, json: async () => [] };
};
const moduleExports = {};
vm.runInNewContext(output, {
  exports: moduleExports, fetch, URL, URLSearchParams,
  process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key' } },
  globalThis: {},
  require: (name) => {
    if (name === '@/lib/supabase/client') return { supabase: {} };
    if (name === '@/lib/items/itemIdentity') return { canonicalItemName: (v) => v };
    if (name === '@/lib/admin/adminSession') return { getAdminAccessToken: async () => 'admin-token' };
    throw new Error(name);
  },
});

(async () => {
  await moduleExports.getEditorialFeatures();
  assert.match(calls[0].url, /item_editorial_features/);
  assert.match(calls[0].url, /items\(id,name,status,category_id,image_path,categories\(name\)\)/);

  await moduleExports.getEditorialCandidates('김치');
  assert.match(calls[1].url, /items\?/);
  assert.match(decodeURIComponent(calls[1].url), /status\.eq\.active,status\.eq\.discontinued/);
  assert.match(decodeURIComponent(calls[1].url), /name=ilike\.\*김치\*/);

  await moduleExports.setItemEditorialFeature({ itemId:'item', isActive:true, priority:20, note:'먼저 소개' });
  assert.match(calls[2].url, /rpc\/admin_set_item_editorial_feature/);
  const body = JSON.parse(calls[2].init.body);
  assert.deepEqual(body, { p_item_id:'item', p_is_active:true, p_priority:20, p_note:'먼저 소개' });
  assert.equal(calls[2].init.method, 'POST');

  const nav = fs.readFileSync(path.join(__dirname, '../src/components/admin/admin-shell.tsx'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../src/app/admin/editorial.tsx'), 'utf8');
  assert.match(nav, /\/admin\/editorial/);
  assert.match(page, /사용자 추천 수·인기 순위와는 별도/);
  assert.match(page, /홈 추천에 추가/);
  console.log('Admin editorial checks passed: searchable candidates, explicit curation, ranking separation and navigation.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
