// Summarizes what real testers hit in the last 24h / 8 days from
// client_error_events and product_analytics_events (aggregates only).
// Needs SUPABASE_ACCESS_TOKEN; without it the section says so and exits 0.
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ygoipwzakzdnkaaxyrgb';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const OUT_DIR = path.resolve(process.env.QA_OUT_DIR || 'qa-output');
const SQL = fs.readFileSync(new URL('./real-user-errors.sql', import.meta.url), 'utf8');

// Read-only endpoint only: never fall back to the read-write query endpoint.
async function runQuery() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query/read-only`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SQL }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Supabase Management API ${res.status}`);
  return res.json();
}

// context/error_code/platform are written by signed-in clients, so any tester
// can put arbitrary text there. This report feeds an automated Claude -> Codex
// chain; keep only identifier-shaped values so free text can never reach it.
const SAFE_CELL = /^[A-Za-z0-9_:./-]{1,80}$/;
function cell(value) {
  const text = String(value ?? '');
  return SAFE_CELL.test(text) ? text : '(비정상 값 — 원문 생략)';
}

function toMarkdown(rows) {
  const errors = rows.filter((r) => r.kind === 'client_error');
  const events = rows.filter((r) => r.kind === 'product_event');
  const lines = ['## 실사용자 오류·이벤트 (Supabase, 집계만)', ''];
  lines.push(errors.length
    ? ['| 화면/맥락 | 오류 코드 | 플랫폼 | 24시간 | 8일 |', '| --- | --- | --- | --- | --- |',
      ...errors.map((r) => `| ${cell(r.name)} | ${cell(r.detail)} | ${cell(r.platform)} | ${Number(r.last_24h)} | ${Number(r.last_8d)} |`)].join('\n')
    : '최근 8일 client_error_events 기록 없음.');
  lines.push('', '### 제품 이벤트 (사용량 참고)', '');
  lines.push(events.length
    ? ['| 이벤트 | 플랫폼 | 24시간 | 8일 |', '| --- | --- | --- | --- |',
      ...events.map((r) => `| ${cell(r.name)} | ${cell(r.platform)} | ${Number(r.last_24h)} | ${Number(r.last_8d)} |`)].join('\n')
    : '최근 8일 product_analytics_events 기록 없음.');
  return `${lines.join('\n')}\n`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let markdown;
  if (!TOKEN) {
    markdown = '## 실사용자 오류·이벤트\n\n`SUPABASE_ACCESS_TOKEN` 시크릿이 없어 건너뜀.\n';
  } else {
    try {
      markdown = toMarkdown(await runQuery());
    } catch (err) {
      markdown = `## 실사용자 오류·이벤트\n\n조회 실패: ${String(err?.message || err).slice(0, 200)}\n`;
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'real-user-errors.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  console.log(`===QA-REPORT-BEGIN===\n${markdown}===QA-REPORT-END===`);
}

main();
