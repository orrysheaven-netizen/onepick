const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient } = require('@tanstack/react-query');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const same = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);

function load(relative, imports = {}) {
  const moduleExports = {};
  const output = ts.transpileModule(read(relative), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;

  vm.runInNewContext(output, {
    exports: moduleExports,
    process,
    require: (name) => {
      if (name in imports) return imports[name];
      assert.fail(`Unexpected import: ${name}`);
    },
  });
  return moduleExports;
}

async function main() {
  const userId = 'first-user';
  const username = 'first_user';

  // 1) Login -> username -> original task.
  const intents = load('src/lib/auth/authIntent.ts');
  const firstUserIntent = intents.getAuthIntent({ action: 'home' });
  const usernameRoute = intents.getPostAuthRoute(firstUserIntent, true);
  assert.equal(usernameRoute.pathname, '/auth/username', 'a newly authenticated user without a profile must create a username');
  same(usernameRoute.params, { action: 'home' }, 'the first-user home intent must survive username creation');

  const loginSource = read('src/app/auth/login.tsx');
  const usernameSource = read('src/app/auth/username.tsx');
  assert.match(
    loginSource,
    /router\.replace\(getPostAuthRoute\(intent, !result\.profile\)\)/,
    'login must route missing-profile users through username creation',
  );
  // MVP sign-up (Figma [최종결정] 가입 여정): no taste onboarding after the username step.
  assert.match(
    usernameSource,
    /router\.replace\(getPostAuthRoute\(intent\)\)/,
    'saving the first username must return to the original task',
  );
  assert.doesNotMatch(usernameSource, /'\/onboarding'/, 'username creation must not divert to taste onboarding');

  // 3) The tenth Pick must make cached AI eligibility stale so READY_FIRST can be refetched.
  const { queryKeys } = load('src/lib/query/queryKeys.ts');
  const { invalidatePickData } = load('src/lib/query/invalidatePickData.ts', {
    './queryKeys': { queryKeys },
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const categoryId = 'ramen';
  const itemId = 'item-ramen';
  const aiKey = queryKeys.profileAi.status(userId);

  cache.setQueryData(aiKey, {
    currentPickCount: 9,
    minimumPicks: 10,
    canGenerate: false,
    reason: 'NEED_FIRST_PICKS',
  });

  let pickMutation;
  const savedPick = {
    id: 'pick-10',
    userId,
    categoryId,
    itemId,
    oneLineReview: '이유가 분명해서 좋아요',
    status: 'active',
  };
  const { useChoosePick } = load('src/hooks/useChoosePick.ts', {
    '@tanstack/react-query': {
      useQueryClient: () => cache,
      useMutation: (options) => {
        pickMutation = options;
        return options;
      },
    },
    '@/lib/query/invalidatePickData': { invalidatePickData },
    '@/services': {
      pickService: { choosePick: async () => savedPick },
      observabilityService: { captureProductEvent: async () => {} },
    },
  });
  useChoosePick();
  assert.ok(pickMutation, 'Pick mutation contract must be available');

  const returnedPick = await pickMutation.mutationFn({
    categoryId,
    itemId,
    oneLineReview: savedPick.oneLineReview,
  });
  assert.equal(returnedPick.id, 'pick-10');
  await pickMutation.onSuccess(returnedPick);
  assert.equal(
    cache.getQueryState(aiKey).isInvalidated,
    true,
    'saving the tenth Pick must invalidate cached AI eligibility',
  );

  cache.setQueryData(aiKey, {
    currentPickCount: 10,
    minimumPicks: 10,
    canGenerate: true,
    reason: 'READY_FIRST',
  });
  assert.equal(cache.getQueryData(aiKey).reason, 'READY_FIRST');
  assert.equal(cache.getQueryData(aiKey).canGenerate, true);

  // 4) AI request must call the generation service and invalidate both status and comment caches.
  const statusKey = ['profile-ai', 'status', userId];
  const commentKey = ['profile-ai', 'comment', userId];
  cache.setQueryData(statusKey, { canGenerate: true, reason: 'READY_FIRST' });
  cache.setQueryData(commentKey, null);

  let aiMutation;
  const generatedReview = { id: 'ai-review-1', profileId: userId };
  const { useGenerateProfileAi } = load('src/hooks/useProfileAi.ts', {
    '@tanstack/react-query': {
      useQuery: () => ({}),
      useQueryClient: () => cache,
      useMutation: (options) => {
        aiMutation = options;
        return options;
      },
    },
    '@/services/profileAiService': {
      profileAiService: { generate: async () => generatedReview },
    },
  });
  useGenerateProfileAi(userId);
  assert.ok(aiMutation, 'AI generation mutation contract must be available');
  const generated = await aiMutation.mutationFn();
  assert.equal(generated.id, generatedReview.id, 'AI request must call the generation service');
  await aiMutation.onSuccess();
  assert.equal(cache.getQueryState(statusKey).isInvalidated, true, 'AI generation must invalidate eligibility status');
  assert.equal(cache.getQueryState(commentKey).isInvalidated, true, 'AI generation must invalidate the rendered AI comment');

  const aiPanelSource = read('src/components/profile-ai-panel.tsx');
  assert.match(
    aiPanelSource,
    /disabled={!value\.canGenerate \|\| generate\.isPending}[\s\S]*?generate\.mutate\(\)/,
    'the AI CTA must be enabled by canGenerate and invoke generation',
  );
  assert.match(
    aiPanelSource,
    /value\.hasReview \? 'AI가 다시 본 나' : 'AI 평가 보기'/,
    'the first AI CTA label must remain visible in the profile flow',
  );

  // 5) Profile -> public profile -> native share payload with a stable public URL.
  const profileSource = read('src/app/(tabs)/(profile)/profile.tsx');
  const publicProfileSource = read('src/app/(tabs)/(profile)/u/[username].tsx');
  assert.match(
    profileSource,
    /openPublicProfile = \(\) => router\.push\({ pathname: '\/u\/\[username\]'[\s\S]*?username: profile\.username/,
    'the owner profile must open its public profile by username',
  );
  assert.match(
    profileSource,
    /shareProfile\({ username: profile\.username, pickCount: publicMainPicks\.length }\)/,
    'the owner profile must share the food-scope count used by the public profile',
  );
  assert.match(profileSource, /label=\{isSharingProfile \? '공유 중…' : '프로필 공유'\}/, 'the owner profile exposes its direct share CTA');
  assert.match(
    publicProfileSource,
    /shareProfile\({ username: profile\.username, pickCount: currentPicks\.length }\)/,
    'the public profile fallback must share the loaded username and current Pick count',
  );
  assert.match(publicProfileSource, /accessibilityLabel="프로필 공유"/, 'the public profile must expose a share CTA (header icon, #757)');

  const oldShareBase = process.env.EXPO_PUBLIC_SHARE_BASE_URL;
  process.env.EXPO_PUBLIC_SHARE_BASE_URL = 'https://onepick.example';
  try {
    const shareLinks = load('src/lib/share/shareLinks.ts', {
      'react-native': { Platform: { OS: 'web' } },
    });
    let sharePayload;
    const { shareProfile } = load('src/lib/share/shareProfile.ts', {
      'react-native': {
        Platform: { OS: 'ios' },
        Share: {
          share: async (payload) => {
            sharePayload = payload;
            return { action: 'sharedAction' };
          },
        },
      },
      './shareLinks': shareLinks,
      '../demoProfile': { demoSharePrefix: () => '' },
    });

    await shareProfile({ username: 'First_User', pickCount: 5 });
    assert.equal(sharePayload.url, 'https://onepick.example/u/first_user');
    assert.match(sharePayload.message, /음식 원픽 5개/);
    assert.match(sharePayload.message, /https:\/\/onepick\.example\/u\/first_user/);
  } finally {
    if (oldShareBase === undefined) delete process.env.EXPO_PUBLIC_SHARE_BASE_URL;
    else process.env.EXPO_PUBLIC_SHARE_BASE_URL = oldShareBase;
  }

  cache.clear();
  console.log('First-user pre-launch journey passed: login -> username -> tenth Pick -> AI request -> public profile share.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
