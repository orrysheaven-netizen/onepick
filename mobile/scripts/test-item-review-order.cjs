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
  let current = mine, fetchedMine = 0;
  const service = new exportsObject.ItemService(
    { getById: async () => item }, { getCurrentPick: async () => current },
    { getById: async () => ({ id: 'category' }), getOpenCategories: async () => [{ id: 'category' }] },
    {
      getPicks: async () => [...others, entry(mine)], // Defensive duplicate removal even if an adapter returns self.
      getPickById: async () => { fetchedMine++; return entry(mine); },
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
  console.log('Item review ordering passed: my current choice first, no duplicates, others retain order, former choice and visitor states.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
