const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Pick targets are not only products (restaurants, movies, books, games, songs, channels…),
// so user-facing copy must not call them "제품"/"상품". Admin-only surfaces are out of scope.
const srcRoot = path.join(__dirname, '../src');
const scannedDirs = ['app', 'components', 'lib', 'services', 'errors', 'hooks'];
const adminPath = /^(app\/admin\/|components\/admin|lib\/admin)/;

// Each entry: [file relative to src, substring on the offending line, reason].
const allowlist = [
  ['lib/items/itemIdentity.ts', "slug === 'ramen'", 'packaged-food category hint, genuinely about products'],
  ['lib/items/itemIdentity.ts', "slug === 'beer'", 'packaged-food category hint, genuinely about products'],
  ['lib/items/itemIdentity.ts', "slug === 'soju'", 'packaged-food category hint, genuinely about products'],
  ['lib/items/itemIdentity.ts', "slug === 'snacks'", 'packaged-food category hint, genuinely about products'],
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(source) {
  // Keep line numbers stable: blank out block comments but keep their newlines.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1');
}

const used = new Set();
const offenders = [];
for (const dir of scannedDirs) {
  for (const file of walk(path.join(srcRoot, dir))) {
    const rel = path.relative(srcRoot, file).split(path.sep).join('/');
    if (adminPath.test(rel)) continue;
    stripComments(fs.readFileSync(file, 'utf8')).split(/\r?\n/).forEach((line, index) => {
      if (!/제품|상품/.test(line)) return;
      const allowed = allowlist.findIndex(([allowedFile, marker]) => allowedFile === rel && line.includes(marker));
      if (allowed >= 0) { used.add(allowed); return; }
      offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
    });
  }
}

assert.deepEqual(offenders, [], `User-facing copy must not say 제품/상품; drop the noun instead:\n${offenders.join('\n')}`);
const stale = allowlist.filter((_, index) => !used.has(index));
assert.deepEqual(stale, [], 'Remove allowlist entries that no longer match anything');

console.log('Neutral item wording checks passed: non-admin screens do not call pick targets 제품/상품.');
