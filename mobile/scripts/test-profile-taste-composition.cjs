const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

const service = read('src/services/profileTasteCompositionService.ts');
const component = read('src/components/profile-taste-composition.tsx');
const profile = read('src/app/(tabs)/profile.tsx');
const queryKeys = read('src/lib/query/queryKeys.ts');
const invalidation = read('src/lib/query/invalidatePickData.ts');
const overrides = read('src/lib/supabase/database.overrides.ts');

assert.match(service, /supabase\.rpc\('profile_taste_composition',\s*\{\s*p_profile_id:\s*profileId/);
assert.match(overrides, /profile_taste_composition:\s*\{[\s\S]*Args:\s*\{\s*p_profile_id:\s*string\s*\};[\s\S]*Returns:\s*Json/);
assert.match(component, /const MINIMUM_PICKS = 5;/);
assert.match(component, /취향을 모으는 중 · 원픽/);
assert.match(component, /dimension\.percentage\.toFixed\(1\)/);
assert.match(queryKeys, /profileTaste:\s*\{/);
assert.match(invalidation, /queryKeys\.profileTaste\.all/);

const infoIndex = profile.indexOf('<ProfileBioEditor');
const tasteIndex = profile.indexOf('<ProfileTasteComposition');
const aiIndex = profile.indexOf('<ProfileAiPanel');
const picksIndex = profile.indexOf('카테고리별 원픽');

assert.ok(infoIndex >= 0, 'profile info section is missing');
assert.ok(tasteIndex > infoIndex, 'taste composition must follow profile info');
assert.ok(aiIndex > tasteIndex, 'AI taste evaluation must follow taste composition');
assert.ok(picksIndex > aiIndex, 'category picks must follow AI taste evaluation');

console.log('Profile taste composition regression checks passed.');
