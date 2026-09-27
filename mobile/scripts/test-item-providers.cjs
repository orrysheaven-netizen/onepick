const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function load(relative) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    require: (name) => assert.fail('Unexpected import: ' + name),
  });
  return exports;
}

async function main() {
  const { fetchItemProviderIds } = load('repositories/supabase/itemProviders.ts');
  let selected = null;
  const query = {
    select: (columns) => { selected = columns; return query; },
    in: async (column, ids) => {
      assert.equal(column, 'item_id');
      assert.deepEqual(Array.from(ids), ['item-a', 'item-b']);
      return { data: [
        { item_id: 'item-a', provider_id: 'provider-a' },
        { item_id: 'item-b', provider_id: 'provider-b' },
      ], error: null };
    },
  };
  const client = { from: (table) => { assert.equal(table, 'item_providers'); return query; } };
  const result = await fetchItemProviderIds(client, ['item-a', 'item-b', 'item-a']);
  assert.equal(selected, 'item_id, provider_id');
  assert.equal(result.get('item-a'), 'provider-a');
  assert.equal(result.get('item-b'), 'provider-b');

  const failed = await fetchItemProviderIds({ from: () => ({ select: () => ({ in: async () => ({ data: null, error: new Error('offline') }) }) }) }, ['item-a']);
  assert.equal(failed.size, 0, 'provider lookup is enhancement-only and degrades to no link');
  assert.equal((await fetchItemProviderIds(client, [])).size, 0, 'empty item input performs no query');

  console.log('Item provider lookup checks passed: batching, dedupe, mapping and graceful fallback.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
