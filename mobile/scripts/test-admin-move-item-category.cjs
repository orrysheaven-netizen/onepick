const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadApi(fetchFn) {
  const exported = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/admin-api.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: exported, fetch: fetchFn, URLSearchParams, JSON,
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk' } },
    require: (name) => {
      if (name === '@/lib/supabase/client') return { supabase: {} };
      if (name === '@/lib/items/itemIdentity') return { canonicalItemName: (value) => value };
      if (name === '@/lib/items/pickChannel') return require('./pick-channel.cjs');
      if (name === '@/lib/admin/adminSession') return { getAdminAccessToken: async () => 'aal2-token' };
      assert.fail(`Unexpected dependency: ${name}`);
    },
  });
  return exported;
}

(async () => {
  const calls = [];
  const preview = { item_id: 'item-1', from_category_id: 'dogani', to_category_id: 'haejang', active_pick_count: 1, pick_count: 2, conflict_count: 0, blocked_reason: null };
  const api = loadApi(async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    return { status: 200, ok: true, json: async () => preview };
  });

  assert.deepEqual(await api.previewItemCategoryMove('item-1', 'haejang'), preview);
  assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/rpc/admin_preview_item_category_move');
  assert.deepEqual(calls[0].body, { p_item_id: 'item-1', p_target_category_id: 'haejang' });
  assert.equal(calls[0].auth, 'Bearer aal2-token', 'The preview uses the MFA admin session');

  await api.moveItemCategory('item-1', 'haejang');
  assert.equal(calls[1].url, 'https://example.supabase.co/rest/v1/rpc/admin_move_item_category');
  assert.deepEqual(calls[1].body, { p_item_id: 'item-1', p_target_category_id: 'haejang' });

  const failing = loadApi(async () => ({ status: 400, ok: false, json: async () => ({ message: 'PICK_CONFLICT' }) }));
  await assert.rejects(() => failing.moveItemCategory('item-1', 'haejang'), /PICK_CONFLICT/, 'Server refusals surface their code for the panel to explain');

  // Every refusal the RPC can raise has an admin-facing explanation in the panel.
  const panel = fs.readFileSync(path.join(__dirname, '../src/components/admin/data/items-panel.tsx'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260927140000_add_admin_move_item_category.sql'), 'utf8');
  const reasons = [...migration.matchAll(/then '([A-Z_]+)'/g)].map((match) => match[1]);
  assert.ok(reasons.length >= 8, 'The migration lists its refusal reasons');
  for (const reason of [...reasons, 'ITEM_NOT_FOUND']) {
    assert.ok(panel.includes(`code.includes('${reason}')`), `${reason} has a message in the items panel`);
  }

  // The move section reports its own result; it must not also raise the generic "saved" banner.
  assert.ok(panel.includes('<CategoryMoveEditor item={item} onMoved={onMoved} />'), 'The move uses its own callback, not onSaved');
  const movedStart = panel.indexOf('onMoved={(next) => {');
  assert.ok(movedStart >= 0, 'The panel passes a move handler');
  const movedHandler = panel.slice(movedStart, panel.indexOf('onError={setError}', movedStart));
  assert.ok(movedHandler.includes('setItems('), 'A move refreshes the item list');
  assert.ok(!movedHandler.includes('setMessage('), 'A move does not show the generic save message');

  console.log('Admin item category move checks passed: RPC request shapes, MFA session, refusal messages, single move message.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
