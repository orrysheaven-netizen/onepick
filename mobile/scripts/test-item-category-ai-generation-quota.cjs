const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(
  path.join(root, 'supabase/functions/suggest-item-categories/index.ts'),
  'utf8',
);

const cacheHit = source.indexOf("if (cached && cached.user_id === user.id");
const reservation = source.indexOf("reserve_item_category_ai_generation");
const provider = source.indexOf("fetch('https://api.openai.com/v1/responses'");

assert.ok(cacheHit >= 0, 'cache-hit branch must exist');
assert.ok(reservation > cacheHit, 'paid quota must not be consumed before a valid cache-hit check');
assert.ok(provider > reservation, 'paid quota must be reserved before the OpenAI request starts');
assert.match(
  source,
  /if \(reserved !== true\) return reply\(\{ error: 'RATE_LIMITED' \}, 429\)/,
  'exhausted reservations must stop before provider work',
);
assert.match(
  source,
  /if \(!modelResponse\.ok\)[\s\S]*?AI_CATEGORY_PROVIDER_FAILED/,
  'provider failures remain downstream of the already-consumed reservation',
);

console.log('AI category quota checks passed: cache first, atomic reservation second, paid provider call last.');
