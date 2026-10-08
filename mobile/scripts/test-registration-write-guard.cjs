// run-tests.cjs discovers every test-*.cjs, so required Mobile CI exercises the
// same offline safety tests as the manual registration workflow. No credentials.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, ['--test',
  path.resolve(__dirname, '../../tools/qa/registration-write-contract.test.mjs')],
{ stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status === 0 ? 0 : 1;
