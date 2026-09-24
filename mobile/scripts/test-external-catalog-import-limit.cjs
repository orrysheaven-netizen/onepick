const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const files = [
  'supabase/functions/movie-catalog/index.ts',
  'supabase/functions/movie-catalog/dramaCatalog.ts',
  'supabase/functions/game-catalog/gameCatalog.ts',
  'supabase/functions/music-catalog/musicCatalog.ts',
  'supabase/functions/book-catalog/bookCatalog.ts',
  'supabase/functions/youtube-catalog/youtubeCatalog.ts',
  'supabase/functions/pokemon-catalog/pokemonCatalog.ts',
];

for (const relative of files) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const authIndex = source.indexOf('auth.getUser');
  const quotaIndex = source.indexOf('reserve_external_catalog_import');

  assert.match(source, /action\s*===\s*['"]import['"]/,
    relative + ' must expose an import path');
  assert.ok(authIndex >= 0, relative + ' must authenticate catalog imports');
  assert.ok(quotaIndex > authIndex,
    relative + ' must reserve import quota only after caller authentication');
  assert.match(source, /created_by:\s*(?:authData\.user\.id|importUserId)/,
    relative + ' must attribute newly imported items to the authenticated user');
  assert.match(source, /RATE_LIMITED/,
    relative + ' must map exhausted quota to a rate-limited response');
}

const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260924143000_limit_external_catalog_imports.sql'),
  'utf8',
);
assert.match(migration, /interval '24 hours'/);
assert.match(migration, /v_count >= 20/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /revoke all on function public\.reserve_external_catalog_import\(uuid\)/);
assert.match(migration, /grant execute on function public\.reserve_external_catalog_import\(uuid\)\s+to service_role/);
assert.doesNotMatch(migration, /grant execute[\s\S]*?reserve_external_catalog_import[\s\S]*?to authenticated/);

console.log('External catalog import quota checks passed for all import providers.');
