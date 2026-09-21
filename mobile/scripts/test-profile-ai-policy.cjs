const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const contract = fs.readFileSync(path.join(root, 'supabase/functions/analyze-profile-taste/contract.ts'), 'utf8');
const generate = fs.readFileSync(path.join(root, 'supabase/functions/analyze-profile-taste/index.ts'), 'utf8');
const status = fs.readFileSync(path.join(root, 'supabase/functions/profile-ai-status/index.ts'), 'utf8');

assert.match(contract, /PROFILE_AI_MIN_PICKS\s*=\s*10/);
assert.match(contract, /PROFILE_AI_RECOMMENDED_PICKS\s*=\s*10/);
assert.match(contract, /PROFILE_AI_MIN_CHANGES\s*=\s*5/);
assert.match(contract, /PROFILE_AI_REANALYSIS_INTERVAL_SECONDS\s*=\s*7\s*\*\s*24\s*\*\s*60\s*\*\s*60/);
assert.match(generate, /AI_WAIT_FOR_TEN_PICKS/);
assert.match(generate, /previousPickCount < PROFILE_AI_RECOMMENDED_PICKS/);
assert.match(generate, /changedCount < PROFILE_AI_MIN_CHANGES/);
assert.match(generate, /WEEKLY_REANALYSIS_LIMIT/);
assert.match(generate, /current_user_is_admin/);
assert.match(generate, /!isAdmin && existing\.generated_at/);
assert.match(status, /rpc\('profile_taste_picks'/);
assert.match(generate, /rpc\('profile_taste_picks'/);
assert.match(status, /tastePickCount >= 10/);
// 양성 단언만으로는 currentPickCount 게이트가 나란히 추가되는 것을 못 잡는다.
// 분모를 다시 넓히면 여기서 걸린다.
assert.doesNotMatch(status, /currentPickCount >= /);
assert.match(status, /meaningfulChangeCount\(snapshot, tasteRows\)/);
assert.match(status, /changedCount >= 5/);
assert.match(status, /7 \* 24 \* 60 \* 60 \* 1000/);
assert.match(status, /READY_TEN_PICK_UPGRADE/);
assert.match(status, /READY_REANALYSIS/);
assert.match(status, /current_user_is_admin/);
assert.match(status, /isAdmin/);

console.log('Profile AI policy checks passed: 10 taste Picks for first read, taste-only changes, legacy upgrade, then 5 changes + 7 days.');
