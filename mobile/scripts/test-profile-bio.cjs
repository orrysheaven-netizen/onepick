const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { QueryClient } = require('@tanstack/react-query');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name) => {
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name === '@/components/ui/dialog-labels') return require('./dialog-labels.cjs');
    if (name in imports) return imports[name];
    if (name === '@/components/profile-ai-comment') return { ProfileAiComment: () => null };
    if (name === '@/components/profile-taste-composition') return { ProfileTasteComposition: () => null };
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === '@/lib/home/publicFoodScope' && !(name in imports)) return require('./public-food-scope.cjs');
    assert.fail(`Unexpected import ${name}`);
  } });
  return exports;
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const part = (tag) => ({ children }) => React.createElement(tag, null, children);

async function main() {
  const bio = load('lib/profileBio.ts');
  assert.equal(bio.normalizeProfileBio('  라면과 영화\r\n좋아해요  '), '라면과 영화\n좋아해요');
  assert.equal(bio.normalizeProfileBio(' \r\n\t '), null);
  assert.equal(bio.profileBioLength('🍜'), 1);
  assert.equal(bio.normalizeProfileBio('🍜'.repeat(100)), '🍜'.repeat(100));
  assert.equal(bio.normalizeProfileBio('가'.repeat(100)), '가'.repeat(100));
  assert.throws(() => bio.normalizeProfileBio('가'.repeat(101)), /100자/);
  assert.throws(() => bio.normalizeProfileBio('a\u0000b'));
  assert.throws(() => bio.normalizeProfileBio(null));
  const { AppError } = load('errors/appError.ts');
  let userId = 'owner', authError = null, dbError = null, responseId = 'owner';
  let values, filter, columns, writes = 0;
  const chain = {
    update: (value) => { values = value; writes++; return chain; },
    eq: (key, value) => { filter = [key, value]; return chain; },
    select: (value) => { columns = value; return chain; },
    single: async () => ({ data: dbError ? null : { id: responseId, bio: values.bio }, error: dbError }),
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: authError }) },
    from: (table) => { assert.equal(table, 'profiles'); return chain; },
  };
  const { ProfileBioService } = load('services/profileBioService.ts', {
    '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
    '@/lib/profileBio': bio, '@/lib/supabase/client': { supabase: client },
  });
  const service = new ProfileBioService(client);
  assert.equal((await service.update('owner', ' 취향 소개 ')).bio, '취향 소개');
  assert.deepEqual(Object.keys(values), ['bio'], 'Only the bio column is changed');
  assert.deepEqual(filter, ['id', 'owner']); assert.equal(columns, 'id,bio');
  assert.equal((await service.update('owner', '')).bio, null, 'Empty input clears the existing field');
  const previousWrites = writes;
  for (const id of [null, 'other']) {
    userId = id;
    await assert.rejects(() => service.update('owner', 'stale draft'), (error) => error.code === 'AUTH_REQUIRED');
  }
  assert.equal(writes, previousWrites, 'No write after logout or account switch');
  userId = 'owner';
  await assert.rejects(() => service.update('', 'draft'), (error) => error.code === 'AUTH_REQUIRED');
  await assert.rejects(() => service.update('owner', '가'.repeat(101)));
  assert.equal(writes, previousWrites, 'Invalid input never reaches the database');
  authError = new Error('auth offline'); await assert.rejects(() => service.update('owner', 'draft'), /auth offline/); authError = null;
  dbError = new Error('save offline'); await assert.rejects(() => service.update('owner', 'draft'), /save offline/); dbError = null;
  responseId = 'unexpected'; await assert.rejects(() => service.update('owner', 'draft'), (error) => error.code === 'PROFILE_NOT_FOUND'); responseId = 'owner';

  const { queryKeys } = load('lib/query/queryKeys.ts');
  const cache = new QueryClient();
  const mine = queryKeys.profiles.mine('owner');
  const publicOwner = queryKeys.profiles.byUsername('owner');
  const other = queryKeys.profiles.byUsername('other');
  const history = queryKeys.profiles.history('owner');
  const original = { profile: { id: 'owner', username: 'owner', bio: 'old' }, currentPicks: [{ id: 'pick' }] };
  cache.setQueryData(mine, original); cache.setQueryData(publicOwner, { ...original, isMine: false });
  cache.setQueryData(other, { profile: { id: 'other', bio: 'untouched' }, currentPicks: [] });
  cache.setQueryData(history, { pages: [{ items: ['history'] }], pageParams: [null] });
  const { useUpdateProfileBio } = load('hooks/useUpdateProfileBio.ts', {
    '@tanstack/react-query': { useMutation: (options) => options, useQueryClient: () => cache },
    '@/lib/query/queryKeys': { queryKeys }, '@/services/profileBioService': { profileBioService: service },
  });
  const hook = useUpdateProfileBio('owner');
  await hook.onSuccess({ userId: 'owner', bio: 'new' });
  assert.equal(cache.getQueryData(mine).profile.bio, 'new');
  assert.equal(cache.getQueryData(publicOwner).profile.bio, 'new');
  assert.equal(cache.getQueryData(mine).profile.username, 'owner');
  assert.deepEqual(cache.getQueryData(mine).currentPicks, original.currentPicks);
  assert.equal(cache.getQueryData(other).profile.bio, 'untouched');
  assert.deepEqual(cache.getQueryData(history).pages, [{ items: ['history'] }]);
  assert.equal(original.profile.bio, 'old', 'Cache updates are immutable');
  assert.equal(cache.getQueryState(publicOwner).isInvalidated, true);
  await hook.onSuccess({ userId: 'owner', bio: null });
  assert.equal(cache.getQueryData(publicOwner).profile.bio, null);
  cache.clear();

  let state = [], refs = [], index = 0, refIndex = 0, buttons = [], input;
  let saveCount = 0, failure = false;
  const props = { profileUserId: 'owner', bio: null };
  const auth = { user: { id: 'owner' }, isLoading: false, error: null };
  const mutation = { isPending: false, mutateAsync: async (raw) => {
    saveCount++;
    if (failure) throw new Error('offline');
    const saved = { userId: props.profileUserId, bio: bio.normalizeProfileBio(raw) };
    props.bio = saved.bio; // The mutation hook updates the parent's profile cache.
    return saved;
  } };
  const native = {
    View: part('div'), Text: part('span'), ScrollView: part('main'), Modal: part('div'), ActivityIndicator: () => null,
    PanResponder: { create: (handlers) => ({ panHandlers: handlers }) },
    Platform: { OS: 'ios' },
    StyleSheet: { create: (styles) => styles, absoluteFill: {} },
    Pressable: (p) => { buttons.push(p); return React.createElement('button', null, p.children); },
    TextInput: (p) => { input = p; return React.createElement('textarea', { value: p.value, readOnly: true }); },
  };
  const { ProfileBioEditor } = load('components/profile-bio-editor.tsx', {
    react: { ...React,
      useState: (initial) => { const i = index++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
        return [state[i], (value) => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
      useRef: (initial) => { const i = refIndex++; if (!(i in refs)) refs[i] = { current: initial }; return refs[i]; },
    },
    'react-native': native, '@/hooks/useAuthSession': { useAuthSession: () => auth },
    '@/hooks/useUpdateProfileBio': { useUpdateProfileBio: () => mutation }, '@/lib/profileBio': bio,
  });
  const render = () => { index = 0; refIndex = 0; buttons = []; input = undefined; return renderToStaticMarkup(React.createElement(ProfileBioEditor, props)); };
  const button = (label) => buttons.find((p) => p.accessibilityLabel === label);
  assert.match(render(), /자기소개/); button('자기소개 추가').onPress(); render();
  assert.equal(input.multiline, true); assert.equal(button('자기소개 저장').disabled, true);
  input.onChangeText('취소할 초안'); render();
  assert.equal(saveCount, 0, 'Typing does not publish anything');
  button('자기소개 편집 취소').onPress(); render(); assert.equal(props.bio, null);
  button('자기소개 추가').onPress(); render(); assert.equal(input.value, '');
  input.onChangeText(' 라면과 영화를 좋아해요. '); render();
  const save = button('자기소개 저장'); save.onPress(); save.onPress(); await flush();
  assert.equal(saveCount, 1, 'Double taps save once');
  assert.match(render(), /라면과 영화를 좋아해요/); assert.equal(input, undefined);
  button('자기소개 수정').onPress(); render();
  input.onChangeText('재시도할 자기소개'); render(); failure = true;
  button('자기소개 저장').onPress(); await flush(); assert.match(render(), /저장하지 못했어요/);
  assert.equal(input.value, '재시도할 자기소개'); assert.equal(props.bio, '라면과 영화를 좋아해요.');
  failure = false; button('자기소개 저장').onPress(); await flush(); assert.match(render(), /재시도할 자기소개/);
  button('자기소개 수정').onPress(); render(); input.onChangeText('가'.repeat(101)); render();
  assert.equal(button('자기소개 저장').disabled, true);
  const writesBeforeLimit = saveCount; button('자기소개 저장').onPress(); await flush(); assert.equal(saveCount, writesBeforeLimit);
  input.onChangeText('🍜'.repeat(100)); render(); assert.equal(button('자기소개 저장').disabled, false);
  mutation.isPending = true; render(); assert.equal(input.editable, false);
  assert.equal(button('자기소개 편집 취소').disabled, true); assert.equal(button('자기소개 내용 지우기').disabled, true);
  mutation.isPending = false; render(); button('자기소개 내용 지우기').onPress(); render();
  assert.equal(input.value, ''); button('자기소개 저장').onPress(); await flush(); assert.equal(props.bio, null);
  assert.match(render(), /자기소개를 비웠어요/);
  state = []; refs = []; props.bio = 'x'.repeat(250); render(); button('자기소개 수정').onPress(); render();
  assert.equal(input.value.length, 250, 'Pre-existing long bios are not silently truncated');
  assert.equal(button('자기소개 저장').disabled, true);
  auth.user = null; assert.equal(render(), '');
  auth.user = { id: 'other' }; assert.equal(render(), '');
  auth.user = { id: 'owner' }; auth.isLoading = true; assert.equal(render(), '');
  auth.isLoading = false; auth.error = new Error('auth'); assert.equal(render(), ''); auth.error = null;
  const key = ProfileBioEditor(props).key; props.profileUserId = 'other'; auth.user = { id: 'other' };
  assert.notEqual(ProfileBioEditor(props).key, key, 'Account changes remount the editor');

  const publicData = { profile: { id: 'owner', username: 'owner', bio: '영화와 라면\n<script>plain text</script>' }, currentPicks: [], isMine: false };
  const { default: PublicProfile } = load('app/(tabs)/(profile)/u/[username].tsx', { '@/lib/profile/profileName': { profileDisplayName: (p) => p.nickname?.trim() || p.username, profileNickname: (p) => p.nickname?.trim() || null }, '@/lib/navigation/swipeBack': { useSwipeBackHandler() {} },
    'expo-router': {
      useLocalSearchParams: () => ({ username: 'owner' }),
      useRouter: () => ({ back() {}, push() {}, replace() {}, canGoBack: () => false, dismissTo() {} }),
      useNavigation: () => ({ addListener: () => () => {}, getState: () => ({ index: 0, routes: [] }), dispatch() {} }),
    },
    'expo-linking': { createURL: () => 'onepick://auth/callback' },
    'react-native': native, 'react-native-safe-area-context': { SafeAreaView: part('section') },
    '@/components/block-user-button': { BlockUserButton: () => null }, '@/components/follow-button': { FollowButton: () => null }, '@/components/follow-connections-view': { FollowConnectionsView: () => null }, '@/components/pick-photo': { PickPhoto: () => null },
    '@/components/profile-pick-card': { ProfilePickCard: () => null },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } }),
    '@/components/profile-pick-groups': { ProfilePickGroups: () => null }, '@/lib/profile/profileAvatar': { profileAvatarUrl: () => null }, '@/lib/profile/profilePickGroups': { splitLabPicks: (picks) => ({ main: picks, lab: [] }), filterMainProfileByChannel: (picks) => picks, isLabCategory: () => false }, '@/components/profile-lab-entry': { ProfileLabEntry: () => null }, 
    '@/components/profile-social-links': { ProfileSocialLinks: () => null }, '@/components/profile-follow-counts': { ProfileFollowCounts: () => null }, '@/components/report-action': { ReportAction: () => null },
    '@/components/profile-ai-comment': { ProfileAiComment: () => null },
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: null }) },
    '@/hooks/useRegisterPick': { useRegistrationCategories: () => ({ data: [] }) },
    '@/hooks/useExploreData': { useExploreCategories: () => ({ data: [] }) },
    '@/hooks/useProfileAi': { useProfileAiComment: () => ({ data: null }) },
    '@/hooks/useFollow': { usePublicFollowCounts: () => ({ data: { followerCount: 0, followingCount: 0 } }) },
    '@/hooks/usePublicProfile': { usePublicProfile: () => ({ data: publicData, isPending: false, isError: false }) },
    '@/hooks/useSocialSignIn': { useSocialSignIn: () => ({ isPending: false, isError: false, mutateAsync: async () => null }) },
    '@/lib/auth/authIntent': { getPostAuthRoute: () => ({ pathname: '/u/[username]', params: { username: 'owner' } }) },
    '@/lib/auth/followProfileIntent': { armFollowProfileIntent: () => true, clearFollowProfileIntent() {}, consumeFollowProfileIntent: () => false },
    '@/lib/share/shareProfile': { shareProfile: async () => {} },
    '@/lib/share/shareProfileCard': { shareProfileCardImage: async () => 'shared' },
    '@/lib/seedProfiles': { isSeedProfileId: () => false },
  });
  const publicMarkup = renderToStaticMarkup(React.createElement(PublicProfile));
  assert.match(publicMarkup, /영화와 라면/); assert.match(publicMarkup, /&lt;script&gt;/);
  assert.doesNotMatch(publicMarkup, /<script>|<textarea|자기소개 수정/);
  publicData.profile.bio = null;
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(PublicProfile)), /영화와 라면|자기소개를 비웠어요/);
  console.log('Profile bio passed: validation, Unicode, owner-only writes, null removal, narrow columns, cache preservation, edit/cancel/retry/double taps, account isolation and public plain-text rendering.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
