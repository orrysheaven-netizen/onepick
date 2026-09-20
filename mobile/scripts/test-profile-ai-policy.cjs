const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const contract = fs.readFileSync(path.join(root, 'supabase/functions/analyze-profile-taste/contract.ts'), 'utf8');
const generate = fs.readFileSync(path.join(root, 'supabase/functions/analyze-profile-taste/index.ts'), 'utf8');
const status = fs.readFileSync(path.join(root, 'supabase/functions/profile-ai-status/index.ts'), 'utf8');

assert.match(contract, /PROFILE_AI_MIN_PICKS\s*=\s*5/);
assert.match(contract, /PROFILE_AI_RECOMMENDED_PICKS\s*=\s*10/);
assert.match(contract, /PROFILE_AI_MIN_CHANGES\s*=\s*5/);
assert.match(contract, /PROFILE_AI_REANALYSIS_INTERVAL_SECONDS\s*=\s*24\s*\*\s*60\s*\*\s*60/);
assert.match(generate, /AI_WAIT_FOR_TEN_PICKS/);
assert.match(generate, /previousPickCount < PROFILE_AI_RECOMMENDED_PICKS/);
assert.match(generate, /changedCount < PROFILE_AI_MIN_CHANGES/);
assert.match(generate, /DAILY_REANALYSIS_LIMIT/);
assert.match(generate, /current_user_is_admin/);
assert.match(generate, /!isAdmin && existing\.generated_at/);
assert.match(status, /currentPickCount >= 5/);
assert.match(status, /currentPickCount >= 10/);
assert.match(status, /changedCount >= 5/);
assert.match(status, /24 \* 60 \* 60 \* 1000/);
assert.match(status, /READY_TEN_PICK_UPGRADE/);
assert.match(status, /READY_REANALYSIS/);
assert.match(status, /current_user_is_admin/);
assert.match(status, /isAdmin/);

console.log('Profile AI policy checks passed: 5-pick first read, 10-pick upgrade, then 5 changes + 1 day (admins bypass the wait).');
