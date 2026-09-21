const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const repository = fs.readFileSync(
  path.join(__dirname, '../src/repositories/supabase/supabasePhotoRepository.ts'),
  'utf8',
);
const functionIndex = fs.readFileSync(
  path.join(root, 'supabase/functions/import-item-image/index.ts'),
  'utf8',
);

assert.match(config, /\[functions\.import-item-image\]/, 'Supabase config declares the current image import slug');
assert.doesNotMatch(config, /\[functions\.import-product-image\]/, 'Legacy image import slug is not configured');
assert.match(repository, /functions\.invoke\('import-item-image'/, 'Mobile invokes the configured function slug');
assert.match(functionIndex, /Deno\.serve/, 'Configured function has an entrypoint');

console.log('Image import function-name checks passed: config, mobile invocation and function folder are aligned.');
