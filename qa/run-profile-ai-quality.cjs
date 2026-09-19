#!/usr/bin/env node
// Offline by default. This CLI never reads member data or writes to OnePick DB.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { loadProduction, sha256 } = require('./profile-ai-runtime.cjs');
const dataset = require('./profile-ai-quality-cases.cjs');
const ENDPOINT = 'https://api.openai.com/v1/responses';
const MAX_CALLS = 24;
const MAX_RESPONSE_BYTES = 262144;
const clone = (value) => JSON.parse(JSON.stringify(value));
const integer = (x, low, high) => Number.isSafeInteger(x) && x >= low && x <= high;
const assert = (value, code) => { if (!value) throw new Error(code); };
const humanChecks = ['noAgeOrSensitiveInference', 'respectfulTone', 'groundedInReasons',
  'consistentWithAllPicks', 'personalizedToReasons', 'readable', 'humorOptionalAndRespectful'];

function createPlan(runtime, repeats = 3) {
  assert(integer(repeats, 1, 3), 'QA_REPEATS_1_TO_3');
  assert(dataset.synthetic === true && dataset.minimumPicks === 10 && runtime.minimumPicks === 10,
    'QA_SYNTHETIC_TEN_PICK_DATA_REQUIRED');
  assert(dataset.cases.length > 0 && dataset.cases.length * repeats <= MAX_CALLS, 'QA_CALL_LIMIT');
  const seen = new Set();
  const cases = dataset.cases.map((entry) => {
    assert(/^[a-z0-9-]+$/.test(entry.id) && !seen.has(entry.id), 'QA_CASE_ID_INVALID'); seen.add(entry.id);
    assert(entry.picks.length === 10 && new Set(entry.picks.map((p) => p.category)).size === 10,
      'QA_TEN_DISTINCT_CATEGORIES_REQUIRED');
    for (const pick of entry.picks) {
      assert(['category', 'item', 'review'].every((k) => typeof pick[k] === 'string' && pick[k].trim()), 'QA_PICK_INVALID');
      assert(pick.review.length <= 100, 'QA_REVIEW_TOO_LONG');
    }
    // ONLY picks go through the production builder. Targets and evaluator notes
    // are kept alongside the report, never inserted into the provider request.
    const request = runtime.build(entry.picks);
    return { id: entry.id, label: entry.label, pair: entry.pair ?? null,
      picks: clone(entry.picks), expectations: clone(entry.expectations),
      inputHash: sha256(request.input), requestHash: sha256(JSON.stringify(request)) };
  });
  // Input comparability must survive prompt/model/schema changes.
  const datasetHash = sha256(JSON.stringify(cases.map(({ requestHash, ...entry }) => entry)));
  const fingerprint = sha256(JSON.stringify({ datasetHash, repeats, sources: runtime.sourceHashes }));
  return { schemaVersion: 1, synthetic: true, fingerprint, datasetHash, repeats,
    createdAt: new Date().toISOString(), model: runtime.model, promptVersion: runtime.promptVersion,
    promptHash: runtime.promptHash, schemaHash: runtime.schemaHash,
    sourceHashes: runtime.sourceHashes, contractVersion: runtime.contractVersion,
    maximumCalls: cases.length * repeats, maximumOutputTokensPerCall: runtime.maxOutputTokens,
    maximumOutputTokensTotal: cases.length * repeats * runtime.maxOutputTokens,
    inputTokensAndPrice: 'not_estimated', cases };
}
function emptyRun(plan, mode = 'plan') {
  return { schemaVersion: 1, mode, plan: clone(plan), providerCallsAttempted: 0,
    qualityVerdict: 'not_evaluated', startedAt: null, finishedAt: null,
    rows: plan.cases.flatMap((entry) => Array.from({ length: plan.repeats }, (_, index) => ({
      key: `${entry.id}#${index + 1}`, caseId: entry.id, repetition: index + 1,
      inputHash: entry.inputHash, requestHash: entry.requestHash,
      status: 'not_attempted', comment: null, automaticCheck: 'not_run', warnings: [],
      durationMs: null, usage: null, responseId: null, actualModel: null,
    }))) };
}
function usageOf(value) {
  if (!value || typeof value !== 'object') return null;
  const number = (x) => integer(x, 0, 1000000000) ? x : null;
  return { inputTokens: number(value.input_tokens), outputTokens: number(value.output_tokens),
    totalTokens: number(value.total_tokens), cachedInputTokens: number(value.input_tokens_details?.cached_tokens),
    reasoningTokens: number(value.output_tokens_details?.reasoning_tokens) };
}
function safeProviderId(value, pattern) {
  return typeof value === 'string' && value.length <= 120 && pattern.test(value) ? value : null;
}
async function boundedResponse(fetcher, request, key, timeoutMs) {
  const controller = new AbortController(); let timer;
  const interrupted = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('QA_TIMEOUT')); }, timeoutMs);
  });
  const task = (async () => {
    const response = await fetcher(ENDPOINT, { method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      // Never retain provider error bodies, headers or arbitrary error messages.
      return { httpError: integer(response.status, 100, 599) ? response.status : 0 };
    }
    assert(response.body && typeof response.body.getReader === 'function', 'QA_RESPONSE_INVALID');
    const reader = response.body.getReader(); const parts = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) {
          void reader.cancel().catch(() => {}); throw new Error('QA_RESPONSE_TOO_LARGE');
        }
        parts.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    try { return { payload: JSON.parse(Buffer.concat(parts).toString('utf8')) }; }
    catch { throw new Error('QA_INVALID_ENVELOPE'); }
  })();
  try { return await Promise.race([task, interrupted]); }
  finally { clearTimeout(timer); controller.abort(); }
}
const safeFailure = (error) => new Set(['QA_TIMEOUT', 'QA_RESPONSE_TOO_LARGE', 'QA_INVALID_ENVELOPE',
  'QA_RESPONSE_INVALID', 'QA_INCOMPLETE', 'QA_REFUSED_OR_EMPTY', 'QA_INVALID_JSON',
  'QA_SCHEMA_FAILED', 'QA_SECRET_ECHO_REDACTED', 'AI_REVIEW_AGE_EXCLUDED']).has(error?.message) ? error.message : 'QA_TRANSPORT_OR_VALIDATION_FAILED';

async function execute(plan, runtime, options) {
  const { mode, approvedCalls, key, fetcher, checkpoint = () => {}, timeoutMs = 20000, ci = false } = options;
  assert(mode === 'live' || mode === 'mock', 'QA_MODE_INVALID');
  assert(!(mode === 'live' && (ci || fetcher)), 'QA_LIVE_CI_OR_CUSTOM_TRANSPORT_FORBIDDEN');
  assert(typeof key === 'string' && key.trim() && !/[\r\n]/.test(key), 'QA_KEY_REQUIRED');
  assert(approvedCalls === plan.maximumCalls && integer(approvedCalls, 1, MAX_CALLS), 'QA_EXPLICIT_CALL_APPROVAL_REQUIRED');
  assert(integer(timeoutMs, 1, 20000), 'QA_TIMEOUT_INVALID');
  // A saved/edited plan cannot expand the request count or substitute sources.
  const fresh = createPlan(runtime, plan.repeats);
  assert(plan.fingerprint === fresh.fingerprint && JSON.stringify(plan.cases) === JSON.stringify(fresh.cases), 'QA_PLAN_CHANGED');
  const run = emptyRun(fresh, mode); run.startedAt = new Date().toISOString();
  run.qualityVerdict = mode === 'mock' ? 'mock_not_model_quality' : 'human_review_required';
  await checkpoint(clone(run));
  for (const row of run.rows) {
    const entry = fresh.cases.find((x) => x.id === row.caseId);
    const request = runtime.build(entry.picks);
    assert(row.requestHash === sha256(JSON.stringify(request)), 'QA_REQUEST_CHANGED');
    run.providerCallsAttempted++; row.status = 'attempted'; const start = performance.now();
    // Persist the attempt BEFORE sending. A crashed attempt is never assumed
    // unbilled or automatically resumed/retried by this tool.
    await checkpoint(clone(run));
    let stop = false;
    try {
      const result = await boundedResponse(fetcher ?? global.fetch, request, key.trim(), timeoutMs);
      if (result.httpError !== undefined) { row.status = `http_${result.httpError}`; stop = true; }
      else {
        const envelope = result.payload;
        row.usage = usageOf(envelope?.usage);
        row.responseId = safeProviderId(envelope?.id, /^resp_[A-Za-z0-9_-]+$/);
        row.actualModel = safeProviderId(envelope?.model, /^[A-Za-z0-9._:-]+$/);
        if (row.responseId?.includes(key.trim())) row.responseId = null;
        if (row.actualModel?.includes(key.trim())) row.actualModel = null;
        try {
          row.comment = runtime.validate(envelope);
          if (JSON.stringify(row.comment).includes(key.trim())) {
            row.comment = null; throw new Error('QA_SECRET_ECHO_REDACTED');
          }
          row.status = 'output_received'; row.automaticCheck = 'pass';
          const body = row.comment.body;
          if (body.length < 200 || body.length > 450) row.warnings.push('length_target_review');
          if (/(수준이 낮|고집이 세|취향이 없|성의 없|유행만 따|까다롭)/u.test(JSON.stringify(row.comment))) {
            row.warnings.push('tone_requires_human_review');
          }
        } catch (error) { row.status = safeFailure(error); row.automaticCheck = 'fail'; }
      }
    } catch (error) { row.status = safeFailure(error); stop = true; }
    row.durationMs = Math.max(0, Math.round(performance.now() - start));
    await checkpoint(clone(run));
    if (stop) break; // No backoff retries, model fallback or hidden paid calls.
  }
  run.finishedAt = new Date().toISOString();
  await checkpoint(clone(run));
  return run;
}
function overlap(left, right) {
  const grams = (text) => {
    const chars = [...text.normalize('NFKC').replace(/[\s\p{P}]/gu, '')];
    return new Set(chars.length < 3 ? [chars.join('')] : chars.slice(2).map((_, i) => chars.slice(i, i + 3).join('')));
  };
  const a = grams(left), b = grams(right), union = new Set([...a, ...b]);
  return union.size ? [...a].filter((g) => b.has(g)).length / union.size : 1;
}
function pairing(run) {
  const groups = new Map();
  for (const entry of run.plan.cases) if (entry.pair) groups.set(entry.pair, [...(groups.get(entry.pair) ?? []), entry.id]);
  return [...groups].flatMap(([pair, ids]) => {
    if (ids.length !== 2) return [];
    return Array.from({ length: run.plan.repeats }, (_, i) => {
      const rows = ids.map((id) => run.rows.find((r) => r.caseId === id && r.repetition === i + 1));
      const similarity = rows.every((r) => r?.comment) ? overlap(rows[0].comment.body, rows[1].comment.body) : null;
      return { pair, repetition: i + 1, textOverlap: similarity,
        reviewHint: similarity === null ? 'not_measured' : similarity >= 0.75 ? 'similar_wording_review' : 'compare_meaning_manually' };
    });
  });
}
function reviewTemplate(run) {
  return { schemaVersion: 1, runFingerprint: run.plan.fingerprint, mode: run.mode,
    meaningQualityNotAutomaticallyGraded: true,
    rows: run.rows.map((row) => ({ key: row.key,
      outputHash: row.comment ? sha256(JSON.stringify(row.comment)) : null,
      reviewer: null, reviewedAt: null, verdict: null,
      checks: Object.fromEntries(humanChecks.map((key) => [key, null])),
      evidence: [], notes: '' })), pairReviews: pairing(run).map((pair) => ({ ...pair, verdict: null, notes: '' })) };
}
function compareRuns(baseline, candidate) {
  const valid = (run) => run?.schemaVersion === 1 && ['live', 'mock'].includes(run.mode) &&
    Array.isArray(run.rows) && run.rows.length === run.plan?.maximumCalls &&
    new Set(run.rows.map((x) => x.key)).size === run.rows.length &&
    run.rows.every((row) => ['pass', 'fail', 'not_run'].includes(row.automaticCheck));
  assert(valid(baseline) && valid(candidate), 'QA_COMPARE_MEASURED_RUNS_REQUIRED');
  assert(baseline.mode === candidate.mode && baseline.plan.datasetHash === candidate.plan.datasetHash &&
    baseline.plan.repeats === candidate.plan.repeats, 'QA_COMPARE_INPUTS_MUST_MATCH');
  return { schemaVersion: 1, mode: candidate.mode, humanMeaningVerdict: 'not_automatically_graded',
    baseline: baseline.plan.fingerprint, candidate: candidate.plan.fingerprint,
    baselineModel: baseline.plan.model, candidateModel: candidate.plan.model,
    rows: candidate.rows.map((row) => {
      const prior = baseline.rows.find((x) => x.key === row.key);
      assert(prior && prior.inputHash === row.inputHash, 'QA_COMPARE_INPUTS_MUST_MATCH');
      return { key: row.key, before: prior.status, after: row.status,
        automaticBefore: prior.automaticCheck, automaticAfter: row.automaticCheck,
        durationDeltaMs: prior.durationMs === null || row.durationMs === null ? null : row.durationMs - prior.durationMs,
        textOverlap: prior.comment && row.comment ? overlap(prior.comment.body, row.comment.body) : null };
    }) };
}
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
function renderReport(run) {
  const banner = run.mode === 'plan' ? '실행 계획 · 실제 모델 호출 0 · 문장 품질 미측정'
    : run.mode === 'mock' ? '모의 응답 검증 · 실제 모델 품질 미측정' : '실제 모델 출력 · 사람의 문장 검토 필요';
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>OnePick AI 품질 검토</title><style>body{font:15px/1.65 system-ui,sans-serif;max-width:1050px;margin:40px auto;padding:0 20px}h1{font-size:28px}section{border:1px solid;border-radius:12px;margin:28px 0;padding:24px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid;padding:8px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{display:block}summary{cursor:pointer}@media(max-width:600px){section{padding:14px}th,td{padding:5px}}</style>
<h1>OnePick AI · 원픽 10개 품질 검토</h1><p><strong>${banner}</strong></p>
<p>예정 ${run.plan.maximumCalls}회 / ${run.mode === 'mock' ? '모의 전송' : '실제 요청 시도'} ${run.providerCallsAttempted}회. 자동 형식·나이 검사 통과는 의미 품질 합격이 아닙니다.</p>
<p>${escape(run.plan.model)} · ${escape(run.plan.promptVersion)} · 입력 원본 및 작성 규칙의 SHA-256을 results.json에 기록합니다.</p>
<p>검토 기준: 한줄평의 근거, 전체 선택과의 일관성, 이유에 따른 개인화, 존중하는 말투, 읽기 쉬움, 선택에 근거한 위트. 위트 생략은 실패가 아닙니다.</p>
${run.plan.cases.map((entry) => `<section><h2>${escape(entry.label)}</h2><small>${escape(entry.id)}</small>
<details><summary>입력 원픽 10개와 한줄평</summary><table><tr><th>번호</th><th>원픽</th><th>선택 이유</th></tr>${entry.picks.map((p, i) => `<tr><td>${i + 1}</td><td>${escape(p.category)} · ${escape(p.item)}</td><td>${escape(p.review)}</td></tr>`).join('')}</table></details>
<p>검토할 점: ${entry.expectations.map(escape).join(' / ')}</p>
${run.rows.filter((r) => r.caseId === entry.id).map((r) => `<h3>${r.repetition}회차 · ${escape(r.status)}</h3><small>자동 검사: ${escape(r.automaticCheck)} · 시간: ${r.durationMs === null ? '미측정' : r.durationMs + 'ms'} · 사용량: ${r.usage ? escape(JSON.stringify(r.usage)) : '미측정'}</small>
${r.comment ? `<strong>${escape(r.comment.summary)}</strong><pre>${escape(r.comment.body)}</pre><p>${r.comment.keywords.map(escape).join(' · ')}</p>` : '<p>표시할 모델 결과 없음. 기준 예시를 실제 결과로 채워 넣지 않습니다.</p>'}
<p>문장 검토: 미완료${r.warnings.length ? ' · 확인 필요: ' + r.warnings.map(escape).join(', ') : ''}</p>`).join('')}</section>`).join('')}
<h2>같은 제품 · 다른 이유 비교</h2><pre>${escape(JSON.stringify(pairing(run), null, 2))}</pre>
<p>문자 중복률은 검토 보조 신호입니다. 의미상의 동일함이나 개인화 성공을 자동 판정하지 않습니다. review-template.json에 근거 원픽 번호와 검토 의견을 기록하세요.</p></html>`;
}
function prepareDirectory(output) {
  assert(typeof output === 'string' && output.length > 0, 'QA_OUTPUT_DIRECTORY_REQUIRED');
  const directory = path.resolve(output);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory); // Existing run folders are never reused/overwritten.
  return directory;
}
function saveRun(directory, run, final = false) {
  const target = path.join(directory, 'results.json');
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(run, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(`${target}.tmp`, target);
  if (final) {
    fs.writeFileSync(path.join(directory, 'report.html'), renderReport(run), { mode: 0o600 });
    fs.writeFileSync(path.join(directory, 'review-template.json'), JSON.stringify(reviewTemplate(run), null, 2) + '\n', { mode: 0o600 });
  }
}
async function main(argv = process.argv.slice(2), env = process.env) {
  const [command = 'plan', ...args] = argv; const options = {};
  assert(['plan', 'run', 'compare'].includes(command), 'QA_COMMAND_INVALID');
  for (const arg of args) {
    const match = /^--(repeats|out|confirm-live-calls|baseline|candidate)=(.+)$/.exec(arg);
    assert(match && options[match[1]] === undefined, 'QA_ARGUMENT_INVALID'); options[match[1]] = match[2];
  }
  assert(options.out, 'QA_OUTPUT_DIRECTORY_REQUIRED');
  if (command === 'compare') {
    assert(options.baseline && options.candidate && !options.repeats && !options['confirm-live-calls'], 'QA_ARGUMENT_INVALID');
    const readRun = (file) => { assert(fs.statSync(file).size <= 4000000, 'QA_REPORT_TOO_LARGE'); return JSON.parse(fs.readFileSync(file, 'utf8')); };
    const comparison = compareRuns(readRun(options.baseline), readRun(options.candidate));
    const directory = prepareDirectory(options.out);
    fs.writeFileSync(path.join(directory, 'comparison.json'), JSON.stringify(comparison, null, 2) + '\n', { mode: 0o600 });
    console.log('Comparison written; semantic quality is not automatically graded.'); return;
  }
  assert(!options.baseline && !options.candidate && (command === 'run' || !options['confirm-live-calls']), 'QA_ARGUMENT_INVALID');
  const runtime = loadProduction(); const plan = createPlan(runtime, options.repeats === undefined ? 3 : Number(options.repeats));
  if (command === 'plan') {
    const directory = prepareDirectory(options.out); saveRun(directory, emptyRun(plan), true);
    console.log(`Plan only: ${plan.maximumCalls} planned, 0 provider calls, quality NOT measured.`); return;
  }
  assert(!env.CI, 'QA_LIVE_DISABLED_IN_CI');
  assert(Number(options['confirm-live-calls']) === plan.maximumCalls, 'QA_EXPLICIT_CALL_APPROVAL_REQUIRED');
  // The key is read ONLY after the operator explicitly selects paid execution.
  const key = env.OPENAI_API_KEY;
  assert(typeof key === 'string' && key.trim() && !/[\r\n]/.test(key), 'QA_KEY_REQUIRED');
  const directory = prepareDirectory(options.out);
  const run = await execute(plan, runtime, { mode: 'live', approvedCalls: plan.maximumCalls, key,
    checkpoint: (value) => saveRun(directory, value) });
  saveRun(directory, run, true);
  console.log(`Provider attempts: ${run.providerCallsAttempted}/${plan.maximumCalls}; human review required.`);
  if (run.rows.some((row) => row.status !== 'output_received' || row.automaticCheck !== 'pass')) process.exitCode = 2;
}
module.exports = { createPlan, emptyRun, execute, compareRuns, renderReport, reviewTemplate, pairing, usageOf, main };
if (require.main === module) main().catch(() => {
  // Do not echo arguments, stack traces, paths containing keys or provider data.
  console.error('QA stopped. Check command, explicit call approval, dependencies and output directory. No automatic retry.');
  process.exitCode = 1;
});
