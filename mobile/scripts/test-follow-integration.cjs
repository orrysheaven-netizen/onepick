const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const profile = read('src/app/(tabs)/(profile)/u/[username].tsx');
const constants = read('src/constants/onepick.ts');
const safety = read('src/hooks/useSafety.ts');
const follow = read('src/components/follow-button.tsx');
const connections = read('src/components/follow-connections-view.tsx');

assert.match(constants, /profileFollowConnections: true/,
  'Public follow counts/list use their own approved exposure gate');
assert.doesNotMatch(constants, /^\s*followCounts:/m,
  'Legacy own-profile count gate is removed (#757); ProfileIdentity shows the public counts');

assert.ok(profile.includes('useLocalSearchParams<{ username?: string; connections?: string; returnTo?: string }>()'),
  'Public profile keeps username, connections and safe return origin in one route contract');
assert.match(profile, /usePublicFollowCounts\([\s\S]*?query\.data\?\.profile\.id[\s\S]*?user\?\.id \?\? null/);
assert.match(profile, /connections === 'followers' \|\| connections === 'following'/);
assert.match(profile, /const publicPickCount = publicMainPicks\.length \+ labPicks\.length/);
assert.match(profile, /key: 'picks', label: '원픽', value: String\(publicPickCount\)/);
assert.doesNotMatch(profile, /원픽 \{query\.data\.currentPicks\.length\}/,
  'Hidden FOOD online/recipe Picks must not inflate the public profile count');
assert.match(profile, /label: '팔로워', value: publicFollowCounts\.data \? String\(publicFollowCounts\.data\.followerCount\) : '—'/);
assert.match(profile, /label: '팔로잉', value: publicFollowCounts\.data \? String\(publicFollowCounts\.data\.followingCount\) : '—'/);
assert.match(profile, /onPress: \(\) => openConnections\('followers'\)/);
assert.match(profile, /onPress: \(\) => openConnections\('following'\)/);
assert.match(profile, /\? <FollowButton[\s\S]*?fullWidth \/> : null\}/,
  '#757: Follow/Following is the single primary CTA (share lives in the header)');

assert.match(profile, /pathname: '\/u\/\[username\]'[\s\S]*?connections: direction/,
  '40 → 41 keeps the canonical public-profile URL and adds relationship state only');
assert.match(profile, /query\.data && OnePickFeatures\.profileFollowConnections && connectionDirection[\s\S]*?<FollowConnectionsView/);
assert.match(profile, /initialDirection=\{connectionDirection\}/);
assert.match(profile, /onBack=\{closeConnections\}/);
assert.match(profile, /useNavigation/,
  '41 navigation can inspect the nested Profile stack');
assert.match(profile, /type: 'RESET'/,
  'Direct native 41 links synthesize owner 40 directly underneath for system back and swipe-back');
assert.match(profile, /previousRoute\?\.name === 'u\/\[username\]'/);
assert.match(profile, /previousParams\?\.username === username/);
assert.match(profile, /\{ name: 'u\/\[username\]', params: \{ username \} \}/);
assert.match(profile, /\{ name: 'u\/\[username\]', params: \{ username, connections: connectionDirection \} \}/);
assert.match(profile, /Platform\.OS === 'web'/,
  'Web keeps URL/history handling href-based instead of rewriting native navigator state');
assert.match(profile, /router\.replace\(\{ pathname: '\/u\/\[username\]'[\s\S]*?username: query\.data\.profile\.username/,
  'Direct connection deep links fall back to the owner profile, not Home');
assert.match(profile, /onOpenProfile=\{\(targetUsername\) => router\.push\(\{ pathname: '\/u\/\[username\]'/,
  'Tapping a connection opens that user profile');

assert.match(profile, /const \[loginTargetUsername, setLoginTargetUsername\] = useState<string \| null>\(null\)/);
assert.match(profile, /onRequireLogin=\{openFollowLogin\}/,
  'Signed-out connection-row Follow reuses the profile login handoff');
assert.match(profile, /const targetUsername = loginTargetUsername \?\? query\.data\.profile\.username/);
assert.match(profile, /armFollowProfileIntent\(targetUsername\)/);
assert.match(profile, /router\.replace\(getPostAuthRoute\(intent, !result\.profile\)\)/);

assert.match(connections, /usePublicFollowCounts\(profileId, viewerUserId \?\? null\)/);
assert.match(connections, /useFollowConnections\(profileId, direction, viewerUserId \?\? null\)/);
assert.match(connections, /viewerUserId !== item\.userId/);
assert.match(connections, /initialFollowing=\{item\.viewerIsFollowing\}/);
assert.match(connections, /item\.bio \?/);

assert.match(safety, /invalidateQueries\(\{ queryKey: queryKeys\.follows\.all \}\)/,
  'Block/unblock invalidates public follow count/list visibility caches');

assert.match(follow, /const isSelf = viewerUserId === profileUserId/);
assert.match(follow, /if \(isSelf\) return null/);
assert.ok(
  follow.indexOf('const [confirmingUnfollow') < follow.indexOf('if (isSelf) return null'),
  'Hooks remain unconditional before the self-row early return',
);
assert.match(follow, /setConfirmingUnfollow\(true\)/);
assert.match(follow, />팔로우 취소<\/Text>/);
assert.match(follow, /팔로잉, 팔로우 취소 옵션 열기/,
  'Following button announces that it opens confirmation instead of claiming immediate unfollow');
assert.match(follow, /buttonFullWidth: \{ width: '100%', height: 52, minHeight: 52/);

console.log('Follow integration checks passed: public counts, 41 list state, login resume, block invalidation and confirmed unfollow.');
