const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const functionsDir = path.join(root, 'supabase', 'functions');
const config = fs.readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8');

const directories = fs.readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const expected = new Map([
  ['analyze-profile-taste', false],
  ['book-catalog', false],
  ['delete-account', false],
  ['game-catalog', false],
  ['import-item-image', true],
  ['movie-catalog', false],
  ['music-catalog', false],
  ['pokemon-catalog', false],
  ['profile-ai-status', false],
  ['sbiz-place-catalog', false],
  ['suggest-item-categories', false],
  ['youtube-catalog', true],
]);

assert.deepEqual(directories, [...expected.keys()].sort(),
  'Every Edge Function folder must be reviewed in the explicit auth-mode test');

for (const [name, verifyJwt] of expected) {
  const marker = '[functions.' + name + ']';
  const start = config.indexOf(marker);
  assert.notEqual(start, -1, 'Missing explicit config for ' + name);
  const next = config.indexOf('\n[', start + marker.length);
  const section = config.slice(start, next === -1 ? config.length : next);
  assert.match(section, new RegExp('verify_jwt\\s*=\\s*' + String(verifyJwt) + '(?:\\s|$)'),
    name + ' verify_jwt must be explicitly ' + verifyJwt);
}

assert.doesNotMatch(config, /\[functions\.import-product-image\]/,
  'Legacy image-import function name must not return');

console.log('Edge Function config checks passed: every function has an explicit, reviewed verify_jwt mode.');
