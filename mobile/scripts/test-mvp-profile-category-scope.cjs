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
  const mixedPicks = [
    { pick: { id: 'p1', status: 'active' }, category: { id: 'c1', slug: 'pyeongyang-naengmyeon', name: '평양냉면' } },
    { pick: { id: 'p2', status: 'active' }, category: { id: 'c2', slug: 'movie', name: '영화' } },
    { pick: { id: 'p3', status: 'active' }, category: { id: 'c3', slug: 'game', name: '게임' } },
    { pick: { id: 'p4', status: 'active' }, category: { id: 'c4', slug: 'book', name: '책' } },
    { pick: { id: 'p5', status: 'active' }, category: { id: 'c5', slug: 'music', name: '음악' } },
    { pick: { id: 'p6', status: 'needs_review' }, category: { id: 'c6', slug: 'ganjang-gejang', name: '간장게장' } },
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
    ['pyeongyang-naengmyeon', 'movie', 'game', 'book', 'music', 'ganjang-gejang'],
    'My Profile must keep restaurant and non-restaurant current Picks together',
  );
  assert.deepEqual(Array.from(calls[0].statuses), ['active', 'needs_review']);
  assert.equal(Object.hasOwn(calls[0], 'categoryId'), false, 'My Profile must not apply an MVP restaurant category filter');

  const publicProfile = await service.getProfileByUsername('mvp_profile_owner');
  assert.deepEqual(
    Array.from(publicProfile.currentPicks, (entry) => entry.category.slug),
    ['pyeongyang-naengmyeon', 'movie', 'game', 'book', 'music'],
    'Public Profile must keep every active non-restaurant Pick visible alongside restaurant Picks',
  );
  assert.deepEqual(Array.from(calls[1].statuses), ['active']);
  assert.equal(Object.hasOwn(calls[1], 'categoryId'), false, 'Public Profile must not apply an MVP restaurant category filter');

  const ownerScreen = read('src/app/(tabs)/profile.tsx');
  const publicScreen = read('src/app/u/[username].tsx');
  assert.match(ownerScreen, /picks=\{currentPicks\}/, 'Owner profile passes the complete current Pick collection to ProfilePickGroups');
  assert.match(publicScreen, /picks=\{query\.data\.currentPicks\}/, 'Public profile passes the complete current Pick collection to ProfilePickGroups');

  console.log('MVP profile scope checks passed: restaurant-first discovery never hides existing non-restaurant Picks from profiles.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
