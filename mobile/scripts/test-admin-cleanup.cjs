const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function load(relativePath, fetchImpl, dependencies) {
  const exportsObject = {};
  vm.runInNewContext(ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: exportsObject,
    fetch: fetchImpl,
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' } },
    globalThis: {},
    URLSearchParams,
    JSON,
    require: (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error('Unexpected dependency: ' + name);
    },
  });
  return exportsObject;
}

const adminDependencies = {
  '@/lib/supabase/client': { supabase: {} },
  '@/lib/items/itemIdentity': { canonicalItemName: (value) => value },
  '@/lib/items/pickChannel': require('./pick-channel.cjs'),
  '@/lib/admin/adminSession': { getAdminAccessToken: async () => 'token' },
};

async function main() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'HEAD') {
      const total = url.includes('content_reports') ? 2 : 7;
      return { ok: true, status: 200, headers: { get: (name) => name === 'content-range' ? `*/${total}` : null } };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  // 1. Admin photo adoption goes through the AAL2-checked RPC with both paths.
  const api = load('src/lib/admin-api.ts', fetchImpl, adminDependencies);
  await api.replaceItemPhoto('item-1', 'admin/full.jpg', 'admin/thumb.jpg', 'https://shop.example/p.jpg');
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/admin_replace_item_photo$/);
  assert.equal(JSON.stringify(calls[0].body), JSON.stringify({
    p_item_id: 'item-1', p_image_path: 'admin/full.jpg', p_thumbnail_path: 'admin/thumb.jpg', p_image_source_url: 'https://shop.example/p.jpg',
  }));

  // 2. Sidebar queue badges count pending items and unresolved reports.
  calls.length = 0;
  const counts = await api.getAdminQueueCounts();
  assert.equal(JSON.stringify(counts), JSON.stringify({ pending: 7, reports: 2 }));
  assert.ok(calls.every((call) => call.method === 'HEAD' && call.headers.Prefer === 'count=exact'));
  assert.match(calls[0].url, /items\?select=id&status=eq\.pending$/);
  assert.match(calls[1].url, /content_reports\?select=id&status=in\.\(open,reviewing\)$/);

  // 3. User detail history is scoped to the selected user.
  calls.length = 0;
  await api.getUserReports('user-1');
  await api.getUserModerationHistory('user-1');
  assert.match(calls[0].url, /content_reports\?.*target_user_id=eq\.user-1/);
  assert.match(calls[1].url, /admin_audit_logs\?.*entity_type=eq\.user_moderation&entity_id=eq\.user-1/);

  // 4. The user directory filters, sorts and pages on the server.
  calls.length = 0;
  const moderation = load('src/lib/admin-moderation-api.ts', fetchImpl, adminDependencies);
  await moderation.getUserDirectory({ query: '  kim ', status: 'suspended', sort: 'activity', offset: 50 });
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/admin_user_directory$/);
  assert.equal(JSON.stringify(calls[0].body), JSON.stringify({ p_query: 'kim', p_status: 'suspended', p_sort: 'activity', p_limit: 50, p_offset: 50 }));

  const pending = read('src/components/admin/data/pending-panel.tsx');
  assert.match(pending, /if \(!keyword\) return \[\];/, 'Category chips are hidden until the admin searches');
  assert.match(pending, /slice\(0, CATEGORY_RESULT_LIMIT\)/, 'Category search results are capped');
  assert.match(pending, /사진 직접 올리기/, 'Items without a photo offer an admin upload');
  assert.match(pending, /saveItemPhoto\(itemId, photo\)/);
  assert.match(pending, /원본 링크에서 가져오기/, 'The request link can be used as the photo source');

  const photo = read('src/lib/admin/itemPhoto.ts');
  assert.match(photo, /photoRepository\.upload\(adminId, photo\)/, 'Admin uploads reuse the resized user upload path');
  assert.match(photo, /removeUnused\(\[uploaded\.imagePath, uploaded\.thumbnailPath\]\)/, 'Rejected adoption removes the uploaded files');

  const users = read('src/components/admin/data/users-panel.tsx');
  assert.doesNotMatch(users, /100건으로 제한/, 'The 100-row cap notice is gone');
  assert.match(users, /counts\?\.total/, 'Summary cards use server counts');
  assert.match(users, /await setUserSuspension[\s\S]*await load\(\)/, 'Suspension changes reload the server-filtered directory');
  assert.doesNotMatch(users, /setCounts\(\(current\)[\s\S]*suspended: current\.suspended/, 'Filtered counts are not patched locally after moderation');

  assert.match(read('src/app/admin/pending.tsx'), /<Redirect href="\/admin\/data\?tab=pending" \/>/, 'The legacy review route redirects to the tab');

  console.log('Admin cleanup checks passed: admin photo adoption, queue badges, user directory paging and history, category chip trimming and legacy redirect.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
