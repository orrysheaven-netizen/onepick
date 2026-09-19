// Fixture/shape/consistency checks only, never semantic approval of real AI text.
const assert = require('node:assert/strict');
const path = require('node:path');
const data = require(path.resolve(__dirname, '../../qa/profile-ai-quality-cases.cjs'));
assert.equal(data.synthetic, true);
assert.equal(data.modelOutputsMeasured, false);
assert.equal(data.minimumPicks, 10);
assert.equal(data.cases.length, 8);
assert.equal(new Set(data.cases.map((c) => c.id)).size, 8);
for (const c of data.cases) {
  assert.equal(c.picks.length, 10, c.id);
  assert.equal(new Set(c.picks.map((p) => p.category)).size, 10, c.id);
  assert.ok(c.expectations.length >= 2);
  for (const p of c.picks) {
    assert.deepEqual(Object.keys(p).sort(), ['category', 'item', 'review']);
    for (const key of ['category', 'item', 'review']) assert.ok(typeof p[key] === 'string' && p[key].trim());
    assert.ok(p.review.length <= 100);
    assert.ok(p.item.length <= 300 && p.category.length <= 300);
  }
  if (c.editorialReference) {
    const r = c.editorialReference;
    assert.deepEqual(Object.keys(r).sort(), ['body', 'keywords', 'summary']);
    assert.ok(r.summary.length <= 180 && r.body.length <= 1200);
    assert.equal(r.keywords.length, 3); assert.equal(new Set(r.keywords).size, 3);
    assert.ok(r.keywords.every((k) => k.length > 0 && k.length <= 24));
  }
}
const pair = data.cases.filter((c) => c.pair === 'same-items-different-reasons');
assert.equal(pair.length, 2);
assert.deepEqual(pair[0].picks.map((p) => [p.category, p.item]), pair[1].picks.map((p) => [p.category, p.item]));
assert.ok(pair[0].picks.every((p, i) => p.review !== pair[1].picks[i].review));
assert.notEqual(pair[0].editorialReference.summary, pair[1].editorialReference.summary);
console.log('Quality dataset: 8 synthetic cases, exactly 10 distinct-category picks each, bounded reasons and paired controls passed. Model quality NOT measured.');
