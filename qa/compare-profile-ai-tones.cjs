#!/usr/bin/env node
// Read-only offline comparison. Never loads a provider client, key or database.
const fs = require('node:fs');
const path = require('node:path');
const { planFingerprint, sha256 } = require('./profile-ai-plan-identity.cjs');
const check = (value, code) => { if (!value) throw new Error(code); };
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const bounded = (value, maximum) => typeof value === 'string' && value.trim() && value.length <= maximum;
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const checks = ['sameGroundedObservations', 'directEvidenceFirst', 'warmWithoutInventedFeelings',
  'consistentWithAllPicks', 'noAgeOrSensitiveInference', 'respectfulBoth', 'readableAndOptionalHumor'];

function validateRun(run, tone) {
  check(run?.schemaVersion === 1 && ['plan', 'mock', 'live'].includes(run.mode), 'QA_TONE_RUN_INVALID');
  const plan = run.plan;
  check(plan?.identityVersion === 2 && plan.synthetic === true && plan.tone === tone, 'QA_TONE_IDENTITY_REQUIRED');
  check(integer(plan.repeats, 1, 3) && Array.isArray(plan.cases) && plan.cases.length === 8 &&
    plan.maximumCalls === 8 * plan.repeats && integer(plan.maximumOutputTokensPerCall, 1, 4096), 'QA_TONE_PLAN_INVALID');
  for (const name of ['fingerprint', 'datasetHash', 'promptHash', 'schemaHash']) check(hash(plan[name]), 'QA_TONE_HASH_INVALID');
  check(bounded(plan.model, 120) && bounded(plan.promptVersion, 120) && bounded(plan.contractVersion, 80), 'QA_TONE_METADATA_INVALID');
  check(plan.promptVersion.endsWith(`:${tone}:tone-v1`), 'QA_TONE_PROMPT_MISMATCH');
  check(plan.sourceHashes && same(Object.keys(plan.sourceHashes).sort(), ['contract.ts', 'index.ts', 'quality.ts', 'tone.ts']) &&
    Object.values(plan.sourceHashes).every(hash), 'QA_TONE_SOURCE_INVALID');
  const ids = new Set();
  for (const entry of plan.cases) {
    check(bounded(entry.id, 80) && /^[a-z0-9-]+$/.test(entry.id) && !ids.has(entry.id), 'QA_TONE_CASE_INVALID'); ids.add(entry.id);
    check(bounded(entry.label, 200) && Array.isArray(entry.picks) && entry.picks.length === 10 &&
      new Set(entry.picks.map((p) => p?.category)).size === 10, 'QA_TONE_INPUT_INVALID');
    check(entry.picks.every((p) => bounded(p?.category, 300) && bounded(p.item, 300) && bounded(p.review, 100)), 'QA_TONE_INPUT_INVALID');
    check(hash(entry.inputHash) && hash(entry.requestHash), 'QA_TONE_HASH_INVALID');
  }
  check(sha256(JSON.stringify(plan.cases.map(({ requestHash, ...entry }) => entry))) === plan.datasetHash,
    'QA_TONE_DATASET_CHANGED');
  check(planFingerprint(plan) === plan.fingerprint, 'QA_TONE_RECIPE_CHANGED');
  check(Array.isArray(run.rows) && run.rows.length === plan.maximumCalls, 'QA_TONE_ROWS_INVALID');
  const expected = new Map(plan.cases.flatMap((entry) => Array.from({ length: plan.repeats }, (_, i) =>
    [`${entry.id}#${i + 1}`, { entry, repetition: i + 1 }])));
  const rows = new Map(); let attempted = 0;
  for (const row of run.rows) {
    const target = expected.get(row?.key);
    check(target && !rows.has(row.key) && row.caseId === target.entry.id && row.repetition === target.repetition &&
      row.inputHash === target.entry.inputHash && row.requestHash === target.entry.requestHash, 'QA_TONE_ROWS_INVALID');
    check(typeof row.status === 'string' && /^(not_attempted|attempted|output_received|http_[0-9]{1,3}|QA_[A-Z_]+|AI_REVIEW_AGE_EXCLUDED)$/.test(row.status) &&
      ['pass', 'fail', 'not_run'].includes(row.automaticCheck), 'QA_TONE_STATUS_INVALID');
    check(row.durationMs === null || integer(row.durationMs, 0, 3600000), 'QA_TONE_TIME_INVALID');
    if (row.comment !== null) {
      const c = row.comment;
      check(c && bounded(c.summary, 180) && bounded(c.body, 1200) && Array.isArray(c.keywords) &&
        c.keywords.length === 3 && c.keywords.every((k) => bounded(k, 24)) && new Set(c.keywords).size === 3,
      'QA_TONE_COMMENT_INVALID');
    }
    if (row.status === 'output_received') check(row.comment && row.automaticCheck === 'pass', 'QA_TONE_FALSE_SUCCESS');
    else check(row.automaticCheck !== 'pass', 'QA_TONE_FALSE_SUCCESS');
    if (row.status === 'not_attempted') check(row.comment === null && row.automaticCheck === 'not_run' &&
      row.durationMs === null && row.usage === null, 'QA_TONE_INVENTED_RESULT');
    else attempted++;
    if (run.mode === 'plan') check(row.status === 'not_attempted', 'QA_TONE_PLAN_HAS_OUTPUT');
    rows.set(row.key, row);
  }
  check(run.providerCallsAttempted === attempted, 'QA_TONE_ATTEMPT_COUNT_INVALID');
  return rows;
}
function side(row) {
  return { status: row.status, automaticCheck: row.automaticCheck,
    comment: row.comment ? { summary: row.comment.summary, body: row.comment.body, keywords: [...row.comment.keywords] } : null,
    outputHash: row.comment ? sha256(JSON.stringify(row.comment)) : null,
    durationMs: row.durationMs, actualModel: bounded(row.actualModel, 120) ? row.actualModel : null };
}
function compareToneRuns(direct, warm) {
  const left = validateRun(direct, 'direct'), right = validateRun(warm, 'warm');
  check(direct.mode === warm.mode, 'QA_TONE_MODES_MUST_MATCH');
  const a = direct.plan, b = warm.plan;
  check(a.datasetHash === b.datasetHash && a.repeats === b.repeats, 'QA_TONE_INPUTS_MUST_MATCH');
  check(['model', 'contractVersion', 'schemaHash', 'maximumOutputTokensPerCall'].every((key) => a[key] === b[key]) &&
    same(Object.entries(a.sourceHashes).sort(), Object.entries(b.sourceHashes).sort()), 'QA_TONE_SETTINGS_MUST_MATCH');
  check(a.fingerprint !== b.fingerprint && a.promptHash !== b.promptHash, 'QA_TONE_IDENTITIES_MUST_DIFFER');
  const pairs = [...left].map(([key, row]) => {
    const other = right.get(key), entry = a.cases.find((x) => x.id === row.caseId);
    const otherEntry = b.cases.find((x) => x.id === row.caseId);
    check(other && other.inputHash === row.inputHash && same(entry.picks, otherEntry.picks), 'QA_TONE_INPUTS_MUST_MATCH');
    const t = side(row), f = side(other);
    return { key, label: entry.label, caseId: row.caseId, repetition: row.repetition,
      inputHash: row.inputHash, picks: entry.picks.map(({ category, item, review }) => ({ category, item, review })),
      direct: t, warm: f,
      comparisonId: sha256(JSON.stringify({ key, direct: a.fingerprint, warm: b.fingerprint, t, f })),
      readyForHumanReview: direct.mode === 'live' && t.status === 'output_received' && f.status === 'output_received',
      returnedModelMismatch: t.actualModel && f.actualModel ? t.actualModel !== f.actualModel : null,
      humanVerdict: null };
  });
  return { schemaVersion: 1, mode: direct.mode, createdAt: new Date().toISOString(),
    humanMeaningVerdict: 'not_automatically_graded', plannedCalls: a.maximumCalls + b.maximumCalls,
    attempts: direct.providerCallsAttempted + warm.providerCallsAttempted,
    directFingerprint: a.fingerprint, warmFingerprint: b.fingerprint,
    model: a.model, readyPairs: pairs.filter((p) => p.readyForHumanReview).length, pairs };
}
function reviewTemplate(comparison) {
  return { schemaVersion: 1, mode: comparison.mode, meaningQualityNotAutomaticallyGraded: true,
    pairs: comparison.pairs.map((p) => ({ key: p.key, comparisonId: p.comparisonId,
      directOutputHash: p.direct.outputHash, warmOutputHash: p.warm.outputHash,
      reviewer: null, reviewedAt: null, verdict: null,
      checks: Object.fromEntries(checks.map((key) => [key, null])),
      directEvidencePickNumbers: [], warmEvidencePickNumbers: [], notes: '' })) };
}
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (s) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
function renderReport(comparison) {
  const banner = comparison.mode === 'plan' ? '실행 계획 · 실제 AI 결과 없음'
    : comparison.mode === 'mock' ? '모의 응답 · 실제 AI 품질 검증 아님' : '실제 실행 기록 비교 · 문장 검토는 미완료';
  const column = (row, label, title) => `<article><small>${esc(label)}</small><h3>${esc(title)}</h3>
<p class="meta">${esc(row.status)} · 자동 형식 검사 ${esc(row.automaticCheck)}</p>
${row.comment ? `<strong>${esc(row.comment.summary)}</strong><p class="body">${esc(row.comment.body)}</p><p>${row.comment.keywords.map(esc).join(' · ')}</p>`
  : '<p class="empty">아직 비교할 댓글이 없습니다.<br>예시를 실제 생성 결과로 대신 넣지 않습니다.</p>'}</article>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>OnePick T/F 댓글 비교</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f6fa;color:#262938;font:15px/1.75 system-ui,sans-serif}main{max-width:1120px;margin:48px auto;padding:0 20px}h1{font-size:32px;margin:8px 0}h2{font-size:20px}h3{font-size:18px;margin:4px 0}p{margin:8px 0}header,.case{background:white;border:1px solid #e0e3eb;border-radius:18px;padding:24px;margin-bottom:24px}.tag{color:#5145c4;font-weight:700}.banner{background:#efedff;border-radius:10px;padding:12px 16px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}article{padding:20px;border:1px solid #e1e4ec;border-radius:12px;min-width:0}.meta,small{color:#62697a}.empty{padding:26px 0;color:#62697a}.body{white-space:pre-wrap}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{padding:8px;text-align:left;vertical-align:top;border-bottom:1px solid #e4e6ee;overflow-wrap:anywhere}th:first-child{width:8%}th:nth-child(2){width:30%}summary{cursor:pointer;padding:8px 0}p,strong,small{overflow-wrap:anywhere}.review{border-top:1px solid #e4e6ee;padding-top:12px}@media(max-width:680px){main{margin:18px auto;padding:0 12px}header,.case{padding:18px}h1{font-size:26px}.columns{grid-template-columns:1fr}article{padding:16px}}</style></head><body><main>
<header><span class="tag">ONEPICK / COMMENT QUALITY</span><h1>말투는 둘, 근거는 같은 선택</h1><p class="banner">${esc(banner)}</p>
<p>비교 ${comparison.pairs.length}쌍 · 예정 요청 합계 ${comparison.plannedCalls}회 · ${comparison.mode === 'mock' ? '모의 전송' : '기록된 실제 요청 시도'} ${comparison.attempts}회</p>
<p>이 보고서는 파일을 읽기만 합니다. 생성·재시도·프로필 게시를 실행하지 않습니다.</p>
<p><strong>T:</strong> 이유와 근거를 또렷하게. <strong>F:</strong> 같은 근거를 부드럽게. 어느 쪽도 독설·과장된 칭찬·나이 추정을 하지 않아야 합니다.</p>
<p>검토할 질문: 말투를 바꿨다는 이유로 다른 취향을 만들어내지는 않았나요? 위트는 없어도 괜찮습니다.</p></header>
${comparison.pairs.map((p) => `<section class="case"><small>${esc(p.key)}</small><h2>${esc(p.label)} · ${p.repetition}회차</h2>
<details><summary>근거 원픽 10개와 한줄평 펼치기</summary><table><thead><tr><th>번호</th><th>원픽</th><th>한줄평</th></tr></thead><tbody>${p.picks.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.category)} · ${esc(x.item)}</td><td>${esc(x.review)}</td></tr>`).join('')}</tbody></table></details>
<div class="columns">${column(p.direct, 'T · 담백한 해석', '나 T야. 근거부터 줘.')}${column(p.warm, 'F · 다정한 해석', '난 에뿌야. 살살해줭.')}</div>
<p class="review">문장 검토: <strong>미완료</strong> · 근거 번호, 공통 해석, 두 말투의 차이를 검토표에 기록합니다.${p.returnedModelMismatch ? ' 반환된 모델명이 달라 비교 조건 재확인이 필요합니다.' : ''}</p></section>`).join('')}
<footer><p>자동 형식 검사는 의미 품질 합격을 뜻하지 않습니다. 실패·미실행 칸도 유지하며 사용자나 MBTI에 점수를 매기지 않습니다.</p></footer></main></body></html>`;
}
function main(args = process.argv.slice(2)) {
  const options = {};
  for (const value of args) {
    const match = /^--(direct|warm|out)=(.+)$/.exec(value);
    check(match && !Object.hasOwn(options, match[1]), 'QA_TONE_ARGUMENT_INVALID'); options[match[1]] = match[2];
  }
  check(options.direct && options.warm && options.out, 'QA_TONE_ARGUMENT_REQUIRED');
  const read = (file) => { const stat = fs.statSync(file); check(stat.isFile() && stat.size <= 4000000, 'QA_TONE_FILE_INVALID'); return JSON.parse(fs.readFileSync(file, 'utf8')); };
  const comparison = compareToneRuns(read(options.direct), read(options.warm));
  const out = path.resolve(options.out); fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(out, { mode: 0o700 }); // Existing output directories are never reused.
  const write = (name, content) => fs.writeFileSync(path.join(out, name), content, { flag: 'wx', mode: 0o600 });
  write('comparison.json', JSON.stringify(comparison, null, 2) + '\n');
  write('review-template.json', JSON.stringify(reviewTemplate(comparison), null, 2) + '\n');
  write('report.html', renderReport(comparison));
  console.log(`T/F comparison: ${comparison.pairs.length} pairs; no network calls; human verdicts unfilled.`);
}
module.exports = { validateRun, compareToneRuns, reviewTemplate, renderReport, main };
if (require.main === module) { try { main(); } catch {
  console.error('T/F comparison stopped. Use two matching tone-labelled result files and a new output directory.');
  process.exitCode = 1;
} }
