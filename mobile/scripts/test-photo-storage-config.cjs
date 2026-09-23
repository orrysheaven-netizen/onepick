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
assert.doesNotMatch(section, /file_size_limit\s*=/, 'item-photos must inherit the project storage limit instead of a 768 KiB cap');
console.log('Photo Storage config checks passed: public JPEG bucket with a 5 MiB per-object cap.');
