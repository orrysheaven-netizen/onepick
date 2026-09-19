// Writing/copy contract checks, not proof of semantic quality of model outputs.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function load(relative) {
  const source = readFileSync(path.join(root, relative), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const local = { exports: {} };
  new Function('module', 'exports', compiled)(local, local.exports);
  return local.exports;
}
const { TASTE_INSTRUCTIONS, assertNoAgeComment } = load('supabase/functions/analyze-profile-taste/quality.ts');
const { qualityCases } = load('supabase/functions/analyze-profile-taste/quality.examples.ts');
const { PROFILE_AI_PICK_GUIDANCE } = load('mobile/src/lib/profileAiCopy.ts');
const card = readFileSync(path.join(root, 'mobile/src/components/profile-ai-review-card.tsx'), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
test('helper copy encourages selections and specific reasons without accuracy promises', () => {
  assert.equal(PROFILE_AI_PICK_GUIDANCE,
    '원픽이 많고 한줄평이 구체적일수록 취향의 공통점을 더 잘 발견할 수 있어요.');
  assert.doesNotMatch(PROFILE_AI_PICK_GUIDANCE, /정확한 성격|반드시|무조건|완벽/);
});
test('card uses shared helper in both owner-facing paths', () => {
  assert.match(card, /import \{ PROFILE_AI_PICK_GUIDANCE \} from '@\/lib\/profileAiCopy'/);
  assert.equal((card.match(/\{PROFILE_AI_PICK_GUIDANCE\}/g) || []).length, 2);
  const empty = card.slice(card.indexOf('if (!review) {'), card.indexOf('if (!isMine &&'));
  assert.match(empty, /if \(!isMine\) return null/);
  assert.match(empty, /\{PROFILE_AI_PICK_GUIDANCE\}/);
  const actions = card.slice(card.indexOf('{isMine ? <View style={styles.actions}>'));
  assert.match(actions, /\{PROFILE_AI_PICK_GUIDANCE\}/);
});
test('prompt prohibits aggressive negative and backhanded appraisals', () => {
  for (const phrase of ['공격하거나 부정적으로 평가하지', '비난, 조롱, 비꼼, 냉소', '칭찬으로 포장한 비하', '우열을 가리지']) {
    assert.ok(TASTE_INSTRUCTIONS.includes(phrase), phrase);
  }
});
test('scarce reasons get guidance not a negative label', () => {
  assert.ok(TASTE_INSTRUCTIONS.includes('부족하거나 성의 없다고 평가하지'));
  assert.ok(TASTE_INSTRUCTIONS.includes('한 가지씩 더해주면'));
  const sample = qualityCases.find((entry) => entry.id === 'sparse-reasons');
  assert.ok(sample);
  assert.match(sample.reference.body, /한 가지씩 더해주면/);
  assert.doesNotMatch(sample.reference.body, /부족|성의|어려워|판단할 수 없|취향이 없/);
});
test('kindness preserves grounding and does not endorse unsafe choices', () => {
  for (const phrase of ['근거 없는 칭찬', '만들어내지는 마세요', '위험하거나 부적절한 선택을 칭찬·정당화·권유하지']) {
    assert.ok(TASTE_INSTRUCTIONS.includes(phrase), phrase);
  }
});
test('humor targets combinations not the person', () => {
  assert.ok(TASTE_INSTRUCTIONS.includes('웃음의 대상은 사람이 아니라 선택의 즐거운 조합'));
  assert.ok(TASTE_INSTRUCTIONS.includes('비꼼으로 읽힐 여지가 있으면'));
  assert.ok(TASTE_INSTRUCTIONS.includes('기계적으로 반복하지'));
});
test('all six editorial references remain age-free and avoid checked pejoratives', () => {
  assert.equal(qualityCases.length, 6);
  for (const sample of qualityCases) {
    assertNoAgeComment(sample.reference);
    assert.doesNotMatch(JSON.stringify(sample.reference), /수준이 낮|유행만 따|고집이 세|성의 없|취향이 없|까다롭/);
  }
});
test('age reference year is removed and generated output is checked before save', () => {
  const handler = readFileSync(path.join(root, 'supabase/functions/analyze-profile-taste/index.ts'), 'utf8');
  assert.doesNotMatch(handler, /referenceYear/);
  const guard = handler.indexOf('assertNoAgeComment(generated)');
  const save = handler.indexOf("admin.rpc('save_profile_ai_review'");
  assert.ok(guard >= 0 && save > guard);
});
console.log(`${passed} AI voice/copy contract checks passed. No network or model generation performed.`);
