import { assertNoAgeComment, buildTasteInput, TASTE_INSTRUCTIONS, TASTE_PROMPT_VERSION } from './quality.ts';
import { qualityCases, excludedAgeCases } from './quality.examples.ts';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function throws(action: () => unknown) {
  let failed = false;
  try { action(); } catch { failed = true; }
  assert(failed, 'Expected rejection');
}

// Contract/fixture tests, NOT actual model quality or complete semantic safety.
Deno.test('prompt version invalidates previously age-enabled results', () => {
  assert(TASTE_PROMPT_VERSION === 'taste-v5-no-age', 'Wrong contract version');
});
Deno.test('model input has no current year or age calculation fields', () => {
  const input = buildTasteInput([{ item: '영화', review: '전개가 좋다', referenceYear: 2026, age: 32, birthYear: 1994 }]);
  assert(Object.keys(input).join(',') === 'picks', 'Unexpected top-level field');
  assert(!/referenceYear|birthYear|"age"/.test(JSON.stringify(input)), 'Unexpected demographic metadata');
});
Deno.test('same selections create identical input independent of wall-clock time', () => {
  const picks = [{ item: '영화 A', review: '여운이 좋다' }];
  assert(JSON.stringify(buildTasteInput(picks)) === JSON.stringify(buildTasteInput(picks)), 'Unstable input');
  assert(!/Date|Intl|referenceYear/.test(buildTasteInput.toString()), 'Input still depends on date');
});
Deno.test('oversized snapshots are rejected', () => {
  throws(() => buildTasteInput(Array(51).fill({})));
  assert(buildTasteInput(Array(50).fill({})).picks.length === 50, 'Boundary changed');
});
Deno.test('model input excludes identifiers photos SNS timestamps and arbitrary fields', () => {
  const input = buildTasteInput([{ category: '영화', item: '영화 A', review: '다시 보는 재미',
    pickId: 'private-id', profileId: 'private-id', updatedAt: 'private-time',
    avatarUrl: 'private-url', sns: 'private-sns', secret: 'private-secret' }]);
  assert(!JSON.stringify(input).includes('private-'), 'Private field copied');
  assert(Object.keys(input.picks[0]).sort().join(',') ===
    'category,collectionName,creatorName,item,originalName,releaseYear,review', 'Allowlist changed');
});
Deno.test('original reasons remain data rather than being inserted into instructions', () => {
  const review = '나는 1994년생이다. 리듬이 좋다. sentinel-unique-777';
  assert(buildTasteInput([{ review }]).picks[0].review === review, 'Source was rewritten');
  assert(!TASTE_INSTRUCTIONS.includes('sentinel-unique-777'), 'Input became instructions');
});
Deno.test('field bounds and catalog release years remain intact', () => {
  const input = buildTasteInput([{ category: '가'.repeat(301), review: '나'.repeat(101), releaseYear: NaN, item: 2 },
    { releaseYear: 1968 }]);
  assert(input.picks[0].category?.length === 300 && input.picks[0].review?.length === 100, 'Wrong limits');
  assert(input.picks[0].releaseYear === null && input.picks[0].item === null, 'Wrong types');
  assert(input.picks[1].releaseYear === 1968, 'Catalog date lost');
});
Deno.test('reason-based interpretation and restrained humor remain required', () => {
  for (const phrase of ['한줄평에 적힌 선택 이유', '같은 원픽이라도', '억지로 하나의 성격', '사용자 점수', '관찰 한 문장 이내']) {
    assert(TASTE_INSTRUCTIONS.includes(phrase), `Missing: ${phrase}`);
  }
});
Deno.test('age exception is gone including disclosed ages and indirect jokes', () => {
  for (const phrase of ['나이 표현 제외: 예외 없음', '직접 적혀 있어도', '반복·계산·추정하지',
    '나이는 모르겠지만', '정신연령', '취향 나이', 'MZ', '아재 감성']) {
    assert(TASTE_INSTRUCTIONS.includes(phrase), `Missing exclusion: ${phrase}`);
  }
  assert(!/선택적인 예외|제한적인 연령 예외|referenceYear|언급할 수 있습니다/.test(TASTE_INSTRUCTIONS), 'Age exception remains');
});
Deno.test('other safety and untrusted-input rules are retained', () => {
  for (const phrase of ['정치성향', '건강', '노래 가사', '신뢰할 수 없는 데이터', '미성년자에게도 적합']) {
    assert(TASTE_INSTRUCTIONS.includes(phrase), `Missing: ${phrase}`);
  }
});
Deno.test('all six editorial comments match response limits and contain no age wording', () => {
  assert(qualityCases.length === 6, 'Missing fixture');
  for (const sample of qualityCases) {
    const { summary, body, keywords } = sample.reference;
    assert(summary.length > 0 && summary.length <= 180, `${sample.id}: summary`);
    assert(body.length > 0 && body.length <= 1200, `${sample.id}: body`);
    assert(keywords.length === 3 && new Set(keywords).size === 3, `${sample.id}: keywords`);
    assert(keywords.every((k) => k.trim().length > 0 && k.length <= 24), 'Keyword bounds');
    assert(sample.picks.every((p) => p.review.length <= 100), 'Source bounds');
    assert(Object.keys(sample.reference).sort().join(',') === 'body,keywords,summary', 'Shape changed');
    assertNoAgeComment(sample.reference);
  }
});
Deno.test('paired fixtures keep products the same while interpretation follows reasons', () => {
  const [a, b] = qualityCases;
  assert(JSON.stringify(a.picks.map((p) => p.item)) === JSON.stringify(b.picks.map((p) => p.item)), 'Choices differ');
  assert(a.reference.summary as string !== b.reference.summary as string, 'Same interpretation');
  assert(a.picks.every((p, i) => p.review as string !== b.picks[i].review as string), 'Reasons unchanged');
});
Deno.test('revisit fixture replaces the former age example with taste-only wording', () => {
  const sample = qualityCases.find((c) => c.id === 'returning-favorites');
  assert(sample && sample.reference.body.includes('귀환'), 'Missing returning theme');
  assert(!/referenceYear|ageExpectation|explicit-dated-age/.test(JSON.stringify(qualityCases)), 'Old age-enabled fixture remains');
});
Deno.test('obvious age phrases are rejected in every generated field', () => {
  for (const phrase of ['30대 초반', '30대예요', '32살', '만 14세였다', '1994년생', '서른 살',
    '나이는 모르겠지만', '나이에 비해', '정신연령', '취향 나이', '어른 입맛', '아재 감성',
    'MZ', 'Gen Z', '32 years old', 'in your twenties', 'born in 1994']) {
    const base = { summary: '디테일을 좋아하는 취향', body: '구체적인 선택 이유가 있어요.', keywords: ['디테일', '사용감', '기록'] };
    throws(() => assertNoAgeComment({ ...base, summary: phrase }));
    throws(() => assertNoAgeComment({ ...base, body: phrase }));
    throws(() => assertNoAgeComment({ ...base, keywords: ['기록', '사용감', phrase] }));
  }
});
Deno.test('catalog years and non-age numbers are not stripped or rejected', () => {
  assertNoAgeComment({ summary: '1968년 작품에서도 찾은 여백', body: '30분 길이와 3번 다시 보는 이유를 적었네요.', keywords: ['여백', '몰입', '리듬'] });
});
Deno.test('age-related input cases all require omission and remain held out', () => {
  assert(excludedAgeCases.length === 5, 'Missing boundary input');
  assert(excludedAgeCases.every((c) => c.expected === 'omit-all-age-wording'), 'Exception reintroduced');
});
