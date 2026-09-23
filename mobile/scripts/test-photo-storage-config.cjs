const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const config = fs.readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8');
const marker = '[storage.buckets.item-photos]';
const start = config.indexOf(marker);
assert.notEqual(start, -1, 'item-photos bucket must be declared in config.toml');
const next = config.indexOf('\n[', start + marker.length);
const section = config.slice(start, next === -1 ? config.length : next);
assert.match(section, /public\s*=\s*true/, 'item-photos stays public');
assert.match(section, /allowed_mime_types\s*=\s*\[\s*"image\/jpeg"\s*\]/, 'item-photos remains JPEG-only');
assert.match(section, /file_size_limit\s*=\s*"5MiB"/, 'item-photos must enforce a 5 MiB per-object upload ceiling');
console.log('Photo Storage config checks passed: public JPEG bucket with a 5 MiB per-object cap.');
