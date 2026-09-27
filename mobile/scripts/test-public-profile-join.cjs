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
const picksIndex = profile.indexOf("profileScope === 'food' ? '음식 원픽' : '다른 취향'");
const shareIndex = profile.indexOf('이 취향 컬렉션을 공유해보세요');
assert.ok(picksIndex >= 0 && shareIndex >= 0, 'the picks and share sections must stay on the public profile');
assert.ok(joinIndex > picksIndex, 'the join call to action must follow the category picks');
assert.ok(joinIndex < shareIndex, 'the join call to action must come before the share card');

// The follow button keeps its own intent: an existing account returns to the profile it was reading.
assert.match(
  profile,
  /params: \{ action: 'view_profile', username: query\.data!\.profile\.username \}/,
  'following must keep returning an existing account to this profile',
);

// A brand-new account that signed up to follow owns nothing yet, so it onboards first.
assert.match(
  username,
  /const ONBOARDING_INTENTS = new Set<AuthIntent\['action'\]>\(\[[^\]]*'view_profile'[^\]]*\]\)/,
  'a new account created from a profile follow must enter onboarding',
);

// Intents with an action still in flight must keep resuming it instead of onboarding.
for (const action of ['comment_pick', 'choose_pick', 'request_item', 'add_item_photo']) {
  assert.doesNotMatch(
    username,
    new RegExp(`const ONBOARDING_INTENTS = new Set<AuthIntent\\['action'\\]>\\(\\[[^\\]]*'${action}'`),
    `${action} carries an action in flight and must not be diverted to onboarding`,
  );
}

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
