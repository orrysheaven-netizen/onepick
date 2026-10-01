const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadSource(relativePath, imports = {}) {
  const file = path.join(root, 'src', relativePath);
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports,
    require: (name) => {
      if (name in imports) return imports[name];
      assert.fail('Unexpected runtime dependency: ' + name);
    },
  });
  return exports;
}

async function main() {
  const { AppError } = loadSource('errors/appError.ts');

  const calls = [];
  const followRepository = {
    isFollowing: async () => false,
    follow: async () => {},
    unfollow: async () => {},
    getCounts: async () => ({ followingCount: 0, followerCount: 0 }),
    getPublicCounts: async (...args) => {
      calls.push(['publicCounts', ...args]);
      return { followingCount: 7, followerCount: 11 };
    },
    getConnections: async (...args) => {
      calls.push(['connections', ...args]);
      return {
        items: [{ userId: 'u1', username: 'alice', profileImageUrl: null, bio: 'bio', viewerIsFollowing: true }],
        nextCursor: { username: 'alice', userId: 'u1' },
      };
    },
  };
  const readRepository = { getFollowingPicks: async () => ({ items: [], nextCursor: null }) };

  const { FollowService } = loadSource('services/followService.ts', {
    '@/errors/appError': { AppError },
  });
  const service = new FollowService(followRepository, readRepository);

  assert.throws(() => service.getPublicCounts(''), (error) => error.code === 'PROFILE_NOT_FOUND');
  assert.throws(() => service.getConnections('', 'followers'), (error) => error.code === 'PROFILE_NOT_FOUND');
  assert.deepEqual(await service.getPublicCounts('target'), { followingCount: 7, followerCount: 11 });
  assert.deepEqual(
    await service.getConnections('target', 'followers', { username: 'amy', userId: 'u0' }, 10),
    {
      items: [{ userId: 'u1', username: 'alice', profileImageUrl: null, bio: 'bio', viewerIsFollowing: true }],
      nextCursor: { username: 'alice', userId: 'u1' },
    },
  );
  assert.deepEqual(calls, [
    ['publicCounts', 'target'],
    ['connections', 'target', 'followers', { username: 'amy', userId: 'u0' }, 10],
  ]);

  const rpcCalls = [];
  const client = {
    rpc: async (name, args) => {
      rpcCalls.push([name, args]);
      if (name === 'profile_follow_counts') {
        return { data: [{ following_count: 3, follower_count: 4 }], error: null };
      }
      if (name === 'profile_follow_connections_page') {
        return {
          data: [
            { user_id: '1', username: 'alice', profile_image_url: null, bio: 'a', viewer_is_following: true },
            { user_id: '2', username: 'bob', profile_image_url: 'img', bio: null, viewer_is_following: false },
            { user_id: '3', username: 'carol', profile_image_url: null, bio: 'c', viewer_is_following: false },
          ],
          error: null,
        };
      }
      assert.fail('Unexpected rpc: ' + name);
    },
  };

  const { SupabaseFollowRepository } = loadSource('repositories/supabase/supabaseFollowRepository.ts', {
    '@/errors/appError': { AppError },
    '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
  });
  const repository = new SupabaseFollowRepository(client);

  assert.deepEqual(await repository.getPublicCounts('target'), { followingCount: 3, followerCount: 4 });
  const page = await repository.getConnections('target', 'following', { username: 'amy', userId: '0' }, 2);
  assert.deepEqual(page, {
    items: [
      { userId: '1', username: 'alice', profileImageUrl: null, bio: 'a', viewerIsFollowing: true },
      { userId: '2', username: 'bob', profileImageUrl: 'img', bio: null, viewerIsFollowing: false },
    ],
    nextCursor: { username: 'bob', userId: '2' },
  });
  assert.deepEqual(rpcCalls, [
    ['profile_follow_counts', { p_profile_id: 'target' }],
    ['profile_follow_connections_page', {
      p_profile_id: 'target',
      p_direction: 'following',
      p_after_username: 'amy',
      p_after_user_id: '0',
      p_limit: 2,
    }],
  ]);

  const source = fs.readFileSync(path.join(root, 'src/lib/supabase/database.overrides.ts'), 'utf8');
  assert.match(source, /profile_follow_counts:/);
  assert.match(source, /profile_follow_connections_page:/);
  assert.match(source, /p_direction: 'followers' \| 'following'/);
  assert.match(source, /viewer_is_following: boolean/);

  const hooks = fs.readFileSync(path.join(root, 'src/hooks/useFollow.ts'), 'utf8');
  assert.match(hooks, /useProfileFollowCounts/);
  assert.match(hooks, /useFollowConnections/);
  assert.match(hooks, /initialPageParam: null as FollowConnectionCursor \| null/);
  assert.match(hooks, /getNextPageParam: \(lastPage\) => lastPage\.nextCursor \?\? undefined/);

  console.log('Public follow connection data-layer checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
