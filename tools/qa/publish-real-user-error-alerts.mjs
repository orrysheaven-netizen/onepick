import fs from 'node:fs';

const reportPath = process.env.QA_ALERT_OUTPUT;
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

if (!reportPath || !repository || !token) {
  throw new Error('QA_ALERT_OUTPUT, GITHUB_REPOSITORY and GITHUB_TOKEN are required');
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const [owner, repo] = repository.split('/');
const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
};

async function request(apiPath, options = {}) {
  const res = await fetch(`${apiBase}${apiPath}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${apiPath}`);
  if (res.status === 204) return null;
  return res.json();
}

async function loadOpenQaAlerts() {
  const issues = [];
  for (let page = 1; ; page += 1) {
    const batch = await request(`/issues?state=open&labels=qa-alert&per_page=100&page=${page}`);
    issues.push(...batch.filter((issue) => !issue.pull_request));
    if (batch.length < 100) return issues;
  }
}

function alertBody(alert) {
  const marker = `<!-- onepick-real-user-error:${alert.key} -->`;
  const reason = alert.reasons.includes('new_error_code')
    ? 'A new error_code appeared in the last completed hour.'
    : 'The error count exceeded 3× the previous seven matching-hour average.';
  const ratio = alert.ratio == null ? 'baseline 0' : `${alert.ratio}×`;
  const locations = alert.locations.length
    ? alert.locations.map((x) => `- ${x.context} / ${x.platform}: ${x.count}`).join('\n')
    : '- none';
  const workflowUrl = `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;

  return `${marker}\n\n${reason}\n\n` +
    `- error_code: \`${alert.errorCode}\`\n` +
    `- last completed hour: ${alert.windowStart ?? '-'} → ${alert.windowEnd ?? '-'}\n` +
    `- count: ${alert.currentCount}\n` +
    `- previous 7 matching-hour average: ${alert.baselineAverage}\n` +
    `- ratio: ${ratio}\n` +
    `- previous 7 days total for this error_code: ${alert.previous7dCount}\n` +
    `- current locations:\n${locations}\n\n` +
    `Workflow: ${workflowUrl}\n\n` +
    'This check used the Supabase read-only query endpoint. No database mutation was attempted.';
}

const issues = await loadOpenQaAlerts();
for (const alert of report.alerts ?? []) {
  const marker = `<!-- onepick-real-user-error:${alert.key} -->`;
  const body = alertBody(alert);
  const existing = issues.find((issue) => (issue.body || '').includes(marker));

  if (existing) {
    await request(`/issues/${existing.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  } else {
    const created = await request('/issues', {
      method: 'POST',
      body: JSON.stringify({
        title: `[qa-alert] Real-user error: ${alert.errorCode}`,
        body,
        labels: ['qa-alert'],
      }),
    });
    issues.push(created);
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Real-user error alerts\n- Alerts this run: ${report.alertCount ?? 0}\n`);
}
