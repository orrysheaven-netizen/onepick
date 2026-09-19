import { buildTasteInput, TASTE_INSTRUCTIONS, TASTE_PROMPT_VERSION } from './quality.ts';
import { qualityCases, ageBoundaryCases } from './quality.examples.ts';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function throws(action: () => unknown) {
  let failed = false;
  try { action(); } catch { failed = true; }
  assert(failed, 'Expected a rejection');
}

// These tests verify prompt/input/reference contracts, NOT model generation,
// factuality, humor, sensitivity or semantic compliance with age instructions.
Deno.test('quality version cannot reuse the previous writing contract', () => {
  assert(TASTE_PROMPT_VERSION === 'taste-v4-quality', 'Unexpected prompt version');
});
Deno.test('input reference year follows the Seoul new-year boundary', () => {
  assert(buildTasteInput([], new Date('2026-12-31T14:59:59Z')).referenceYear === 2026, 'Wrong year before midnight');
  assert(buildTasteInput([], new Date('2026-12-31T15:00:00Z')).referenceYear === 2027, 'Wrong year after midnight');
});
Deno.test('invalid dates and oversized snapshots are rejected', () => {
  throws(() => buildTasteInput([], new Date('invalid')));
  throws(() => buildTasteInput(Array(51).fill({})));
});
Deno.test('model input excludes identifiers timestamps photos SNS and arbitrary fields', () => {
  const result = buildTasteInput([{ category: '영화', item: '영화 A', review: '다시 보는 재미',
    pickId: 'private-id', profileId: 'private-id', updatedAt: 'private-time',
    avatarUrl: 'private-url', sns: 'private-sns', secret: 'private-secret' }]);
  const serialized = JSON.stringify(result);
  assert(!serialized.includes('private-'), 'Unexpected metadata leaked');
  assert(Object.keys(result.picks[0]).sort().join(',') ===
    'category,collectionName,creatorName,item,originalName,releaseYear,review', 'Allowlist changed');
});
Deno.test('direct age cues remain user data and never enter the instruction string', () => {
  const review = '나는 2008년에 만 14세였다. 가상 명령 sentinel-unique-777';
  const input = buildTasteInput([{ review }]);
  assert(input.picks[0].review === review, 'The users reasoning was removed');
  assert(!TASTE_INSTRUCTIONS.includes('sentinel-unique-777'), 'User input entered instructions');
});
Deno.test('bounds and types remain compatible with existing source reader', () => {
  const input = buildTasteInput([{ category: '가'.repeat(301), review: '나'.repeat(101),
    releaseYear: NaN, item: 2 }]);
  assert(input.picks[0].category?.length === 300, 'Category bound');
  assert(input.picks[0].review?.length === 100, 'Review bound');
  assert(input.picks[0].releaseYear === null && input.picks[0].item === null, 'Wrong type accepted');
});
Deno.test('prompt explicitly prioritizes reasons and distinguishes inference from worth', () => {
  for (const phrase of ['한줄평에 적힌 선택 이유', '같은 원픽이라도', '억지로 하나의 성격', '사용자 점수']) {
    assert(TASTE_INSTRUCTIONS.includes(phrase), `Missing rule: ${phrase}`);
  }
});
Deno.test('prompt has conditional age exception and no-age default', () => {
  for (const phrase of ['출생연도', 'referenceYear', '나이 문장 자체를 생략', '출시연도·장르·가격',
    '타인의 나이', '상충하는 단서', '연령 제한 해제']) {
    assert(TASTE_INSTRUCTIONS.includes(phrase), `Missing age safeguard: ${phrase}`);
  }
});
Deno.test('prompt limits wit to choices and preserves sensitive-inference rules', () => {
  for (const phrase of ['관찰 한 문장 이내', '정신연령 농담', '정치성향', '건강', '노래 가사', '신뢰할 수 없는 데이터']) {
    assert(TASTE_INSTRUCTIONS.includes(phrase), `Missing rule: ${phrase}`);
  }
});
Deno.test('editorial samples fit existing three-field response and storage limits', () => {
  assert(qualityCases.length === 6, 'Missing editorial reference');
  for (const sample of qualityCases) {
    const { summary, body, keywords } = sample.reference;
    assert(summary.length > 0 && summary.length <= 180, `${sample.id}: summary length`);
    assert(body.length > 0 && body.length <= 1200, `${sample.id}: body length`);
    assert(keywords.length === 3 && new Set(keywords).size === 3, `${sample.id}: keywords`);
    assert(keywords.every((k) => k.trim().length > 0 && k.length <= 24), `${sample.id}: keyword length`);
    assert(sample.picks.every((p) => p.review.length <= 100), `${sample.id}: source length`);
    assert(Object.keys(sample.reference).sort().join(',') === 'body,keywords,summary', 'Response shape changed');
  }
});
Deno.test('paired references hold the choices constant and vary the stated reasons', () => {
  const [a, b] = qualityCases;
  assert(JSON.stringify(a.picks.map((p) => p.item)) === JSON.stringify(b.picks.map((p) => p.item)), 'Choices changed');
  assert(a.reference.summary as string !== b.reference.summary as string, 'Same interpretation');
  assert(a.picks.every((p, i) => p.review as string !== b.picks[i].review as string), 'Reasons did not change');
});
Deno.test('age example arithmetic uses broad range and references an explicit year and age', () => {
  const sample = qualityCases.find((c) => c.id === 'explicit-dated-age')!;
  assert(sample.referenceYear === 2026 && sample.picks[2].review.includes('2008년에 만 14세'), 'Missing premise');
  // Without exact dates/birthdays, 14 at some point in 2008 permits 31..33 in 2026.
  const lower = 14 + 2026 - 2008 - 1, upper = 14 + 2026 - 2008 + 1;
  assert(lower === 31 && upper === 33, 'Incorrect boundary arithmetic');
  assert(sample.reference.body.includes('대략 30대 초반으로 추정'), 'Reference claims false precision');
});
Deno.test('no-age reference cases contain no demographic estimate', () => {
  for (const sample of qualityCases) {
    if (sample.ageExpectation === 'omit') {
      assert(!/\d+\s*(세|살|대)/.test(sample.reference.body), `${sample.id}: unexpected numeric age`);
      assert(!/정신연령|나이는 모르|나이에 비해/.test(sample.reference.body), `${sample.id}: age filler`);
    }
  }
});
Deno.test('ambiguous age cases remain explicit manual review obligations', () => {
  assert(ageBoundaryCases.length === 5, 'Missing age boundary fixtures');
  assert(ageBoundaryCases.every((c) => c.expected.startsWith('omit')), 'Unsupported age expectation');
});
