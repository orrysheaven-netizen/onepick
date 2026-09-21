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
// AI 평가는 취향 기반이므로 취향 카테고리의 원픽만 센다. 자격 판정과 재료가
// 같은 정의(profile_taste_picks)를 읽어야 분모가 갈리지 않는다. 한쪽만
// 필터를 걸면 "5/5 완료"인데 생성이 재료 부족으로 실패하거나, 취향이 아닌
// 원픽이 계속 AI 재료로 들어간다. docs/dangol-entry-direction.md 참조.
assert.match(status, /rpc\('profile_taste_picks'/);
assert.match(generate, /rpc\('profile_taste_picks'/);
assert.match(status, /tastePickCount >= 5/);
assert.match(status, /tastePickCount >= 10/);
// 재평가 변경 건수도 같은 행에서 세야 한다. 전체 픽과 비교하면 생활 서비스
// 원픽을 등록한 것만으로 재평가가 열린다.
assert.match(status, /meaningfulChangeCount\(snapshot, tasteRows\)/);
assert.match(status, /changedCount >= 5/);
assert.match(status, /24 \* 60 \* 60 \* 1000/);
assert.match(status, /READY_TEN_PICK_UPGRADE/);
assert.match(status, /READY_REANALYSIS/);
assert.match(status, /current_user_is_admin/);
assert.match(status, /isAdmin/);

console.log('Profile AI policy checks passed: 5-pick first read, 10-pick upgrade, then 5 changes + 1 day (admins bypass the wait).');
