const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Admin review of a pending item must send the chosen category to the RPC:
// unclassified requests sit in the hidden pending-product category and
// admin_review_pending_item refuses to approve into it.
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

  await api.updatePendingItem('item', 'rejected', 'leaf-category');
  assert.equal(calls[1].body.p_category_id, null, 'Rejection never carries a category');

  await api.getPendingItemCategorySuggestion('item');
  assert.match(calls[2].url, /\/rest\/v1\/rpc\/admin_item_category_suggestion$/);
  assert.deepEqual(calls[2].body, { p_item_id: 'item' });

  // The approve/merge gating itself is covered by test-admin-pending-category-approval.cjs
  // (#183); this checks what the AI-suggestion layer adds on top of it.
  const panel = fs.readFileSync(path.join(__dirname, '../src/components/admin/data/pending-panel.tsx'), 'utf8');
  assert.match(panel, /getPendingItemCategorySuggestion\(selected\.id\)/, 'Panel loads the AI suggestion for the selected item');
  assert.match(panel, /if \(ownCategoryIsSelectable \|\| !result\) return;/, 'A request that already has a leaf category keeps it over the AI suggestion');
  assert.match(panel, /confidenceRank\(b\.confidence\) - confidenceRank\(a\.confidence\)/, 'Strongest suggestion becomes the default');
  assert.match(panel, /reviewCategories\.some\(\(category\) => category\.id === entry\.categoryId\)/, 'Only suggestions that are still selectable leaves are applied');
  assert.match(panel, /accessibilityLabel="카테고리 검색"/, 'Leaf categories are searchable');
  assert.match(panel, /CATEGORY_NOT_PICKABLE/, 'RPC category errors are translated for the admin');
  assert.match(panel, /from '@\/lib\/admin\/adminCategory'/, 'Panel shares the category converter with the items panel');

  console.log('Admin pending review passed: category payload on approve, suggestion RPC, AI default selection, searchable leaves and translated RPC errors.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
