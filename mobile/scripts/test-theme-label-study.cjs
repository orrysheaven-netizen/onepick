const assert = require('node:assert/strict');

const study = require('./theme-label-study.cjs');

const labels = (entries) => new Map(Object.entries(entries));

function checkSampling() {
  const picks = [];
  for (let index = 0; index < 40; index++) {
    picks.push({
      id: `pick-${index}`, userId: `user-${index}`, username: `user${index}`,
      categoryId: `cat-${index % 4}`, category: `분야 ${index % 4}`, review: `이유 ${index}`,
    });
  }
  const sample = study.selectSample(picks, { size: 8, seed: 'fixed' });
  assert.equal(sample.length, 8);
  assert.equal(new Set(sample.map((row) => row.id)).size, 8, '같은 원픽을 두 번 뽑지 않는다');
  // 카테고리를 한 바퀴씩 돌기 때문에 4종이 고르게 두 번씩 들어온다.
  const perCategory = new Map();
  for (const row of sample) perCategory.set(row.categoryId, (perCategory.get(row.categoryId) ?? 0) + 1);
  assert.equal(perCategory.size, 4);
  assert.deepEqual([...perCategory.values()].sort(), [2, 2, 2, 2]);

  const repeat = study.selectSample(picks, { size: 8, seed: 'fixed' });
  assert.deepEqual(sample.map((row) => row.id), repeat.map((row) => row.id), '같은 시드는 같은 표본을 준다');
  const other = study.selectSample(picks, { size: 8, seed: 'other' });
  assert.notDeepEqual(sample.map((row) => row.id), other.map((row) => row.id), '다른 시드는 다른 표본을 준다');

  // 데모 계정과 빈 한줄평은 표본에 들어가지 않는다.
  const demoId = [...study.DEMO_USER_IDS][0];
  const mixed = [
    { id: 'demo-by-id', userId: demoId, username: 'moodarchive', categoryId: 'a', category: 'A', review: '데모' },
    { id: 'demo-by-name', userId: 'user-x', username: 'demo_tester', categoryId: 'b', category: 'B', review: '데모' },
    { id: 'blank', userId: 'user-y', username: 'real', categoryId: 'c', category: 'C', review: '   ' },
    { id: 'kept', userId: 'user-z', username: 'real2', categoryId: 'd', category: 'D', review: '진짜 이유' },
  ];
  assert.deepEqual(study.selectSample(mixed, { size: 10, seed: 'fixed' }).map((row) => row.id), ['kept']);
  assert.equal(study.isDemoPick({ userId: demoId }), true);
  assert.equal(study.isDemoPick({ userId: 'user-x', username: 'demonstrator' }), false, 'demo_ 접두사만 데모로 본다');

  // 카테고리가 표본 크기보다 적으면 두 바퀴째를 돌되 크기를 채운다.
  const narrow = study.selectSample(picks.filter((pick) => pick.categoryId === 'cat-0'), { size: 5, seed: 'fixed' });
  assert.equal(narrow.length, 5);
}

function checkCsv() {
  const rows = [
    { id: 'p1', category: '라면', review: '가격, 맛 둘 다 "좋다"' },
    { id: 'p2', category: '영화', review: '줄바꿈\n포함' },
  ];
  const sheet = study.toRaterSheet(rows);
  assert.match(sheet.split('\r\n')[0], /^id,category,review,theme$/);
  assert.ok(!/애정템|취향템|beloved/.test(sheet), '라벨링 시트에 정답 후보를 미리 넣지 않는다');
  const parsed = study.parseCsv(sheet);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].review, '가격, 맛 둘 다 "좋다"', '쉼표와 따옴표가 보존된다');
  assert.equal(parsed[1].review, '줄바꿈\n포함', '줄바꿈이 보존된다');
  assert.equal(parsed[0].theme, '');

  const filled = study.toCsv(
    [{ id: 'p1', theme: '애정템' }, { id: 'p2', theme: 'taste' }],
    ['id', 'theme'],
  );
  const read = study.parseRaterSheet(filled, { name: 'rater-a' });
  assert.equal(read.get('p1'), 'beloved', '한글 라벨을 코드로 바꾼다');
  assert.equal(read.get('p2'), 'taste', '코드를 그대로 써도 받는다');

  // 빈 칸, 모르는 값, 중복 행은 조용히 넘어가지 않는다.
  assert.throws(() => study.parseRaterSheet('id,theme\r\np1,\r\n', { name: 'rater-a' }), /비어 있습니다/);
  assert.throws(() => study.parseRaterSheet('id,theme\r\np1,애정\r\n', { name: 'rater-a' }), /알 수 없습니다/);
  assert.throws(() => study.parseRaterSheet('id,theme\r\np1,애정템\r\np1,취향템\r\n', { name: 'rater-a' }), /두 번 나옵니다/);
  assert.throws(() => study.parseRaterSheet('id,theme\r\n', { name: 'rater-a' }), /채워진 행이 없습니다/);
}

function checkStatistics() {
  const perfect = labels({ a: 'beloved', b: 'taste', c: 'shopping_tip', d: 'none' });
  const identical = study.cohenKappa(perfect, new Map(perfect));
  assert.equal(identical.kappa, 1);
  assert.equal(identical.agreement, 1);
  assert.equal(identical.pairs, 4);

  // 모두가 한 테마만 붙이면 단순 일치율은 100%지만 일치했다고 말할 수 없다.
  const flatA = labels({ a: 'taste', b: 'taste', c: 'taste' });
  const flat = study.cohenKappa(flatA, new Map(flatA));
  assert.equal(flat.agreement, 1);
  assert.equal(flat.kappa, null, '우연 일치와 구분되지 않으면 kappa를 내지 않는다');

  // 애정템/취향템을 서로 뒤집은 경우: 단순 일치는 절반이지만 kappa는 0이다.
  const left = labels({ a: 'beloved', b: 'beloved', c: 'taste', d: 'taste' });
  const right = labels({ a: 'beloved', b: 'taste', c: 'beloved', d: 'taste' });
  const coinFlip = study.cohenKappa(left, right);
  assert.equal(coinFlip.agreement, 0.5);
  assert.equal(coinFlip.kappa, 0, '동전 던지기 수준의 라벨은 kappa 0으로 드러난다');

  assert.deepEqual(study.cohenKappa(labels({ a: 'taste' }), labels({ b: 'taste' })), { kappa: null, agreement: null, pairs: 0 });

  const matrix = study.confusion(left, right);
  assert.equal(matrix.beloved.taste, 1);
  assert.equal(matrix.taste.beloved, 1);
  assert.equal(matrix.beloved.beloved, 1);
  assert.equal(matrix.none.none, 0);

  const spread = study.distribution(labels({ a: 'beloved', b: 'taste', c: 'taste', d: 'none' }));
  assert.equal(spread.total, 4);
  assert.equal(spread.counts.taste, 2);
  assert.equal(spread.top, 'taste');
  assert.equal(spread.topShare, 0.5);
  assert.equal(study.distribution(new Map()).total, 0);
}

function checkVerdict() {
  const balanced = study.distribution(labels({ a: 'beloved', b: 'taste', c: 'shopping_tip', d: 'none' }));
  const pass = study.verdict({ humanKappa: 0.7, aiKappa: 0.6, humanDistribution: balanced });
  assert.equal(pass.proceed, true);
  assert.equal(pass.findings.length, 0);

  const lowAgreement = study.verdict({ humanKappa: 0.2, aiKappa: 0.6, humanDistribution: balanced });
  assert.equal(lowAgreement.proceed, false);
  assert.deepEqual(lowAgreement.findings.map((finding) => finding.code), ['human_disagreement']);

  // kappa를 재지 못한 것은 통과가 아니라 중단이다.
  assert.equal(study.verdict({ humanKappa: null, aiKappa: null, humanDistribution: balanced }).proceed, false);

  const skewed = study.distribution(labels({ a: 'taste', b: 'taste', c: 'taste', d: 'beloved' }));
  const skew = study.verdict({ humanKappa: 0.8, aiKappa: 0.8, humanDistribution: skewed });
  assert.equal(skew.proceed, false);
  assert.deepEqual(skew.findings.map((finding) => finding.code), ['skewed']);

  // AI만 못 맞히는 것은 1단계를 막지 않는다. 자동 분류만 빠진다.
  const aiOnly = study.verdict({ humanKappa: 0.8, aiKappa: 0.1, humanDistribution: balanced });
  assert.equal(aiOnly.proceed, true);
  assert.deepEqual(aiOnly.findings.map((finding) => finding.code), ['ai_unreliable']);
  assert.equal(aiOnly.findings[0].blocking, false);

  assert.equal(study.THRESHOLDS.humanAgreement, 0.4);
  assert.equal(study.THRESHOLDS.aiAgreement, 0.4);
  assert.equal(study.THRESHOLDS.topShare, 0.7);
}

function checkReport() {
  const sample = [
    { id: 'p1', category: '라면', review: '10년째 이것만 먹는다' },
    { id: 'p2', category: '영화', review: '내 취향의 기준점' },
    { id: 'p3', category: '키보드', review: '직구가 3만원 싸다' },
    { id: 'p4', category: '과자', review: '그냥 좋다' },
  ];
  const report = study.renderReport({
    sample,
    aiLabels: labels({ p1: 'beloved', p2: 'taste', p3: 'shopping_tip', p4: 'none' }),
    raters: new Map([
      ['rater-a', labels({ p1: 'beloved', p2: 'taste', p3: 'shopping_tip', p4: 'none' })],
      ['rater-b', labels({ p1: 'taste', p2: 'taste', p3: 'shopping_tip', p4: 'none' })],
    ]),
    collectedAt: '2026-09-21T00:00:00.000Z',
  });
  assert.match(report.markdown, /^## 0단계 결과/);
  assert.match(report.markdown, /표본 4건 · 카테고리 4종/);
  assert.match(report.markdown, /애정템 ↔ 취향템 교차: 1건/);
  assert.match(report.markdown, /### 판정/);
  assert.match(report.markdown, /### 한계/);
  assert.equal(report.human.pairs, 4);
  assert.ok(report.human.kappa > 0.4);

  // 사람이 한 명뿐이면 일치도를 잴 수 없고, 판정은 통과가 아니다.
  const single = study.renderReport({
    sample,
    aiLabels: new Map(),
    raters: new Map([['rater-a', labels({ p1: 'beloved' })]]),
    collectedAt: '2026-09-21T00:00:00.000Z',
  });
  assert.match(single.markdown, /측정하지 못했습니다/);
  assert.match(single.markdown, /classify`를 먼저 실행/);
  assert.equal(single.decision.proceed, false);
}

async function checkReads() {
  let requested;
  const picks = await study.fetchActivePicks({
    url: 'https://example.supabase.co/', key: 'service-key', limit: 2,
    fetchImpl: async (url, init) => {
      requested = { url, init };
      return { ok: true, json: async () => [{
        id: 'p1', user_id: 'u1', one_line_review: '이유', started_at: '2026-09-01T00:00:00Z',
        category: { name: '라면', slug: 'ramen' }, profile: { username: 'someone' },
      }] };
    },
  });
  assert.equal(requested.init.method, 'GET', '이 도구는 읽기만 한다');
  assert.match(requested.url, /\/rest\/v1\/picks\?/);
  assert.match(requested.url, /status=eq\.active/);
  assert.ok(!requested.url.includes('//rest'), 'URL 끝의 슬래시를 겹치지 않는다');
  assert.deepEqual(picks, [{
    id: 'p1', userId: 'u1', username: 'someone', categoryId: 'ramen',
    category: '라면', review: '이유', startedAt: '2026-09-01T00:00:00Z',
  }]);

  await assert.rejects(
    () => study.fetchActivePicks({ url: 'https://example.supabase.co', key: 'k', fetchImpl: async () => ({ ok: false, status: 401 }) }),
    /HTTP 401/,
  );

  assert.throws(() => study.readEnv(['MISSING_ONE', 'MISSING_TWO'], {}), /MISSING_ONE, MISSING_TWO/);
  assert.deepEqual(study.readEnv(['PRESENT'], { PRESENT: '  value  ' }), { PRESENT: 'value' });
}

async function checkClassify() {
  const rows = [
    { id: 'p1', category: '라면', review: '10년째 이것만', userId: 'u1', username: 'someone' },
    { id: 'p2', category: '영화', review: '내 기준점', userId: 'u2', username: 'other' },
  ];
  // 모델에는 한줄평과 카테고리만 간다.
  const input = study.toModelInput(rows);
  assert.deepEqual(input, [
    { id: 'p1', category: '라면', review: '10년째 이것만' },
    { id: 'p2', category: '영화', review: '내 기준점' },
  ]);

  const completed = (labelList) => ({
    ok: true,
    json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ labels: labelList }) }] }] }),
  });

  let sentBody;
  const result = await study.classifyBatch(rows, {
    key: 'openai-key',
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      sentBody = JSON.parse(init.body);
      return completed([
        { id: 'p1', theme: 'beloved', confidence: 'high' },
        { id: 'p2', theme: 'taste', confidence: 'low' },
      ]);
    },
  });
  assert.deepEqual(result, [
    { id: 'p1', theme: 'beloved', confidence: 'high' },
    { id: 'p2', theme: 'taste', confidence: 'low' },
  ]);
  assert.equal(sentBody.store, false, '제공자 쪽에 원문을 남기지 않는다');
  assert.equal(sentBody.model, study.MODEL);
  assert.equal(sentBody.text.format.strict, true);
  assert.deepEqual(sentBody.text.format.schema.properties.labels.items.properties.theme.enum, study.THEME_CODES);
  assert.ok(!/u1|u2|someone|other/.test(JSON.stringify(sentBody)), '사용자 ID와 사용자명은 모델에 보내지 않는다');

  // id가 어긋난 배치는 버린다. 라벨이 다른 한줄평에 붙는 것이 가장 위험하다.
  await assert.rejects(() => study.classifyBatch(rows, {
    key: 'k',
    fetchImpl: async () => completed([
      { id: 'p1', theme: 'beloved', confidence: 'high' },
      { id: 'p9', theme: 'taste', confidence: 'low' },
    ]),
  }), /다른 id/);

  await assert.rejects(() => study.classifyBatch(rows, {
    key: 'k', fetchImpl: async () => ({ ok: false, status: 429, body: null }),
  }), /HTTP 429/);

  // 거부와 빈 응답은 라벨 없음으로 흘러가지 않는다.
  await assert.rejects(() => study.classifyBatch(rows, {
    key: 'k',
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }) }),
  }), /거부/);
  assert.equal(study.outputText({ status: 'incomplete', output: [] }), null);
  assert.equal(study.outputText(null), null);
}

function checkArgs() {
  assert.deepEqual(study.parseArgs(['sample', '--size', '30', '--seed=2026-09']), {
    command: 'sample', options: { size: '30', seed: '2026-09' },
  });
  assert.deepEqual(study.parseArgs(['report']), { command: 'report', options: {} });
  // 값 없는 플래그가 뒤 플래그를 삼키지 않는다.
  assert.deepEqual(study.parseArgs(['classify', '--verbose', '--out', 'dir']).options, { verbose: 'true', out: 'dir' });
}

async function main() {
  checkSampling();
  checkCsv();
  checkStatistics();
  checkVerdict();
  checkReport();
  await checkReads();
  await checkClassify();
  checkArgs();
  console.log('Theme label study checks passed: sampling is seeded and demo-free, rater sheets stay blind, kappa separates real agreement from chance, verdicts follow the documented thresholds, and the tool only reads picks while sending no account data to the model.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
