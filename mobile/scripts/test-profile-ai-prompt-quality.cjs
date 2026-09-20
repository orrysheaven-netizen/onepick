const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.resolve(
  __dirname,
  '../../supabase/functions/analyze-profile-taste/quality.ts',
);
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(
  source,
  /TASTE_PROMPT_VERSION\s*=\s*['"]taste-v8-editorial-evidence['"]/,
  'AI taste prompt version must change when editorial rules change',
);

for (const phrase of [
  '같은 연결 어구나 사실상 같은 문장 시작 패턴을 두 번 이상 반복하지 마세요',
  '근거 나열 → 대비 나열 → 요약',
  '마지막 문장은 앞서 나온 근거를 단순히 다시 요약하지 마세요',
  '표면적인 해석',
  '더 정확하거나 의외의 관점',
  '서로 다른 원픽 최소 2개 이상에서 공통 근거',
  '특정 원픽 하나에만 해당하는',
  '5% 이하 또는 80% 이상',
  '중간값은 다른 원픽과 뚜렷한 대비',
  '전체 응답에서 최대 한 곳',
  '해당 픽의 위치를 설명하는 보조 신호',
]) {
  assert.ok(source.includes(phrase), `Missing AI taste quality rule: ${phrase}`);
}

assert.ok(
  !source.includes('근거가 있고 자연스러울 때 최대 한 곳에서만 선택의 맥락으로 짧게 녹여 쓰세요'),
  'Old vague popularity rule should not remain',
);

const keywordsLine = source
  .split('\n')
  .find((line) => line.startsWith('- keywords:'));
assert.ok(keywordsLine, 'keywords output rule must exist');
assert.ok(
  keywordsLine.includes('서로 다른 원픽 최소 2개 이상'),
  'keywords must require evidence from at least two different picks',
);

console.log('OnePick AI prompt quality contract: OK');
