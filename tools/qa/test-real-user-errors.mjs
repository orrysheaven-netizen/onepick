import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const scriptUrl = new URL('./real-user-errors.mjs', import.meta.url);
const requestPrefix = 'QA_TEST_REQUEST=';

function runReport(qaToken = '') {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onepick-qa-token-test-'));
  const reportPath = path.join(outDir, 'real-user-errors.md');
  try {
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      globalThis.fetch = async (url, options) => {
        console.log(${JSON.stringify(requestPrefix)} + JSON.stringify({
          url, method: options.method, authorization: options.headers.Authorization,
        }));
        return { ok: true, json: async () => [{
          kind: 'client_error', name: 'screen_home', detail: 'NETWORK_ERROR',
          platform: 'web', last_24h: 1, last_8d: 2,
        }] };
      };
      await import(${JSON.stringify(scriptUrl.href)});
    `], {
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        SUPABASE_ACCESS_TOKEN: 'dummy-deployment-token',
        SUPABASE_QA_ACCESS_TOKEN: qaToken,
        SUPABASE_PROJECT_REF: 'qa-test-project',
        QA_OUT_DIR: outDir,
        GITHUB_STEP_SUMMARY: '',
      },
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    return {
      report: fs.readFileSync(reportPath, 'utf8'),
      requests: child.stdout.split(/\r?\n/)
        .filter((line) => line.startsWith(requestPrefix))
        .map((line) => JSON.parse(line.slice(requestPrefix.length))),
    };
  } finally {
    if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
    fs.rmdirSync(outDir);
  }
}

test('deployment token alone cannot query or report user data', () => {
  const { report, requests } = runReport();
  assert.deepEqual(requests, []);
  assert.match(report, /SUPABASE_QA_ACCESS_TOKEN.*건너뜀/);
  assert.doesNotMatch(report, /screen_home|NETWORK_ERROR|dummy-deployment-token/);
});

test('dedicated QA token is sent only to the read-only query endpoint', () => {
  const { report, requests } = runReport('dummy-qa-token');
  assert.deepEqual(requests, [{
    url: 'https://api.supabase.com/v1/projects/qa-test-project/database/query/read-only',
    method: 'POST',
    authorization: 'Bearer dummy-qa-token',
  }]);
  assert.match(report, /\| screen_home \| NETWORK_ERROR \| web \| 1 \| 2 \|/);
  assert.doesNotMatch(report, /dummy-qa-token|dummy-deployment-token/);
});
