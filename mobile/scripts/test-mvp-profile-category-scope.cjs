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

function loadProfileService() {
  const exports = {};
  const output = ts.transpileModule(read('src/services/profileService.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, {
    exports,
    require: (name) => {
      if (name === '@/errors/appError') return { AppError };
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

  const ownerScreen = read('src/app/(tabs)/(profile)/profile.tsx');
  const publicScreen = read('src/app/(tabs)/(profile)/u/[username].tsx');
  const labScreen = read('src/app/lab/[username].tsx');
  // Profiles split every current Pick: the main theme stays, the rest moves to 실험실 (never dropped).
  for (const [screen, name] of [[ownerScreen, 'Owner'], [publicScreen, 'Public']]) {
    assert.match(screen, /splitLabPicks\((query\.data\?\.)?currentPicks/, `${name} profile splits the complete current Pick collection`);
    assert.match(screen, /const visibleProfilePicks = profileScope === 'food' \? publicMainPicks : labPicks/, `${name} profile narrows FOOD display without dropping other tastes`);
    assert.match(screen, /filterMainProfileByChannel\(mainPicks, profileCategories, OnePickMvp\.mainThemeCode, OnePickMvp\.publicPickChannel\)/,
      `${name} profile applies the shared offline FOOD exposure rule`);
    assert.match(screen, /음식 원픽 보기/);
    assert.match(screen, /기타 원픽 보기/, `${name} profile uses the shared 음식 / 기타 chip names (#757)`);
  }
  assert.match(ownerScreen, /visibleProfilePicks\.map\(\(item\) => <ProfileCurrentPickRow/, 'Owner rows render every Pick in the selected scope');
  assert.match(publicScreen, /visibleProfilePicks\.map\(\(item\) => <ProfileCurrentPickRow/, 'Public rows render every Pick in the selected scope with the shared #757 row');
  assert.match(labScreen, /splitLabPicks\(query\.data\?\.currentPicks/, '실험실 reads the same complete collection');
  assert.match(labScreen, /picks=\{labPicks\}/);

  console.log('MVP profile scope checks passed: owner management keeps legacy Picks while public profiles hide photo-less current Picks.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
