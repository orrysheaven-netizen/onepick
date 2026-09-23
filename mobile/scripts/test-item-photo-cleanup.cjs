const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root,'supabase/functions/cleanup-item-photos/index.ts'),'utf8');
const migration = fs.readFileSync(path.join(root,'supabase/migrations/20260923151300_secure_item_photo_uploads.sql'),'utf8');

assert.match(source,/claim_item_photo_cleanup/);
assert.match(source,/stale_item_photo_paths/);
assert.match(source,/\.storage\.from\(BUCKET\)\.remove\(paths\)/,
  'cleanup must delete objects through the Storage API');
assert.doesNotMatch(source,/from\(['"]objects['"]\)\.delete/,
  'cleanup must never delete storage.objects metadata directly');
assert.match(source,/MAX_OBJECTS_PER_RUN\s*=\s*1000/,
  'each public maintenance invocation stays bounded');

assert.match(migration,/item_photo_upload_limits/);
assert.match(migration,/interval '24 hours'/);
assert.match(migration,/onepick-item-photo-cleanup/);

console.log('Item photo cleanup checks passed: deletion-proof quota, bounded daily lease and Storage API removal.');
