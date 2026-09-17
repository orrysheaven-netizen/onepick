const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/itemService.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject, require: () => ({ AppError: Error }) });

async function main() {
  const item = { id: 'item', categoryId: 'category', status: 'active' };
  const mine = { id: 'mine', itemId: 'item', userId: 'me', status: 'active', oneLineReview: 'My older review' };
  const entry = (pick) => ({ pick, profile: { id: pick.userId, username: pick.userId } });
  const others = Array.from({ length: 20 }, (_, i) => entry({ id: `other-${i}`, itemId: 'item', userId: `person-${i}`, status: 'active' }));
  let current = mine, fetchedMine = 0, focused = null;
  const service = new exportsObject.ItemService(
    { getById: async () => item }, { getCurrentPick: async () => current },
    { getById: async () => ({ id: 'category' }), getOpenCategories: async () => [{ id: 'category' }] },
    {
      getPicks: async () => [...others, entry(mine)], // Defensive duplicate removal even if an adapter returns self.
      getPickById: async (id) => { if (id !== mine.id) return focused; fetchedMine++; return entry(mine); },
    },
  );
  let result = await service.getItemDetail('item', 'me');
  assert.equal(result.picks[0].pick.id, 'mine', 'My older review stays first beyond the first 20 others');
  assert.equal(result.picks.filter((p) => p.pick.id === 'mine').length, 1);
  assert.equal(result.picks[0].isMine, true);
  assert.deepEqual(Array.from(result.picks.slice(1), (p) => p.pick.id), others.map((p) => p.pick.id));
  current = { ...mine, itemId: 'different-item' };
  result = await service.getItemDetail('item', 'me');
  assert.equal(result.picks.length, 20, 'A former choice does not pin or show my old review');
  assert.ok(result.picks.every((p) => !p.isMine));
  current = null;
  result = await service.getItemDetail('item', 'me');
  assert.equal(result.picks.length, 20);
  assert.equal(fetchedMine, 1, 'Only fetch a personal review for the currently selected item');
  result = await service.getItemDetail('item');
  assert.ok(result.picks.every((p) => !p.isMine), 'Visitors see a shared list without a personal pin');
  current = mine;
  focused = entry({ id: 'older', itemId: 'item', userId: 'friend', status: 'active' });
  result = await service.getItemDetail('item', 'me', 'older');
  assert.equal(result.picks[0].pick.id, 'mine');
  assert.equal(result.picks[1].pick.id, 'older', 'Shared review outside the first page remains reachable');
  assert.equal(result.focusAvailable, true);
  result = await service.getItemDetail('item', 'me', 'other-0');
  assert.equal(result.picks.filter((p) => p.pick.id === 'other-0').length, 1);
  focused.pick.status = 'replaced';
  result = await service.getItemDetail('item', 'me', 'older');
  assert.equal(result.picks[1].pick.status, 'replaced', 'Readable history retains its thread');
  for (const invalid of [null, entry({ id: 'older', itemId: 'different', status: 'active' }), entry({ id: 'older', itemId: 'item', status: 'hidden' })]) {
    focused = invalid;
    result = await service.getItemDetail('item', 'me', 'older');
    assert.equal(result.focusAvailable, false);
    assert.ok(!result.picks.some((p) => p.pick.id === 'older'));
  }
  console.log('Item reviews passed: own-first order, focused older review, history, deduplication, product isolation and unavailable links.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
