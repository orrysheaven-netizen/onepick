const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../src');
const violations = [];

function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const normalized = full.replaceAll('\\', '/');
      if (/\/(?:app|components)\/admin(?:\/|$)/.test(normalized)) continue;
      visit(full);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    const rel = path.relative(root, full).replaceAll('\\', '/');
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.includes('OnePick.hint') && !line.includes('OnePick.textTertiary')) return;
      const allowed = /placeholderTextColor|chevron|Chevron|arrow|Arrow|actionDot|clearText|borderColor|stroke=|inactiveIcon|InactiveIcon/.test(line);
      if (!allowed) violations.push(`${rel}:${index + 1}: ${line.trim()}`);
    });
  }
}

visit(root);
assert.deepEqual(violations, [], 'tertiary is reserved for placeholders, inactive icons, chevrons and decorative borders');
console.log('PASS tertiary usage stays non-copy on user-facing surfaces');
