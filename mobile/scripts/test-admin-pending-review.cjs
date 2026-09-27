const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadAdminApi(fetchImpl) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/admin-api.ts'), 'utf8');
  const exportsObject = {};
  const sandbox = {
    exports: exportsObject,
    fetch: fetchImpl,
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' } },
    globalThis: {},
    URLSearchParams,
    JSON,
    require: (name) => {
      if (name === '@/lib/supabase/client') return { supabase: {} };
      if (name === '@/lib/items/itemIdentity') return { canonicalItemName: (value) => value };
      if (name === '@/lib/items/pickChannel') return require('./pick-channel.cjs');
      if (name === '@/lib/admin/adminSession') return { getAdminAccessToken: async () => 'token' };
      throw new Error('Unexpected dependency: ' + name);
    },
  };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, sandbox);
  return exportsObject;
}

async function main() {
  const calls = [];
  const api = loadAdminApi(async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return { status: 200, ok: true, json: async () => ({ id: 'item', status: 'active' }) };
  });

  await api.updatePendingItem('item', 'active', 'leaf-category');
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/admin_review_pending_item$/);
  assert.deepEqual(calls[0].body, { p_item_id: 'item', p_status: 'active', p_category_id: 'leaf-category' });

  await api.updatePendingItem('item', 'rejected', 'leaf-category', '  중복 상품  ');
  assert.equal(calls[1].body.p_category_id, null, 'Rejection never carries a category');
  assert.equal(calls[1].body.p_reject_reason, '중복 상품', 'Rejection sends the trimmed reason');

  await api.getPendingItemCategorySuggestion('item');
  assert.match(calls[2].url, /\/rest\/v1\/rpc\/admin_item_category_suggestion$/);
  assert.deepEqual(calls[2].body, { p_item_id: 'item' });

  const panel = fs.readFileSync(path.join(__dirname, '../src/components/admin/data/pending-panel.tsx'), 'utf8');
  assert.match(panel, /getPendingItemCategorySuggestion\(selected\.id\)/, 'Panel loads the AI suggestion for the selected item');
  assert.match(panel, /if \(ownCategoryIsSelectable \|\| !result\) return;/, 'Existing leaf category wins over AI suggestion');
  assert.match(panel, /confidenceRank\(b\.confidence\) - confidenceRank\(a\.confidence\)/, 'Strongest suggestion becomes the default');
  assert.match(panel, /reviewCategories\.some\(\(category\) => category\.id === entry\.categoryId\)/, 'Only selectable leaves can be applied');
  assert.match(panel, /accessibilityLabel="카테고리 검색"/, 'Leaf categories are searchable');
  assert.match(panel, /CATEGORY_NOT_PICKABLE/, 'RPC category errors are translated for the admin');
  assert.match(panel, /needs_new_category/, 'AI can explicitly flag that a new category may be needed');
  assert.doesNotMatch(panel, /window\.confirm\(`[^`]*반려/,'Rejection asks for a reason instead of a bare confirm');
  assert.match(panel, /accessibilityLabel="반려 사유"/, 'Admins can type a rejection reason');
  assert.match(panel, /maxLength=\{REJECT_REASON_MAX_LENGTH\}/, 'The reason input stops at the server limit');
  assert.match(panel, /const canReject = !busy && Boolean\(rejectReason\.trim\(\)\);/, 'Reject is disabled without a non-blank reason');
  assert.match(panel, /REJECT_REASON_INVALID/, 'Reason errors are translated for the admin');

  console.log('Admin pending review passed: AI suggestion, category payload, searchable leaves and translated RPC errors and required rejection reasons.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
