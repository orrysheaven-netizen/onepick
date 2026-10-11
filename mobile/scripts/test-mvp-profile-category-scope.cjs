const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

class AppError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

function loadPlain(relative) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name) => { throw new Error('Unexpected import: ' + name); } });
  return exports;
}

function loadProfileService() {
  const exports = {};
  const output = ts.transpileModule(read('src/services/profileService.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, {
    exports,
    require: (name) => {
      if (name === '@/errors/appError') return { AppError };
      if (name === '@/lib/profile/profilePickGroups') return loadPlain('src/lib/profile/profilePickGroups.ts');
      throw new Error('Unexpected import: ' + name);
    },
  });
  return exports.ProfileService;
}

async function main() {
  const ProfileService = loadProfileService();
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const photo = (id) => ({ id, imagePath: null, imageUrl: null, thumbnailUrl: null, imageSourceUrl: `https://onepick.test/${id}.jpg` });
  const bare = { id: 'i7', imagePath: null, imageUrl: null, thumbnailUrl: null, imageSourceUrl: null };
  const mixedPicks = [
    { pick: { id: 'p1', status: 'active' }, category: { id: 'c1', slug: 'pyeongyang-naengmyeon', name: '평양냉면' }, item: photo('i1') },
    { pick: { id: 'p2', status: 'active' }, category: { id: 'c2', slug: 'movie', name: '영화' }, item: photo('i2') },
    { pick: { id: 'p3', status: 'active' }, category: { id: 'c3', slug: 'game', name: '게임' }, item: photo('i3') },
    { pick: { id: 'p4', status: 'active' }, category: { id: 'c4', slug: 'book', name: '책' }, item: photo('i4') },
    { pick: { id: 'p5', status: 'active' }, category: { id: 'c5', slug: 'music', name: '음악' }, item: photo('i5') },
    { pick: { id: 'p6', status: 'needs_review' }, category: { id: 'c6', slug: 'ganjang-gejang', name: '간장게장' }, item: photo('i6') },
    { pick: { id: 'p7', status: 'active' }, category: { id: 'c7', slug: 'youtube', name: '유튜브' }, item: bare },
  ];

  const calls = [];
  const readRepository = {
    getPicks: async (input) => {
      calls.push(input);
      return mixedPicks.filter((entry) => input.statuses.includes(entry.pick.status));
    },
  };
  const profileRepository = {
    getById: async (id) => id === ownerId ? { id, username: 'mvp_profile_owner' } : null,
    getByUsername: async (username) => username === 'mvp_profile_owner' ? { id: ownerId, username } : null,
  };

  const service = new ProfileService(profileRepository, readRepository);

  const mine = await service.getMyProfile(ownerId);
  assert.deepEqual(
    Array.from(mine.currentPicks, (entry) => entry.category.slug),
    ['pyeongyang-naengmyeon', 'movie', 'game', 'book', 'music', 'ganjang-gejang', 'youtube'],
    'My Profile keeps photo-less legacy current Picks reachable for owner management',
  );
  assert.deepEqual(Array.from(calls[0].statuses), ['active', 'needs_review']);
  assert.equal(Object.hasOwn(calls[0], 'categoryId'), false, 'My Profile must not apply an MVP restaurant category filter');

  const publicProfile = await service.getProfileByUsername('mvp_profile_owner');
  assert.deepEqual(
    Array.from(publicProfile.currentPicks, (entry) => entry.category.slug),
    ['pyeongyang-naengmyeon', 'movie', 'game', 'book', 'music'],
    'Public Profile keeps photographed active Picks and hides legacy photo-less Picks',
  );
  assert.deepEqual(Array.from(calls[1].statuses), ['active']);
  assert.equal(Object.hasOwn(calls[1], 'categoryId'), false, 'Public Profile must not apply an MVP restaurant category filter');
  assert.equal(mine.currentPicksComplete, true);
  assert.equal(publicProfile.currentPicksComplete, true);

  // #757 A: 원픽 N is the full count, so current Picks are read past the first page of 100.
  const many = Array.from({ length: 230 }, (_, index) => ({
    pick: { id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, status: 'active', updatedAt: `2026-10-10T00:00:00.${String(230 - index).padStart(6, '0')}+00:00` },
    category: { id: `c${index}`, slug: `s${index}`, name: `n${index}` },
    item: photo(`m${index}`),
  }));
  const pageCalls = [];
  const pagedService = new ProfileService(profileRepository, {
    getPicks: async (input) => {
      pageCalls.push(input);
      const start = input.cursor ? many.findIndex((entry) => entry.pick.id === input.cursor.id) + 1 : 0;
      return many.slice(start, start + input.limit);
    },
  });
  const pagedPublic = await pagedService.getProfileByUsername('mvp_profile_owner');
  assert.equal(pagedPublic.currentPicks.length, 230, 'every current Pick is loaded, not just the first page');
  assert.equal(pagedPublic.currentPicksComplete, true);
  assert.deepEqual(pageCalls.map((call) => call.limit), [100, 100, 100]);
  assert.equal(pageCalls[0].cursor, null);
  assert.deepEqual({ ...pageCalls[1].cursor }, { timestamp: many[99].pick.updatedAt, id: many[99].pick.id }, 'pages continue by (updated_at, id)');
  assert.ok(pageCalls.every((call) => call.orderBy === 'updated_at'));
  const capped = new ProfileService(profileRepository, {
    getPicks: async (input) => Array.from({ length: input.limit }, (_, index) => ({ ...many[index % many.length], pick: { ...many[index % many.length].pick } })),
  });
  assert.equal((await capped.getProfileByUsername('mvp_profile_owner')).currentPicksComplete, false, 'past the safety cap the count is marked incomplete');

  // #826 review: the cap is 20 × 100. Exactly 2,000 rows is complete; only a row past the
  // cap marks the count incomplete (1999 / 2000 / 2001).
  // #757 cost: under 100 current Picks the profile still makes the single read main made;
  // reads grow only as ceil((N + 1) / 100) for N < 2,000.
  for (const [total, expected, calls] of [
    [0, true, 1], [1, true, 1], [99, true, 1], [100, true, 2], [101, true, 2], [250, true, 3],
    [1999, true, 20], [2000, true, 21], [2001, false, 21],
  ]) {
    const rowsAt = Array.from({ length: total }, (_, index) => ({
      pick: { id: `b${index}`, status: 'active', updatedAt: `t${String(total - index).padStart(5, '0')}` },
      category: { id: 'c', slug: 's', name: 'n' },
      item: photo(`b${index}`),
    }));
    const boundaryCalls = [];
    const boundary = new ProfileService(profileRepository, {
      getPicks: async (input) => {
        boundaryCalls.push(input);
        const start = input.cursor ? rowsAt.findIndex((entry) => entry.pick.id === input.cursor.id) + 1 : 0;
        return rowsAt.slice(start, start + input.limit);
      },
    });
    const result = await boundary.getProfileByUsername('mvp_profile_owner');
    assert.equal(result.currentPicks.length, Math.min(total, 2000), `${total} rows: at most the cap is loaded`);
    assert.equal(result.currentPicksComplete, expected, `${total} rows: complete=${expected}`);
    assert.equal(boundaryCalls.length, calls, `${total} rows: ${calls} reads`);
    if (calls === 21) {
      assert.equal(boundaryCalls[20].limit, 1, 'past the cap only one row is read to decide');
      assert.equal(boundaryCalls[20].cursor.id, rowsAt[1999].pick.id, 'the probe continues after the last loaded row');
    }
  }

  // #826 review Low: the public list (service) and the shared 원픽 N (isPublicProfilePick)
  // use one photo rule instead of two copies kept in step by a comment.
  const serviceSource = read('src/services/profileService.ts');
  assert.match(serviceSource, /import \{ itemHasVisiblePhoto \} from '@\/lib\/profile\/profilePickGroups'/);
  assert.doesNotMatch(serviceSource, /function itemHasVisiblePhoto/, 'profileService must not keep its own photo rule');
  const groupingSource = read('src/lib/profile/profilePickGroups.ts');
  assert.match(groupingSource, /&& itemHasVisiblePhoto\(item\.item\)/, 'isPublicProfilePick counts with the shared photo rule');

  const ownerScreen = read('src/app/(tabs)/(profile)/profile.tsx');
  const publicScreen = read('src/app/(tabs)/(profile)/u/[username].tsx');
  const labScreen = read('src/app/lab/[username].tsx');
  // Early MVP (#757/#879): both profiles list one scope from the complete current collection —
  // food from a store or an online order. Other themes stay stored and remain reachable via 실험실 routes.
  for (const [screen, name] of [[ownerScreen, 'Owner'], [publicScreen, 'Public']]) {
    assert.match(screen, /filter(Public)?MvpProfilePicks\((query\.data\?\.)?currentPicks/, `${name} profile filters the complete current Pick collection`);
    assert.match(screen, /OnePickMvp\.browseGroupSlug, OnePickMvp\.profileFoodChannels\)/, `${name} profile applies the shared MVP food scope (offline + online)`);
    assert.doesNotMatch(screen, /OnePickMvp\.publicPickChannel/, `${name} profile does not narrow food to offline only`);
    assert.doesNotMatch(screen, /음식 원픽 보기|기타 원픽 보기/, `${name} profile has no 음식 / 기타 chips in the early MVP`);
    assert.match(screen, /profilePicks\.map\(\(item\) => <ProfileCurrentPickRow/, `${name} rows render every Pick in the MVP scope`);
  }
  assert.match(labScreen, /splitLabPicks\(query\.data\?\.currentPicks/, '실험실 reads the same complete collection');
  assert.match(labScreen, /picks=\{labPicks\}/);

  console.log('MVP profile scope checks passed: owner management keeps legacy Picks while public profiles hide photo-less current Picks.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
