import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ygoipwzakzdnkaaxyrgb';
const OUTPUT = path.resolve(process.env.QA_ALERT_OUTPUT || 'qa-output/real-user-error-alerts.json');
const SQL = fs.readFileSync(new URL('./real-user-error-spikes.sql', import.meta.url), 'utf8');
const SAFE_CELL = /^[A-Za-z0-9_:./-]{1,80}$/;

function safeCell(value) {
  const text = String(value ?? '');
  return SAFE_CELL.test(text) ? text : 'redacted-invalid';
}

function count(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

export function evaluateRows(rows) {
  const byCode = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.kind !== 'client_error') continue;

    const code = safeCell(row.detail);
    const context = safeCell(row.name);
    const platform = safeCell(row.platform);
    const current = count(row.last_complete_hour);
    const baseline = count(row.error_code_same_hour_prev_7d);
    const previous7d = count(row.error_code_prev_7d);

    let item = byCode.get(code);
    if (!item) {
      item = {
        errorCode: code,
        currentCount: 0,
        baselineSameHourTotal: 0,
        previous7dCount: 0,
        currentLocations: [],
        windowStart: row.current_hour_start ?? null,
        windowEnd: row.current_hour_end ?? null,
      };
      byCode.set(code, item);
    }

    item.currentCount += current;
    item.baselineSameHourTotal = Math.max(item.baselineSameHourTotal, baseline);
    item.previous7dCount = Math.max(item.previous7dCount, previous7d);
    item.windowStart ||= row.current_hour_start ?? null;
    item.windowEnd ||= row.current_hour_end ?? null;

    if (current > 0) {
      item.currentLocations.push({ context, platform, count: current });
    }
  }

  const alerts = [];
  for (const item of byCode.values()) {
    if (item.currentCount <= 0) continue;

    const baselineAverage = item.baselineSameHourTotal / 7;
    const isNew = item.previous7dCount === 0;
    const isSpike = item.currentCount > baselineAverage * 3;
    if (!isNew && !isSpike) continue;

    item.currentLocations.sort((a, b) => b.count - a.count || a.context.localeCompare(b.context));
    alerts.push({
      key: `error-code:${item.errorCode}`,
      errorCode: item.errorCode,
      reasons: [isNew ? 'new_error_code' : null, isSpike ? 'three_x_spike' : null].filter(Boolean),
      currentCount: item.currentCount,
      baselineAverage: round2(baselineAverage),
      previous7dCount: item.previous7dCount,
      ratio: baselineAverage === 0 ? null : round2(item.currentCount / baselineAverage),
      windowStart: item.windowStart,
      windowEnd: item.windowEnd,
      locations: item.currentLocations.slice(0, 5),
    });
  }

  alerts.sort((a, b) => b.currentCount - a.currentCount || a.errorCode.localeCompare(b.errorCode));
  return alerts;
}

export async function runQuery() {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required');
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query/read-only`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SQL }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Supabase Management API ${res.status}`);
  return res.json();
}

async function main() {
  const rows = await runQuery();
  const alerts = evaluateRows(rows);
  const report = {
    generatedAt: new Date().toISOString(),
    projectRef: PROJECT_REF,
    alertCount: alerts.length,
    alerts,
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Real-user error alert evaluation: ${alerts.length} alert(s).`);
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((err) => {
    console.error(`real-user error alert evaluation failed: ${String(err?.message || err).slice(0, 160)}`);
    process.exit(1);
  });
}
