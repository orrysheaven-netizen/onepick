const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const registry = fs.readFileSync(path.join(root, 'docs/decisions/locked-contracts.yml'), 'utf8');

const requiredLocked = ['UI-BOTTOM-001', 'UI-BG-001', 'UX-NAV-001'];
for (const id of requiredLocked) {
  const block = registry.match(new RegExp(`- id: ${id}\\n([\\s\\S]*?)(?=\\n  - id:|$)`));
  if (!block || !/status: locked/.test(block[1])) {
    throw new Error(`${id} must remain locked`);
  }
}

const swipe = registry.match(/- id: UX-SWIPE-001\n([\s\S]*?)(?=\n  - id:|$)/);
if (!swipe || !/status: (staged|locked)/.test(swipe[1])) {
  throw new Error('UX-SWIPE-001 must remain registered as staged or locked');
}

const checks = [
  ['UI-BOTTOM-001 + UI-BG-001', 'mobile', ['scripts/test-brand-controls.cjs']],
  ['UX-NAV-001', 'mobile', ['scripts/test-profile-tab-stack.cjs']],
];

for (const [label, cwd, args] of checks) {
  const result = spawnSync(process.execPath, args, {
    cwd: path.join(root, cwd),
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Locked contract failed: ${label}`);
  }
}

console.log('Locked Contracts: active contracts passed.');
console.log('UX-SWIPE-001: staged; activation requires the approved restoration on main.');
