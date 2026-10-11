const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(relative, imports, env = {}) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, process: { env }, require: (name) => {
    assert.ok(name in imports, 'Unexpected dependency: ' + name);
    return imports[name];
  } });
  return exports;
}
const mapper = load('src/repositories/mappers/profileMapper.ts', {}, {
  EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co/',
});
const { NotificationService } = load('src/services/notificationService.ts', {
  '@/lib/profile/profileImage': mapper,
  '@/lib/supabase/client': { supabase: {} },
  '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
});
const own = 'f1220000-0000-4000-8000-000000000001/0b6f8a52-3c1e-4d7a-9f10-2a3b4c5d6e7f.jpg';
async function main() {
  const values = [own, null, 'https://tracker.example/pixel.jpg', '../other/x.jpg'];
  const service = new NotificationService({ rpc: async () => ({ error: null,
    data: values.map((photo, index) => ({
      group_id: 'group-' + index, kind: 'comment', latest_at: '2026-10-08T00:00:00Z',
      snapshot: 'snapshot', unread_count: 1, total_count: 1, actor_count: 1,
      actor: { user_id: 'actor', username: 'name', profile_image_url: photo },
      target: { pick_id: 'pick' },
    })),
  }) });
  const page = await service.page('viewer', null);
  assert.equal(page.items.length, 4);
  assert.equal(page.items[0].actor.profile_image_url,
    'https://project.supabase.co/storage/v1/object/public/profile-images/' + own);
  for (const row of page.items.slice(1)) assert.equal(row.actor.profile_image_url, null);
  assert.equal(page.items[0].actor.username, 'name');
  assert.equal(page.items[0].target.pick_id, 'pick');
  assert.equal(page.nextCursor, null);
  console.log('Notification profile photo checks passed: own storage URL, absent/remote/invalid paths, unchanged target.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
