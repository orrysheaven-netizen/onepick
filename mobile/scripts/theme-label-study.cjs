#!/usr/bin/env node
// 원픽 테마 0단계 검증 도구 — docs/pick-themes.md 참조.
//
// 기존 한줄평이 쇼핑꿀팁/애정템/취향템으로 갈리는지, 그 구분을 사람이 재현할
// 수 있는지만 확인한다. 읽기 전용이다: picks를 select 하기만 하고 어떤 운영
// 테이블에도 쓰지 않으며, 스키마도 등록 화면도 건드리지 않는다.
//
//   node mobile/scripts/theme-label-study.cjs sample   --size 24 --seed 2026-09
//   node mobile/scripts/theme-label-study.cjs classify
//   node mobile/scripts/theme-label-study.cjs report   --raters rater-a.csv,rater-b.csv
//
// 산출물은 기본적으로 .theme-study/ 아래에 남고 Git에 올리지 않는다. 최종
// 수치만 docs/pick-themes.md의 `## 0단계 결과`로 옮긴다.

const fs = require('node:fs');
const path = require('node:path');

const MODEL = 'gpt-5.6-terra';
const PROMPT_VERSION = 'theme-study-v1';

// 쇼핑꿀팁은 문서상 원픽 테마 후보에서 빠졌지만, 코퍼스에 실제로 얼마나
// 나타나는지가 그 결정의 근거이므로 분류 대상에는 남겨둔다. `해당없음`이
// 없으면 모델이 애매한 한줄평을 억지로 세 갈래에 밀어넣는다.
const THEMES = [
  { code: 'beloved', label: '애정템', hint: '오래 써서 정이 들었거나 아끼는 마음이 앞서는 이유' },
  { code: 'taste', label: '취향템', hint: '내가 어떤 사람인지, 무엇을 좋아하는지를 드러내는 이유' },
  { code: 'shopping_tip', label: '쇼핑꿀팁', hint: '가격·구매처·사용법처럼 남에게 쓸모 있는 정보가 핵심인 이유' },
  { code: 'none', label: '해당없음', hint: '위 셋 중 어디에도 분명히 들어가지 않는 이유' },
];
const THEME_CODES = THEMES.map((theme) => theme.code);
const LABEL_TO_CODE = new Map(THEMES.map((theme) => [theme.label, theme.code]));
const CODE_TO_LABEL = new Map(THEMES.map((theme) => [theme.code, theme.label]));

// 판정 기준. docs/pick-themes.md의 `0단계 판단 기준`과 같은 값을 쓴다.
const THRESHOLDS = { humanAgreement: 0.4, aiAgreement: 0.4, topShare: 0.7 };

// private.is_demo_profile()은 private 스키마라 REST로 부를 수 없다. 고정 시드
// ID와 demo_ 사용자명까지만 여기서 거르고, auth.users.raw_app_meta_data 검사는
// 재현할 수 없다는 점을 리포트에 적는다.
const DEMO_USER_IDS = new Set([
  'd0e00001-1111-4111-8111-111111111111',
  'd0e00002-2222-4222-8222-222222222222',
  'd0e00003-3333-4333-8333-333333333333',
  'd0e00004-4444-4444-8444-444444444444',
  'd0e00005-5555-4555-8555-555555555555',
]);

const isDemoPick = (pick) =>
  DEMO_USER_IDS.has(String(pick.userId ?? '')) || String(pick.username ?? '').startsWith('demo_');

/* ------------------------------------------------------------------ 표본 추출 */

// 시드 문자열에서 결정적인 난수열을 만든다. 같은 시드는 같은 표본을 준다.
function seededRandom(seed) {
  let hash = 2166136261;
  for (const character of String(seed)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

// 한 카테고리가 표본을 독점하면 "테마 차이"가 아니라 "카테고리 차이"를 재게
// 된다. 카테고리를 한 바퀴씩 돌며 뽑아 겹침을 최대한 줄인다.
function selectSample(picks, { size = 24, seed = 'theme-study' } = {}) {
  const random = seededRandom(seed);
  const usable = picks.filter((pick) => !isDemoPick(pick) && String(pick.review ?? '').trim().length > 0);
  const byCategory = new Map();
  for (const pick of usable) {
    const key = pick.categoryId ?? pick.category ?? 'unknown';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(pick);
  }
  const queues = shuffle([...byCategory.keys()], random)
    .map((key) => shuffle(byCategory.get(key), random));
  const selected = [];
  let drained = false;
  while (selected.length < size && !drained) {
    drained = true;
    for (const queue of queues) {
      if (selected.length >= size) break;
      const pick = queue.shift();
      if (!pick) continue;
      drained = false;
      selected.push(pick);
    }
  }
  return selected;
}

/* ------------------------------------------------------------------ CSV 입출력 */

const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toCsv = (rows, columns) =>
  [columns.join(','), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))].join('\r\n') + '\r\n';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character !== '"') { cell += character; continue; }
      if (text[index + 1] === '"') { cell += '"'; index++; continue; }
      quoted = false;
      continue;
    }
    if (character === '"' && cell === '') { quoted = true; continue; }
    if (character === ',') { endCell(); continue; }
    if (character === '\r') continue;
    if (character === '\n') { endRow(); continue; }
    cell += character;
  }
  if (cell !== '' || row.length > 0) endRow();
  const header = rows.shift() ?? [];
  return rows
    .filter((values) => values.some((value) => value.trim() !== ''))
    .map((values) => Object.fromEntries(header.map((name, index) => [name.trim(), (values[index] ?? '').trim()])));
}

// 라벨링 시트는 AI 라벨을 담지 않는다. 사람이 모델 답을 보고 맞추면 일치도가
// 의미를 잃는다.
const toRaterSheet = (rows) => toCsv(
  rows.map((row) => ({ id: row.id, category: row.category, review: row.review, theme: '' })),
  ['id', 'category', 'review', 'theme'],
);

function parseRaterSheet(text, { name = 'rater' } = {}) {
  const labels = new Map();
  for (const row of parseCsv(text)) {
    const id = row.id ?? '';
    const value = row.theme ?? '';
    if (!id) continue;
    if (!value) throw new Error(`${name}: ${id} 행의 theme가 비어 있습니다. 모든 행을 채운 뒤 다시 실행해주세요.`);
    const code = LABEL_TO_CODE.get(value) ?? (THEME_CODES.includes(value) ? value : null);
    if (!code) throw new Error(`${name}: ${id} 행의 theme "${value}"를 알 수 없습니다. ${[...LABEL_TO_CODE.keys()].join(' / ')} 중에서 골라주세요.`);
    if (labels.has(id)) throw new Error(`${name}: ${id} 행이 두 번 나옵니다.`);
    labels.set(id, code);
  }
  if (labels.size === 0) throw new Error(`${name}: 채워진 행이 없습니다.`);
  return labels;
}

/* ------------------------------------------------------------------ 통계 */

function distribution(labels) {
  const counts = Object.fromEntries(THEME_CODES.map((code) => [code, 0]));
  let total = 0;
  for (const code of labels.values()) {
    if (!(code in counts)) continue;
    counts[code]++;
    total++;
  }
  const shares = Object.fromEntries(THEME_CODES.map((code) => [code, total ? counts[code] / total : 0]));
  const top = THEME_CODES.reduce((best, code) => (counts[code] > counts[best] ? code : best), THEME_CODES[0]);
  return { counts, shares, total, top, topShare: total ? counts[top] / total : 0 };
}

const pairedIds = (left, right) => [...left.keys()].filter((id) => right.has(id)).sort();

// Cohen's kappa. 우연히 맞을 확률(pe)을 빼기 때문에, 한 테마로 쏠린 표본에서
// 단순 일치율이 높아 보이는 착시를 걸러낸다.
function cohenKappa(left, right) {
  const ids = pairedIds(left, right);
  if (ids.length === 0) return { kappa: null, agreement: null, pairs: 0 };
  let agreed = 0;
  const leftCounts = Object.fromEntries(THEME_CODES.map((code) => [code, 0]));
  const rightCounts = Object.fromEntries(THEME_CODES.map((code) => [code, 0]));
  for (const id of ids) {
    const a = left.get(id);
    const b = right.get(id);
    if (a === b) agreed++;
    if (a in leftCounts) leftCounts[a]++;
    if (b in rightCounts) rightCounts[b]++;
  }
  const observed = agreed / ids.length;
  const expected = THEME_CODES.reduce(
    (sum, code) => sum + (leftCounts[code] / ids.length) * (rightCounts[code] / ids.length),
    0,
  );
  // 두 사람이 모든 항목에 같은 하나의 테마만 붙이면 pe가 1이 된다. 이때 kappa는
  // 정의되지 않으며, 일치했다고 말할 수 없는 경우다.
  const kappa = expected === 1 ? null : (observed - expected) / (1 - expected);
  return { kappa, agreement: observed, pairs: ids.length };
}

function confusion(left, right) {
  const matrix = Object.fromEntries(THEME_CODES.map((rowCode) => [
    rowCode, Object.fromEntries(THEME_CODES.map((columnCode) => [columnCode, 0])),
  ]));
  for (const id of pairedIds(left, right)) {
    const a = left.get(id);
    const b = right.get(id);
    if (a in matrix && b in matrix[a]) matrix[a][b]++;
  }
  return matrix;
}

// 문서가 세운 실패 조건 세 가지를 그대로 코드로 옮긴다. 판정은 수치에서만
// 나오고, 어떤 항목도 "다음에 보완"으로 넘기지 않는다.
function verdict({ humanKappa, aiKappa, humanDistribution }) {
  const findings = [];
  if (humanKappa === null || humanKappa < THRESHOLDS.humanAgreement) {
    findings.push({
      code: 'human_disagreement',
      blocking: true,
      text: `사람 사이 일치도(kappa ${format(humanKappa)})가 기준 ${THRESHOLDS.humanAgreement} 아래입니다. 세 갈래는 사람이 재현할 수 있는 구분이 아닙니다. 갈래를 줄이거나(추천형 / 애착형) 테마 축을 접습니다.`,
    });
  }
  if (humanDistribution && humanDistribution.topShare >= THRESHOLDS.topShare) {
    findings.push({
      code: 'skewed',
      blocking: true,
      text: `${CODE_TO_LABEL.get(humanDistribution.top)} 하나가 표본의 ${percent(humanDistribution.topShare)}를 차지합니다. 나머지 라벨은 선택지로서 의미가 없습니다. 이 테마를 기본값으로 두고 예외만 표시하는 형태를 검토합니다.`,
    });
  }
  if (aiKappa === null || aiKappa < THRESHOLDS.aiAgreement) {
    findings.push({
      code: 'ai_unreliable',
      blocking: false,
      text: `AI와 사람의 일치도(kappa ${format(aiKappa)})가 기준 ${THRESHOLDS.aiAgreement} 아래입니다. 자동 분류는 쓰지 않고 사용자 선택만 남깁니다.`,
    });
  }
  const blocked = findings.some((finding) => finding.blocking);
  return {
    findings,
    proceed: !blocked,
    summary: blocked
      ? '1단계로 넘어가지 않습니다. 위 항목을 먼저 해결해야 합니다.'
      : findings.length > 0
        ? '1단계(선택형 nullable 라벨)로 넘어갈 수 있습니다. 다만 자동 분류는 제외합니다.'
        : '1단계(선택형 nullable 라벨)로 넘어갈 수 있습니다.',
  };
}

const format = (value) => (value === null || value === undefined || Number.isNaN(value) ? '측정 불가' : value.toFixed(2));
const percent = (value) => `${Math.round(value * 100)}%`;

/* ------------------------------------------------------------------ 리포트 */

function renderReport({ sample, aiLabels, raters, collectedAt }) {
  const raterNames = [...raters.keys()];
  const [firstName, secondName] = raterNames;
  const human = firstName && secondName
    ? cohenKappa(raters.get(firstName), raters.get(secondName))
    : { kappa: null, agreement: null, pairs: 0 };
  const humanDistribution = firstName ? distribution(raters.get(firstName)) : null;
  const aiAgreements = raterNames.map((name) => ({ name, ...cohenKappa(aiLabels, raters.get(name)) }));
  const measuredAi = aiAgreements.filter((entry) => entry.kappa !== null);
  const aiKappa = measuredAi.length
    ? measuredAi.reduce((sum, entry) => sum + entry.kappa, 0) / measuredAi.length
    : null;
  const decision = verdict({ humanKappa: human.kappa, aiKappa, humanDistribution });

  const lines = [];
  lines.push('## 0단계 결과');
  lines.push('');
  lines.push(`- 수집: ${collectedAt} · 표본 ${sample.length}건 · 카테고리 ${new Set(sample.map((row) => row.category)).size}종 · 프롬프트 ${PROMPT_VERSION} · 모델 ${MODEL}`);
  lines.push(`- 라벨러: ${raterNames.length ? raterNames.join(', ') : '없음'}${firstName && secondName ? '' : ' (사람 둘의 라벨이 있어야 일치도를 잽니다)'}`);
  lines.push('');
  lines.push('### 분포');
  lines.push('');
  lines.push(`| 라벨러 | ${THEMES.map((theme) => theme.label).join(' | ')} |`);
  lines.push(`| --- | ${THEMES.map(() => '---').join(' | ')} |`);
  const distributionRow = (name, labels) => {
    const result = distribution(labels);
    return `| ${name} | ${THEME_CODES.map((code) => `${result.counts[code]} (${percent(result.shares[code])})`).join(' | ')} |`;
  };
  if (aiLabels.size) lines.push(distributionRow('AI', aiLabels));
  for (const name of raterNames) lines.push(distributionRow(name, raters.get(name)));
  lines.push('');
  lines.push('### 사람 사이 일치도');
  lines.push('');
  if (human.pairs === 0) {
    lines.push('- 같은 항목을 둘 다 라벨한 행이 없어 측정하지 못했습니다.');
  } else {
    lines.push(`- 대상 ${human.pairs}건 · 단순 일치 ${percent(human.agreement)} · Cohen's kappa ${format(human.kappa)} (기준 ${THRESHOLDS.humanAgreement})`);
    lines.push('');
    const matrix = confusion(raters.get(firstName), raters.get(secondName));
    lines.push(`| ${firstName} \\ ${secondName} | ${THEMES.map((theme) => theme.label).join(' | ')} |`);
    lines.push(`| --- | ${THEMES.map(() => '---').join(' | ')} |`);
    for (const rowCode of THEME_CODES) {
      lines.push(`| ${CODE_TO_LABEL.get(rowCode)} | ${THEME_CODES.map((columnCode) => matrix[rowCode][columnCode]).join(' | ')} |`);
    }
    const swapped = matrix.beloved.taste + matrix.taste.beloved;
    lines.push('');
    lines.push(`- 애정템 ↔ 취향템 교차: ${swapped}건. 이 칸이 크면 두 갈래를 하나로 합치는 편이 낫습니다.`);
  }
  lines.push('');
  lines.push('### AI와 사람의 일치도');
  lines.push('');
  if (!aiLabels.size) {
    lines.push('- AI 라벨이 없습니다. `classify`를 먼저 실행해주세요.');
  } else if (!aiAgreements.length) {
    lines.push('- 비교할 사람 라벨이 없습니다.');
  } else {
    for (const entry of aiAgreements) {
      lines.push(`- AI ↔ ${entry.name}: 대상 ${entry.pairs}건 · 단순 일치 ${entry.agreement === null ? '측정 불가' : percent(entry.agreement)} · kappa ${format(entry.kappa)}`);
    }
    lines.push(`- 평균 kappa ${format(aiKappa)} (기준 ${THRESHOLDS.aiAgreement})`);
  }
  lines.push('');
  lines.push('### 판정');
  lines.push('');
  if (!decision.findings.length) lines.push('- 실패 조건에 걸린 항목이 없습니다.');
  for (const finding of decision.findings) lines.push(`- ${finding.blocking ? '**중단**' : '제한'}: ${finding.text}`);
  lines.push('');
  lines.push(`- ${decision.summary}`);
  lines.push('');
  lines.push('### 한계');
  lines.push('');
  lines.push('- 표본은 카테고리가 겹치지 않도록 뽑은 것이라 카테고리별 실제 원픽 수를 반영하지 않습니다.');
  lines.push('- 데모 계정은 고정 시드 ID와 `demo_` 사용자명으로만 걸렀습니다. `auth.users.raw_app_meta_data` 표시는 REST로 확인할 수 없습니다.');
  lines.push('- 이 수치는 "사람이 구분할 수 있는가"만 말합니다. 등록 화면에서 실제로 고를지는 1단계 선택률로만 알 수 있습니다.');
  return { markdown: lines.join('\n') + '\n', decision, human, aiKappa, humanDistribution };
}

/* ------------------------------------------------------------------ 외부 호출 */

function readEnv(names, env = process.env) {
  const missing = names.filter((name) => !String(env[name] ?? '').trim());
  if (missing.length) throw new Error(`환경 변수 ${missing.join(', ')}가 필요합니다.`);
  return Object.fromEntries(names.map((name) => [name, String(env[name]).trim()]));
}

// select만 한다. 이 도구는 어떤 테이블에도 쓰지 않는다.
async function fetchActivePicks({ url, key, limit = 2000, fetchImpl = fetch }) {
  const collected = [];
  const pageSize = 500;
  for (let offset = 0; offset < limit; offset += pageSize) {
    const query = new URLSearchParams({
      select: 'id,user_id,one_line_review,started_at,category:categories(name,slug),profile:profiles(username)',
      status: 'eq.active',
      order: 'started_at.desc',
      limit: String(Math.min(pageSize, limit - offset)),
      offset: String(offset),
    });
    const response = await fetchImpl(`${url.replace(/\/+$/, '')}/rest/v1/picks?${query}`, {
      method: 'GET',
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`원픽을 읽지 못했습니다 (HTTP ${response.status}).`);
    const page = await response.json();
    if (!Array.isArray(page) || page.length === 0) break;
    for (const row of page) {
      collected.push({
        id: row.id,
        userId: row.user_id,
        username: row.profile?.username ?? null,
        categoryId: row.category?.slug ?? null,
        category: row.category?.name ?? '미분류',
        review: row.one_line_review ?? '',
        startedAt: row.started_at ?? null,
      });
    }
    if (page.length < pageSize) break;
  }
  return collected;
}

const CLASSIFY_INSTRUCTIONS = [
  '너는 한국어 한줄평을 분류한다. 각 한줄평은 어떤 사람이 그 상품을 자신의 "원픽"으로 고른 이유다.',
  '',
  '아래 네 갈래 중 하나를 고른다.',
  ...THEMES.map((theme) => `- ${theme.code} (${theme.label}): ${theme.hint}`),
  '',
  '규칙:',
  '- 상품이 무엇인지가 아니라 "이유의 성격"으로 판단한다.',
  '- 두 갈래에 똑같이 해당하거나 판단 근거가 부족하면 none을 고른다. 억지로 세 갈래에 넣지 않는다.',
  '- confidence는 스스로 얼마나 확신하는지다. 애매하면 low를 쓴다.',
  '- 요청받은 id를 그대로 돌려준다. 새로 만들거나 빠뜨리지 않는다.',
].join('\n');

// 모델에는 한줄평과 카테고리 이름만 보낸다. 사용자 ID와 사용자명은 표본에서
// 이미 떼어낸 뒤 전달한다.
const toModelInput = (rows) => rows.map((row) => ({ id: row.id, category: row.category, review: row.review }));

async function classifyBatch(rows, { key, fetchImpl = fetch, model = MODEL, timeoutMs = 30_000 }) {
  const requested = new Set(rows.map((row) => row.id));
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 2000,
      instructions: CLASSIFY_INSTRUCTIONS,
      input: JSON.stringify({ reviews: toModelInput(rows) }),
      text: { format: {
        type: 'json_schema', name: 'onepick_theme_labels', strict: true,
        schema: {
          type: 'object',
          properties: {
            labels: {
              type: 'array',
              minItems: rows.length,
              maxItems: rows.length,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', minLength: 1, maxLength: 64 },
                  theme: { type: 'string', enum: THEME_CODES },
                  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                },
                required: ['id', 'theme', 'confidence'],
                additionalProperties: false,
              },
            },
          },
          required: ['labels'],
          additionalProperties: false,
        },
      } },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    await response.body?.cancel?.();
    throw new Error(`분류 호출이 실패했습니다 (HTTP ${response.status}).`);
  }
  const payload = await response.json();
  const text = outputText(payload);
  if (!text) throw new Error('모델이 빈 응답이나 거부를 돌려줬습니다.');
  const { labels } = JSON.parse(text);
  if (!Array.isArray(labels)) throw new Error('모델 응답에 labels 배열이 없습니다.');
  // id가 어긋나면 라벨이 다른 한줄평에 붙는다. 조용히 넘어가지 않고 멈춘다.
  const returned = new Set(labels.map((label) => label.id));
  if (returned.size !== requested.size || [...requested].some((id) => !returned.has(id))) {
    throw new Error('모델이 요청과 다른 id를 돌려줬습니다. 이 배치는 버립니다.');
  }
  return labels.map((label) => {
    if (!THEME_CODES.includes(label.theme)) throw new Error(`알 수 없는 테마 ${label.theme}`);
    return { id: label.id, theme: label.theme, confidence: label.confidence };
  });
}

function outputText(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.status !== 'completed' || !Array.isArray(value.output)) return null;
  const fragments = [];
  for (const entry of value.output) {
    if (!entry || entry.type !== 'message' || !Array.isArray(entry.content)) continue;
    for (const content of entry.content) {
      if (!content) continue;
      if (content.type === 'refusal') return null;
      if (content.type === 'output_text' && typeof content.text === 'string') fragments.push(content.text);
    }
  }
  return fragments.join('') || null;
}

/* ------------------------------------------------------------------ CLI */

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index];
    if (!token.startsWith('--')) continue;
    const [name, inline] = token.slice(2).split('=');
    options[name] = inline !== undefined ? inline : (rest[index + 1]?.startsWith('--') ? 'true' : rest[++index] ?? 'true');
  }
  return { command, options };
}

const outDir = (options) => path.resolve(options.out ?? path.join(__dirname, '../../.theme-study'));
const readJson = (file, hint) => {
  if (!fs.existsSync(file)) throw new Error(`${path.basename(file)}가 없습니다. ${hint}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

const USAGE = [
  '사용법:',
  '  theme-label-study.cjs sample   [--size 24] [--seed 2026-09] [--limit 2000] [--out DIR]',
  '  theme-label-study.cjs classify [--out DIR]',
  '  theme-label-study.cjs report   --raters a.csv,b.csv [--out DIR]',
].join('\n');

async function runSample(options) {
  const env = readEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  const directory = outDir(options);
  fs.mkdirSync(directory, { recursive: true });
  const picks = await fetchActivePicks({
    url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, limit: Number(options.limit ?? 2000),
  });
  const sample = selectSample(picks, { size: Number(options.size ?? 24), seed: options.seed ?? 'theme-study' })
    // 등록자 식별 정보는 표본에 남기지 않는다. 이후 단계는 이 파일만 읽는다.
    .map(({ id, category, review }) => ({ id, category, review }));
  if (!sample.length) throw new Error('분류할 한줄평이 없습니다.');
  fs.writeFileSync(path.join(directory, 'sample.json'), JSON.stringify({
    collectedAt: new Date().toISOString(), seed: options.seed ?? 'theme-study', total: picks.length, sample,
  }, null, 2));
  for (const name of ['rater-a.csv', 'rater-b.csv']) {
    const file = path.join(directory, name);
    if (fs.existsSync(file)) { console.log(`${name}는 이미 있어 덮어쓰지 않았습니다.`); continue; }
    fs.writeFileSync(file, toRaterSheet(sample));
  }
  console.log(`원픽 ${picks.length}건에서 ${sample.length}건을 뽑아 ${directory}에 저장했습니다.`);
  console.log(`라벨링 시트 rater-a.csv / rater-b.csv의 theme 칸을 ${[...LABEL_TO_CODE.keys()].join(' / ')} 중 하나로 채워주세요. 두 사람이 서로의 답을 보지 않아야 합니다.`);
}

async function runClassify(options) {
  const env = readEnv(['OPENAI_API_KEY']);
  const directory = outDir(options);
  const { sample } = readJson(path.join(directory, 'sample.json'), '먼저 sample을 실행해주세요.');
  const labels = [];
  for (let index = 0; index < sample.length; index += 10) {
    const batch = sample.slice(index, index + 10);
    labels.push(...await classifyBatch(batch, { key: env.OPENAI_API_KEY }));
    console.log(`${Math.min(index + batch.length, sample.length)}/${sample.length} 분류함`);
  }
  fs.writeFileSync(path.join(directory, 'ai-labels.json'), JSON.stringify({
    model: MODEL, promptVersion: PROMPT_VERSION, labeledAt: new Date().toISOString(), labels,
  }, null, 2));
  const counts = distribution(new Map(labels.map((label) => [label.id, label.theme])));
  console.log(`AI 분류 완료: ${THEME_CODES.map((code) => `${CODE_TO_LABEL.get(code)} ${counts.counts[code]}`).join(' · ')}`);
  console.log('사람 라벨이 모이면 report를 실행해주세요. 이 결과를 라벨러에게 보여주면 일치도가 의미를 잃습니다.');
}

async function runReport(options) {
  const directory = outDir(options);
  const sampleFile = readJson(path.join(directory, 'sample.json'), '먼저 sample을 실행해주세요.');
  const aiFile = fs.existsSync(path.join(directory, 'ai-labels.json'))
    ? readJson(path.join(directory, 'ai-labels.json'), '')
    : { labels: [] };
  const raterFiles = String(options.raters ?? 'rater-a.csv,rater-b.csv').split(',').map((name) => name.trim()).filter(Boolean);
  const raters = new Map();
  for (const name of raterFiles) {
    const file = path.isAbsolute(name) ? name : path.join(directory, name);
    if (!fs.existsSync(file)) throw new Error(`${name}가 없습니다.`);
    raters.set(path.basename(name, '.csv'), parseRaterSheet(fs.readFileSync(file, 'utf8'), { name }));
  }
  const report = renderReport({
    sample: sampleFile.sample,
    aiLabels: new Map(aiFile.labels.map((label) => [label.id, label.theme])),
    raters,
    collectedAt: sampleFile.collectedAt,
  });
  fs.writeFileSync(path.join(directory, 'report.md'), report.markdown);
  console.log(report.markdown);
  console.log(`${path.join(directory, 'report.md')}에 저장했습니다. 수치를 docs/pick-themes.md의 \`## 0단계 결과\`로 옮겨주세요.`);
  process.exitCode = report.decision.proceed ? 0 : 2;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'sample') return runSample(options);
  if (command === 'classify') return runClassify(options);
  if (command === 'report') return runReport(options);
  console.log(USAGE);
  process.exitCode = command ? 1 : 0;
}

module.exports = {
  THEMES, THEME_CODES, THRESHOLDS, MODEL, PROMPT_VERSION, DEMO_USER_IDS, CLASSIFY_INSTRUCTIONS,
  isDemoPick, seededRandom, selectSample, toCsv, parseCsv, toRaterSheet, parseRaterSheet,
  distribution, cohenKappa, confusion, verdict, renderReport, readEnv, fetchActivePicks,
  toModelInput, classifyBatch, outputText, parseArgs,
};

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
