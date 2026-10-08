// Home daily question: casual title above "당신의 {메뉴} 원픽은?" rotates through 10 templates by Korean date.
const assert = require('node:assert/strict');
const { load } = require('./mvp-screen-harness.cjs');

const mod = load('lib/home/questionTitle.ts');
const templates = Array.from(mod.HOME_QUESTION_TITLE_TEMPLATES);
let passed = 0;
function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }

test('10 casual templates, each with one menu slot and no middle dot', () => {
  assert.equal(templates.length, 10);
  assert.equal(new Set(templates).size, 10, 'No duplicates');
  for (const t of templates) {
    assert.equal(t.split('{menu}').length - 1, 1, `${t} has exactly one {menu}`);
    assert.doesNotMatch(t, /·/, 'OnePick copy avoids the middle dot');
  }
});

test('Menu name fills the slot', () => {
  const at = new Date('2026-10-08T03:00:00Z');
  const title = mod.homeQuestionTitle('곱창', at);
  assert.match(title, /곱창/);
  assert.doesNotMatch(title, /\{menu\}/);
  assert.ok(templates.map((t) => t.replace('{menu}', '곱창')).includes(title));
});

test('Same title all day in Korea time, changes at KST midnight', () => {
  // 2026-10-08 00:00 KST = 2026-10-07T15:00Z; 23:59 KST = 2026-10-08T14:59Z.
  const start = mod.homeQuestionTitle('곱창', new Date('2026-10-07T15:00:00Z'));
  const end = mod.homeQuestionTitle('곱창', new Date('2026-10-08T14:59:59Z'));
  const before = mod.homeQuestionTitle('곱창', new Date('2026-10-07T14:59:59Z'));
  const next = mod.homeQuestionTitle('곱창', new Date('2026-10-08T15:00:00Z'));
  assert.equal(start, end, 'One KST day keeps one title');
  assert.notEqual(before, start, 'Previous KST day differs');
  assert.notEqual(next, start, 'Next KST day differs');
});

test('10 consecutive days use every template once', () => {
  const seen = new Set();
  for (let d = 0; d < 10; d++) seen.add(mod.homeQuestionTitle('곱창', new Date(Date.UTC(2026, 9, 8 + d, 3))));
  assert.equal(seen.size, 10);
});

console.log(`\n${passed} home question title checks passed`);
