const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name) => { assert.ok(name in imports, `Unexpected import: ${name}`); return imports[name]; } });
  return exports;
}
// Objects built inside the vm realm fail deepEqual against this realm's arrays.
const plain = (value) => JSON.parse(JSON.stringify(value));
const entries = (map) => plain(Array.from(map.entries()));

async function main() {
  const { fetchItemChannels } = load('repositories/supabase/itemChannels.ts');
  let requests = [], response = { data: [], error: null }, throwing = null;
  const client = {
    from(table) {
      const request = { table };
      requests.push(request);
      if (throwing) throw throwing;
      return {
        select(columns) {
          request.columns = columns;
          return { in: async (column, ids) => { request.column = column; request.ids = plain(ids); return response; } };
        },
      };
    },
  };

  const none = await fetchItemChannels(client, []);
  assert.equal(none.size, 0);
  assert.equal(requests.length, 0, 'No item ids means no item_channels request');

  response = { data: [
    { item_id: 'a', channel: 'offline' },
    { item_id: 'a', channel: 'online' },
    { item_id: 'a', channel: 'offline' },
    { item_id: 'b', channel: 'delivery' },
    { item_id: 'b', channel: null },
    { item_id: 'c', channel: 'online' },
  ], error: null };
  const channels = await fetchItemChannels(client, ['a', 'b', 'a', 'c', 'c']);
  assert.equal(requests.length, 1, 'All ids are read in one request');
  assert.deepEqual(plain(requests[0]), { table: 'item_channels', columns: 'item_id, channel, is_primary', column: 'item_id', ids: ['a', 'b', 'c'] },
    'Queries item_channels by deduplicated item ids');
  assert.deepEqual(entries(channels), [['a', ['offline', 'online']], ['c', ['online']]],
    'Multiple channels group per item without duplicates; unknown channel values are ignored');
  assert.equal(channels.has('b'), false, 'Items with only unknown channels get no entry');

  response = { data: null, error: { message: 'permission denied' } };
  assert.equal((await fetchItemChannels(client, ['a'])).size, 0, 'A Supabase error degrades to no labels');

  response = { data: { item_id: 'a', channel: 'offline' }, error: null };
  assert.equal((await fetchItemChannels(client, ['a'])).size, 0, 'A non-array payload degrades to no labels');

  throwing = new Error('offline');
  const before = requests.length;
  assert.equal((await fetchItemChannels(client, ['a'])).size, 0, 'A thrown client error degrades to no labels');
  assert.equal(requests.length, before + 1);

  console.log('Item channel label checks passed: id dedup, no empty request, per-item grouping, unknown values ignored, error/throw fallback and item_channels query shape.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
