// Read-only DB health section for the daily QA report (docs/daily-qa.md, G-점검).
// Pulls Supabase's own performance/security advisors and the top slow
// statements from pg_stat_statements — aggregates only, no per-user data.
// Needs SUPABASE_ACCESS_TOKEN; without it the section says so and exits 0.
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ygoipwzakzdnkaaxyrgb';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const OUT_DIR = path.resolve(process.env.QA_OUT_DIR || 'qa-output');
const SLOW_STATEMENTS_SQL = fs.readFileSync(new URL('./db-health.sql', import.meta.url), 'utf8');
const MGMT_API = 'https://api.supabase.com/v1';
const LEVEL_ORDER = { ERROR: 0, WARN: 1, INFO: 2 };

// Advisor text and query text come from Supabase's own analysis, not directly
// from user input, but table cells still get flattened/truncated so a stray
// pipe or newline can never break the markdown table or blow up the report.
function mdCell(value, max = 160) {
  const text = String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text || '-';
}

async function fetchAdvisors(kind) {
  const res = await fetch(`${MGMT_API}/projects/${PROJECT_REF}/advisors/${kind}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`advisors/${kind} ${res.status}`);
  const json = await res.json();
  const lints = json?.lints ?? json?.result ?? (Array.isArray(json) ? json : []);
  return lints
    .map((l) => ({
      level: String(l.level || l.severity || 'INFO').toUpperCase(),
      title: l.title || l.name || l.cache_key || '(제목 없음)',
      detail: l.detail || l.description || '',
      entity: l.metadata?.name || l.metadata?.schema || '',
    }))
    .sort((a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9));
}

// Read-only endpoint only: never fall back to the read-write query endpoint.
async function fetchSlowStatements() {
  const res = await fetch(`${MGMT_API}/projects/${PROJECT_REF}/database/query/read-only`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SLOW_STATEMENTS_SQL }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`pg_stat_statements query ${res.status}`);
  return res.json();
}

// A failed lookup is not "nothing found": the section must say it has no result,
// otherwise a 403/expired token reads as a clean bill of health (#605).
function failedSection(title, failure) {
  return [`### ${title}`, '', `**조회 실패 — 결과 없음(안전하다는 뜻이 아님).** ${failure}`, ''];
}

function advisorSection(title, lints, failure) {
  if (failure) return failedSection(title, failure);
  const lines = [`### ${title}`, ''];
  if (!lints.length) {
    lines.push('발견 사항 없음.', '');
    return lines;
  }
  lines.push(
    '| 수준 | 항목 | 대상 | 설명 |',
    '| --- | --- | --- | --- |',
    ...lints.slice(0, 15).map((l) => `| ${mdCell(l.level, 10)} | ${mdCell(l.title, 60)} | ${mdCell(l.entity, 40)} | ${mdCell(l.detail, 160)} |`),
    '',
  );
  if (lints.length > 15) lines.push(`(그 외 ${lints.length - 15}건 생략)`, '');
  return lines;
}

function slowStatementsSection(rows, failure) {
  const title = '느린 쿼리 상위 (pg_stat_statements)';
  if (failure) return failedSection(title, failure);
  const lines = [`### ${title}`, ''];
  if (!rows.length) {
    lines.push('pg_stat_statements 기록 없음 (확장 비활성 또는 통계 없음).', '');
    return lines;
  }
  lines.push(
    '| 총 실행시간(ms) | 평균(ms) | 호출 수 | 비중(%) | 쿼리 (정규화·200자 절삭) |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${mdCell(r.total_exec_ms)} | ${mdCell(r.mean_exec_ms)} | ${mdCell(r.calls)} | ${mdCell(r.pct_total)} | ${mdCell(r.query_truncated, 200)} |`),
    '',
  );
  return lines;
}

async function buildMarkdown() {
  const lines = ['## DB 점검 (Supabase advisors, 읽기 전용)', ''];
  const failures = {};

  async function attempt(key, label, fn, fallback) {
    try {
      return await fn();
    } catch (err) {
      failures[key] = `${label} 조회 실패: ${String(err?.message || err).slice(0, 200)}`;
      return fallback;
    }
  }

  const performance = await attempt('performance', '성능 advisor', () => fetchAdvisors('performance'), []);
  const security = await attempt('security', '보안 advisor', () => fetchAdvisors('security'), []);
  const slowStatements = await attempt('slow', '느린 쿼리', fetchSlowStatements, []);

  const failed = Object.values(failures);
  if (failed.length) {
    lines.push(`> **주의:** ${failed.length}개 섹션을 조회하지 못했습니다. "조회 실패"로 표시된 섹션은 "문제 없음"이 아니라 "확인하지 못함"입니다.`, '');
  }
  lines.push(...advisorSection('성능 advisor', performance, failures.performance));
  lines.push(...advisorSection('보안 advisor', security, failures.security));
  lines.push(...slowStatementsSection(slowStatements, failures.slow));
  return lines.join('\n');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let markdown;
  if (!TOKEN) {
    markdown = '## DB 점검\n\n`SUPABASE_ACCESS_TOKEN` 시크릿이 없어 건너뜀.\n';
  } else {
    markdown = await buildMarkdown();
  }
  fs.writeFileSync(path.join(OUT_DIR, 'db-health.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  console.log(`===QA-REPORT-BEGIN===\n${markdown}\n===QA-REPORT-END===`);
}

main();
