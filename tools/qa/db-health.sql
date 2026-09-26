-- Read-only aggregates for the daily QA DB health section (docs/daily-qa.md).
-- pg_stat_statements normalizes literals to $1/$2/... already; query text is
-- also truncated in db-health.mjs before it reaches the report.
select
  substring(query, 1, 200) as query_truncated,
  calls,
  round(total_exec_time::numeric, 2) as total_exec_ms,
  round(mean_exec_time::numeric, 2) as mean_exec_ms,
  round((100 * total_exec_time / nullif(sum(total_exec_time) over (), 0))::numeric, 2) as pct_total
from pg_stat_statements
order by total_exec_time desc
limit 10;
