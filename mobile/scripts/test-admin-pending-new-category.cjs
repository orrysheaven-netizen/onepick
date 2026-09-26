const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, sandbox = {}) {
  const exported = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: exported, ...sandbox });
  return exported;
}

// Parent choices: only nodes whose new pickable child is selectable at once.
const tree = load('../src/lib/categories/categoryTree.ts');
const node = (id, parentId, extra = {}) => ({
  id, parentId, name: id, slug: id, status: 'open', isVisible: true, isPickable: false,
  rankingMinSample: 1, sortOrder: 0, imageUrl: null, createdAt: '', updatedAt: '', ...extra,
});
const rows = [
  node('food', null),
  node('market', 'food'),
  node('kimchi', 'market', { isPickable: true }),
  node('third', 'market'),
  node('draft', 'food', { status: 'draft' }),
  node('hidden', null, { isVisible: false }),
  node('under-hidden', 'hidden'),
  node('leaf-root', null, { isPickable: true }),
];
const parents = tree.newLeafParentCategories(rows).map((category) => category.id).sort();
assert.deepEqual(parents, ['food', 'market'], 'Only open, visible, non-pickable nodes at depth 1-2 with a clean lineage can take a new leaf');
const withChild = [...rows, node('new', 'market', { isPickable: true })];
assert.ok(tree.selectableCategories(withChild).some((category) => category.id === 'new'), 'A new leaf under an allowed parent is selectable');

// createCategory: draft by default, open pickable leaf for the review flow.
const calls = [];
const api = load('../src/lib/admin-api.ts', {
  fetch: async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { status: 201, ok: true, json: async () => [{ id: 'new' }] };
  },
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
});

(async () => {
  await api.createCategory({ name: '김치', slug: 'kimchi', parentId: 'market' });
  assert.equal(calls[0].body.status, 'draft', 'Categories panel still creates drafts');
  assert.equal(calls[0].body.is_pickable, false);
  await api.createCategory({ name: '김치', slug: 'kimchi', parentId: 'market', openLeaf: true });
  assert.deepEqual(
    { status: calls[1].body.status, visible: calls[1].body.is_visible, pickable: calls[1].body.is_pickable, parent: calls[1].body.parent_id },
    { status: 'open', visible: true, pickable: true, parent: 'market' },
    'Review creates an open, visible, pickable leaf',
  );

  const panel = fs.readFileSync(path.join(__dirname, '../src/components/admin/data/pending-panel.tsx'), 'utf8');
  assert.match(panel, /createCategory\(\{ name, slug: newCategorySlug\.trim\(\), parentId: newCategoryParent\.id, openLeaf: true \}\)/, 'Pending review creates an open leaf');
  assert.match(panel, /newLeafParentCategories\(domainCategories\)/, 'Parents are limited to ones that keep the new leaf selectable');
  assert.match(panel, /createdCategoryId\.current = created\.id/, 'The new category is selected after the reload');
  assert.match(panel, /visibleReviewCategories\.length === 0\) \|\| suggestion\?\.needs_new_category/, 'Create is offered when search finds nothing or AI asks for a new category');
  assert.match(panel, /styles\.itemThumb/, 'List rows show a photo thumbnail');
  assert.match(panel, /itemPhotoUrl\(selected\.image_path \?\? selected\.thumbnail_path\)/, 'The large preview prefers the original photo');
  console.log('Admin pending new category passed: parent rules, open-leaf create, auto-select and photo previews.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
