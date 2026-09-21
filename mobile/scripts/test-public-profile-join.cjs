const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const profile = read('src/app/u/[username].tsx');
const username = read('src/app/auth/username.tsx');
const login = read('src/app/auth/login.tsx');

// A visitor arriving from a shared link must have a way in that is not "follow this stranger".
const joinIndex = profile.indexOf('styles.joinCard');
assert.ok(joinIndex >= 0, 'the public profile must offer a join call to action');
assert.match(
  profile,
  /\{!user \? <View style=\{styles\.joinCard\}>/,
  'the join call to action must render only for a logged-out visitor',
);
assert.match(
  profile,
  /router\.push\(\{ pathname: '\/auth\/login', params: \{ action: 'join_from_profile' \} \}\)/,
  'the join call to action must carry the join_from_profile intent',
);

// The visitor should read the collection before being asked to sign up.
const picksIndex = profile.indexOf('카테고리별 원픽');
const shareIndex = profile.indexOf('이 취향 컬렉션을 공유해보세요');
assert.ok(picksIndex >= 0 && shareIndex >= 0, 'the picks and share sections must stay on the public profile');
assert.ok(joinIndex > picksIndex, 'the join call to action must follow the category picks');
assert.ok(joinIndex < shareIndex, 'the join call to action must come before the share card');

// The follow button keeps its own intent: it returns the visitor to the profile they were reading.
assert.match(
  profile,
  /params: \{ action: 'view_profile', username: query\.data!\.profile\.username \}/,
  'following must keep returning the visitor to this profile',
);

// A brand-new account from that intent starts taste onboarding, like the home intent does.
assert.match(
  username,
  /const ONBOARDING_INTENTS = new Set<AuthIntent\['action'\]>\(\[[^\]]*'join_from_profile'[^\]]*\]\)/,
  'join_from_profile must enter taste onboarding after username creation',
);
assert.match(
  username,
  /const ONBOARDING_INTENTS = new Set<AuthIntent\['action'\]>\(\[[^\]]*'home'[^\]]*\]\)/,
  'the home intent must stay an onboarding entry intent',
);

assert.match(
  login,
  /intent\.action === 'join_from_profile'\s*\n\s*\? '[^']+'/,
  'the login screen must explain what the visitor gets for this intent',
);

console.log('Public profile join checks passed: a logged-out visitor gets a sign-up entry after the picks, and a new account from it enters onboarding.');
