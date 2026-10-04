const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const same = (a, b, message) => assert.equal(JSON.stringify(a), JSON.stringify(b), message);

function loadSource(relativePath, imports = {}) {
  const file = path.join(root, 'src', relativePath);
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports,
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' } },
    require: (name) => {
      assert.ok(name in imports, 'Unexpected runtime dependency: ' + name);
      return imports[name];
    },
  });
  return exports;
}

async function main() {
  const rpcCalls = [];
  const connectionRows = Array.from({ length: 21 }, (_, i) => ({
    user_id: `user-${String(i + 1).padStart(2, '0')}`,
    username: `user_${String(i + 1).padStart(2, '0')}`,
    // Stored value is the owner's profile-images path; the app derives the public URL.
    profile_image_url: i === 0 ? 'f1220000-0000-4000-8000-000000000001/0b6f8a52-3c1e-4d7a-9f10-2a3b4c5d6e7f.jpg' : i === 1 ? 'https://tracker.example/pixel.jpg' : null,
    bio: i === 0 ? '첫 사용자 소개' : null,
    viewer_is_following: i % 2 === 0,
  }));
  let countsUnavailable = false;
  const client = {
    rpc: async (name, args) => {
      rpcCalls.push([name, args]);
      if (name === 'profile_follow_counts') {
        return { data: countsUnavailable ? [] : [{ following_count: 7, follower_count: 11 }], error: null };
      }
      if (name === 'profile_follow_connections_page') return { data: connectionRows, error: null };
      throw new Error('Unexpected RPC ' + name);
    },
  };
  const mapSupabaseError = (error) => error;
  const { SupabaseFollowRepository } = loadSource('repositories/supabase/supabaseFollowRepository.ts', {
    '@/errors/appError': { AppError: class AppError extends Error {} },
    '@/errors/mapSupabaseError': { mapSupabaseError },
  });
  const repository = new SupabaseFollowRepository(client);

  same(await repository.getPublicCounts('profile-1'), { followingCount: 7, followerCount: 11 });
  same(rpcCalls[0], ['profile_follow_counts', { p_profile_id: 'profile-1' }]);
  countsUnavailable = true;
  assert.equal(await repository.getPublicCounts('hidden-profile'), null, 'Unavailable profile maps to null instead of zero counts');

  const page = await repository.getConnections(
    'profile-1',
    'followers',
    { username: 'before_name', userId: 'before-id' },
    20,
  );
  assert.equal(page.items.length, 20, '21 RPC rows become 20 visible rows plus lookahead');
  same(page.items[0], {
    userId: 'user-01',
    username: 'user_01',
    profileImageUrl: 'https://project.supabase.co/storage/v1/object/public/profile-images/f1220000-0000-4000-8000-000000000001/0b6f8a52-3c1e-4d7a-9f10-2a3b4c5d6e7f.jpg',
    bio: '첫 사용자 소개',
    viewerIsFollowing: true,
  });
  same(page.nextCursor, { username: 'user_20', userId: 'user-20' });
  same(rpcCalls.at(-1), ['profile_follow_connections_page', {
    p_profile_id: 'profile-1',
    p_direction: 'followers',
    p_after_username: 'before_name',
    p_after_user_id: 'before-id',
    p_limit: 20,
  }]);

  connectionRows.length = 1;
  const lastPage = await repository.getConnections('profile-1', 'following', null, 20);
  assert.equal(lastPage.items.length, 1);
  assert.equal(lastPage.nextCursor, null, 'No lookahead means no next cursor');

  const { AppError } = loadSource('errors/appError.ts');
  const serviceCalls = [];
  const followRepository = {
    isFollowing: async () => false,
    follow: async () => {},
    unfollow: async () => {},
    getCounts: async () => ({ followingCount: 0, followerCount: 0 }),
    getPublicCounts: async (...args) => { serviceCalls.push(['publicCounts', ...args]); return { followingCount: 2, followerCount: 3 }; },
    getConnections: async (...args) => { serviceCalls.push(['connections', ...args]); return { items: [], nextCursor: null }; },
  };
  const { FollowService } = loadSource('services/followService.ts', { '@/errors/appError': { AppError } });
  const service = new FollowService(followRepository, { getFollowingPicks: async () => ({ items: [], nextCursor: null }) });
  assert.throws(() => service.getPublicCounts(''), (error) => error.code === 'PROFILE_NOT_FOUND');
  assert.throws(() => service.getConnections('', 'followers'), (error) => error.code === 'PROFILE_NOT_FOUND');
  await service.getPublicCounts('profile-1');
  await service.getConnections('profile-1', 'following', { username: 'u', userId: 'id' }, 15);
  same(serviceCalls, [
    ['publicCounts', 'profile-1'],
    ['connections', 'profile-1', 'following', { username: 'u', userId: 'id' }, 15],
  ]);

  const hooks = fs.readFileSync(path.join(root, 'src/hooks/useFollow.ts'), 'utf8');
  const keys = fs.readFileSync(path.join(root, 'src/lib/query/queryKeys.ts'), 'utf8');
  const overrides = fs.readFileSync(path.join(root, 'src/lib/supabase/database.overrides.ts'), 'utf8');
  assert.match(hooks, /usePublicFollowCounts\(profileId: string \| undefined, viewerId: string \| null\)/);
  assert.match(hooks, /useFollowConnections[\s\S]*?queryKeys\.follows\.connections\(profileId, direction, viewerId\)/);
  assert.match(keys, /publicCounts: \(profileId: string, viewerId: string \| null\)/);
  assert.match(keys, /connections: \(profileId: string, direction: 'followers' \| 'following', viewerId: string \| null\)/);
  const { queryKeys } = loadSource('lib/query/queryKeys.ts');
  same(queryKeys.follows.publicCounts('profile-1', null), ['follows', 'public-counts', 'profile-1', 'public']);
  same(queryKeys.follows.publicCounts('profile-1', 'viewer-a'), ['follows', 'public-counts', 'profile-1', 'viewer-a']);
  assert.notEqual(
    JSON.stringify(queryKeys.follows.connections('profile-1', 'followers', 'viewer-a')),
    JSON.stringify(queryKeys.follows.connections('profile-1', 'followers', 'viewer-b')),
    'Different signed-in viewers never share block-filtered connection caches',
  );

  assert.match(overrides, /profile_follow_counts:/);
  assert.match(overrides, /profile_follow_connections_page:/);

  console.log('Follow connection checks passed: sanitized RPC mapping, lookahead cursor, service guards and viewer-scoped query keys.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
