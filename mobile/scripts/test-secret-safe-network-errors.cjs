const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');

const sources = {
  game: fs.readFileSync(path.join(root,'supabase/functions/game-catalog/index.ts'),'utf8'),
  youtube: fs.readFileSync(path.join(root,'supabase/functions/youtube-catalog/index.ts'),'utf8'),
  book: fs.readFileSync(path.join(root,'supabase/functions/book-catalog/index.ts'),'utf8'),
  sbiz: fs.readFileSync(path.join(root,'supabase/functions/sbiz-place-catalog/index.ts'),'utf8'),
};

assert.doesNotMatch(sources.game,/searchParams\.set\(['"]client_secret['"]/,
  'Twitch client secret must not be placed in the request URL');
assert.match(sources.game,/application\/x-www-form-urlencoded/);
assert.match(sources.game,/body:\s*form\.toString\(\)/);

for (const [name, source] of Object.entries(sources)) {
  assert.doesNotMatch(source,/error instanceof Error \? error\.message/,
    name + ' must not log raw network error messages that can contain request URLs');
}
assert.match(sources.sbiz,/error\.message === 'SBIZ_NOT_CONFIGURED'/,
  'SBIZ only compares a fixed local sentinel and never logs the raw exception message');
assert.match(sources.youtube,/error instanceof Error \? error\.name/);
assert.match(sources.book,/error instanceof Error \? error\.name/);
assert.match(sources.game,/error instanceof Error \? error\.name/);

console.log('Secret-safe network error checks passed: no raw URL-bearing error messages and Twitch secret is form-encoded.');
