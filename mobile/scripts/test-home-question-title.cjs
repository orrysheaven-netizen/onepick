const assert = require('node:assert/strict');
const { load } = require('./mvp-screen-harness.cjs');
const { homeQuestionTitle, homeQuestionSubtitle } = load('lib/home/questionTitle.ts');
assert.equal(homeQuestionTitle(), '오늘의 원픽');
assert.equal(homeQuestionSubtitle('곱창', '오리'), '오리님, 곱창 먹으러 어디 가요?');
assert.equal(homeQuestionSubtitle('냉면', ' 오리 '), '오리님, 냉면 먹으러 어디 가요?');
for (const nickname of [undefined, null, '', '   ']) {
  assert.equal(homeQuestionSubtitle('곱창', nickname), '곱창 먹으러 어디 가요?');
}
assert.equal((homeQuestionSubtitle('곱창', '오리').match(/\?/g) ?? []).length, 1);
console.log('Home question copy checks passed: fixed title, nickname, menu, missing name, single question.');
