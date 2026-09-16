const { readdirSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const files = readdirSync(__dirname)
  .filter((name) => /^test-.*\.cjs$/.test(name))
  .sort()
  .map((name) => path.join(__dirname, name));

if (files.length === 0) throw new Error('No regression checks found');

let failures = 0;
for (const file of files) {
  console.log(`Running ${path.basename(file)}`);
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) failures++;
}

console.log(`${files.length - failures}/${files.length} regression checks passed.`);
process.exitCode = failures === 0 ? 0 : 1;
