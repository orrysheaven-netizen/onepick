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
    if (name === '@/lib/items/pickChannel') return require('./pick-channel.cjs');
    if (name === '@/lib/admin/adminSession') return { getAdminAccessToken: async () => 'admin-token' };
    throw new Error(name);
  },
});

(async () => {
  await moduleExports.getEditorialFeatures();
  assert.match(calls[0].url, /item_editorial_features/);
  assert.match(calls[0].url, /items\(id,name,status,category_id,image_path,thumbnail_path,image_source_url,categories\(name\)\)/);

  await moduleExports.getEditorialCandidates('김치');
  assert.match(calls[1].url, /items\?/);
  assert.match(decodeURIComponent(calls[1].url), /status\.eq\.active,status\.eq\.discontinued/);
  assert.match(decodeURIComponent(calls[1].url), /name=ilike\.\*김치\*/);
  assert.match(decodeURIComponent(calls[1].url), /thumbnail_path/);
  assert.match(decodeURIComponent(calls[1].url), /image_source_url/);

  await moduleExports.setItemEditorialFeature({ itemId:'item', isActive:true, priority:20, note:'먼저 소개' });
  assert.match(calls[2].url, /rpc\/admin_set_item_editorial_feature/);
  const body = JSON.parse(calls[2].init.body);
  assert.deepEqual(body, { p_item_id:'item', p_is_active:true, p_priority:20, p_note:'먼저 소개' });
  assert.equal(calls[2].init.method, 'POST');

  await moduleExports.setItemEditorialFeature({
    itemId:'item', isActive:true, priority:10, note:'순서 유지',
    startsAt:'2026-09-20T00:00:00Z', endsAt:'2026-10-01T00:00:00Z',
  });
  const scheduledBody = JSON.parse(calls[3].init.body);
  assert.equal(scheduledBody.p_starts_at, '2026-09-20T00:00:00Z');
  assert.equal(scheduledBody.p_ends_at, '2026-10-01T00:00:00Z');

  // 홈 추천 is a tab of the admin 데이터 관리 page (/admin/data?tab=editorial).
  const nav = fs.readFileSync(path.join(__dirname, '../src/lib/admin/dataTabs.ts'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../src/components/admin/data/editorial-panel.tsx'), 'utf8');
  assert.match(nav, /key: 'editorial', label: '홈 추천'/);
  assert.match(nav, /사용자 추천 수·인기 순위와는 별도/);
  assert.match(page, /홈 추천에 추가/);
  assert.match(page, /초기 추천 준비도/);
  assert.match(page, /권장 4~6개/);
  assert.match(page, /대표 이미지/);
  assert.match(page, /위로 이동/);
  assert.match(page, /아래로 이동/);
  console.log('Admin editorial checks passed: searchable candidates, readiness checklist, ordering, image signals, schedule preservation and ranking separation.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
