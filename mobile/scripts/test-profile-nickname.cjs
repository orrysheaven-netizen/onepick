const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, require: (name) => {
    if (name in imports) return imports[name];
    throw new Error('Unexpected import: ' + name);
  } });
  return exports;
}

async function main() {
  const names = load('lib/profileNickname.ts');
  assert.equal(names.profileNicknameLength('🍜'), 1);
  assert.equal(names.profileNicknameLength('👨‍👩‍👧‍👦'), 7);
  assert.equal(names.normalizeProfileNickname('  오리  '), '오리');
  assert.equal(names.normalizeProfileNickname('  '), null);
  assert.equal(names.normalizeProfileNickname(''), null);
  assert.equal(names.normalizeProfileNickname('가'.repeat(15)), '가'.repeat(15));
  assert.throws(() => names.normalizeProfileNickname('가'.repeat(16)), /15자/);
  assert.throws(() => names.normalizeProfileNickname('👨‍👩‍👧‍👦'.repeat(3)), /15자/);
  assert.throws(() => names.normalizeProfileNickname(null), /닉네임/);
  assert.equal(names.nicknameQuestionPreview('오리'), '오리님의 곱창 원픽은?');
  assert.equal(names.nicknameQuestionPreview(null), '원픽 사용자의 곱창 원픽은?');

  class AppError extends Error { constructor(code) { super(code); this.code = code; } }
  let currentUserId = 'owner', authError = null, dbError = null;
  let responseId = 'owner', writes = 0, query, values, selected;
  const chain = {
    update: (v) => { writes++; values = v; return chain; },
    eq: (key, v) => { query = [key, v]; return chain; },
    select: (v) => { selected = v; return chain; },
    single: async () => ({ data: dbError ? null : { id: responseId, nickname: values.nickname }, error: dbError }),
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: currentUserId ? { id: currentUserId } : null }, error: authError }) },
    from: (table) => { assert.equal(table, 'profiles'); return chain; },
  };
  const { ProfileNicknameService } = load('services/profileNicknameService.ts', {
    '@/errors/appError': { AppError },
    '@/errors/mapSupabaseError': { mapSupabaseError: (err) => err },
    '@/lib/profileNickname': names,
    '@/lib/supabase/client': { supabase: client },
  });
  const service = new ProfileNicknameService(client);
  assert.equal((await service.update('owner', ' 오리 ')).nickname, '오리');
  assert.deepEqual(Object.keys(values), ['nickname']);
  assert.deepEqual(Array.from(query), ['id', 'owner']);
  assert.equal(selected, 'id,nickname');
  assert.equal((await service.update('owner', ' ')).nickname, null);
  const previous = writes;
  for (const userId of [null, 'other']) {
    currentUserId = userId;
    await assert.rejects(() => service.update('owner', 'stale'), (err) => err.code === 'AUTH_REQUIRED');
  }
  assert.equal(writes, previous, 'No writes for another account');
  currentUserId = 'owner';
  await assert.rejects(() => service.update('owner', 'a'.repeat(16)), /15자/);
  assert.equal(writes, previous, 'Overlong draft must not reach the DB');
  authError = new Error('offline'); await assert.rejects(() => service.update('owner', 'a'), /offline/); authError = null;
  dbError = new Error('save failed'); await assert.rejects(() => service.update('owner', 'a'), /save failed/); dbError = null;
  responseId = 'other'; await assert.rejects(() => service.update('owner', 'a'), (e) => e.code === 'PROFILE_NOT_FOUND');
  responseId = 'owner';
  let authCalls = 0;
  client.auth.getUser = async () => {
    authCalls++;
    return { data: { user: { id: authCalls === 1 ? 'owner' : 'other' } }, error: null };
  };
  await assert.rejects(() => service.update('owner', 'stale'), (e) => e.code === 'AUTH_REQUIRED',
    'A login switch during a response must not report success');
  const files = ['app/settings.tsx', 'app/settings/nickname.tsx', 'types/domain/profile.ts',
    'repositories/mappers/profileMapper.ts', 'lib/supabase/database.types.ts'];
  const sources = files.map((file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'));
  const featureSource = fs.readFileSync(path.join(__dirname, '../src/constants/onepick.ts'), 'utf8');
  // User decision 2026-10-11: nickname editing ships with the home/profile/comment display rollout.
  assert.match(featureSource, /nicknameEditing: true/);
  assert.ok(sources[0].indexOf('nicknameEditing ?') < sources[0].indexOf('계정 삭제</Text>'));
  assert.match(sources[0], /OnePickFeatures\.nicknameEditing \?/);
  assert.match(sources[1], /!OnePickFeatures\.nicknameEditing/);
  assert.match(sources[0], /router\.push\('\/settings\/nickname'\)/);
  assert.match(sources[1], /key=\{user\.id\}/);
  assert.match(sources[1], /nicknameQuestionPreview\(draft\)/);
  assert.match(sources[1], /disabled=\{disabled\}/);
  assert.match(sources[2], /nickname: string \| null/);
  assert.match(sources[3], /nickname: row\.nickname/);
  assert.match(sources[4].slice(sources[4].indexOf('      profiles: {')), /nickname: string \| null/);
  console.log('profile nickname contract passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
