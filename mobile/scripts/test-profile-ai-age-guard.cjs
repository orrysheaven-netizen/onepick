// Test the actual generated-output guard. No provider or catalog lookups.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const file = path.resolve(__dirname, '../../supabase/functions/analyze-profile-taste/quality.ts');
const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const local = { exports: {} };
new Function('module', 'exports', compiled)(local, local.exports);
const { assertNoAgeComment } = local.exports;
const base = { summary: '선택의 공통점', body: '좋아하는 이유를 함께 읽었어요.', keywords: ['선택', '기록', '취향'] };
const allowed = [
  '나이브스 아웃의 치밀한 전개를 골랐네요.',
  '미드나잇 인 파리의 분위기를 적었네요.',
  '나이키의 편안한 착용감을 적었네요.',
  '1968년 작품과 30분 콘텐츠를 골랐네요.',
  '3세대 컨트롤러의 손에 맞는 조작감을 적었네요.',
  '한살림 제품의 사용감을 골랐네요.',
  '나이트 모드의 화면을 좋아하네요.',
  '연세대학교 캠퍼스 사진의 구도를 골랐네요.',
  'New Age 음악의 여백을 적었네요.',
];
const denied = [
  '당신은 32살 같아요.', '만 14세였다', '서른 살', '서른두살 같아요.',
  '스물다섯 살', '열두 살', '스무살', '삼십대 취향', '이십 대 중반',
  '삼십이 세', '서른쯤으로 보여요.', '나이는 모르겠지만', '정신연령',
  '취향 나이', '1994년생', 'MZ감성', 'Gen Z', '당신은 새로운 세대군요.',
  '나이키를 고른 당신은 스물두 살 같아요.',
  '미드나잇 인 파리와 어울리는 30대예요.',
  '나\u200b이는 서른 살', '３２살', 'You are 32 years old.', 'born in 1994',
];
let passed = 0;
for (const phrase of allowed) {
  for (const comment of [{ ...base, summary: phrase }, { ...base, body: phrase }, { ...base, keywords: ['선택', '기록', phrase] }]) {
    assert.doesNotThrow(() => assertNoAgeComment(comment)); passed++;
  }
}
for (const phrase of denied) {
  for (const comment of [{ ...base, summary: phrase }, { ...base, body: phrase }, { ...base, keywords: ['선택', '기록', phrase] }]) {
    assert.throws(() => assertNoAgeComment(comment), /AI_REVIEW_AGE_EXCLUDED/); passed++;
  }
}
// Allowing a product in one field must not exempt a separate demographic keyword.
assert.throws(() => assertNoAgeComment({ ...base, summary: '나이키의 착용감', keywords: ['선택', '기록', '스물다섯 살'] }), /AI_REVIEW_AGE_EXCLUDED/);
passed++;
console.log(`${passed} age-guard field checks passed. Lexical checks do not certify every possible sentence.`);
