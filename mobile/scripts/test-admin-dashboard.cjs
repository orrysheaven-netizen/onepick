const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name) => { assert.ok(name in imports, name); return imports[name]; } });
  return exports;
}

async function main() {
  const { AppError } = load('errors/appError.ts');
  const { mapSupabaseError } = load('errors/mapSupabaseError.ts', { './appError': { AppError } });
  const { mapProfileRow } = load('repositories/mappers/profileMapper.ts');
  const { SupabaseProfileRepository } = load('repositories/supabase/supabaseProfileRepository.ts', {
    '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError },
    '@/repositories/mappers/profileMapper': { mapProfileRow },
  });
  const { AdminService } = load('services/adminService.ts', {
    '@/errors/appError': { AppError },
    '@/lib/categories/categoryTree': load('lib/categories/categoryTree.ts'),
    '@/lib/items/itemIdentity': load('lib/items/itemIdentity.ts'),
  });

  const ids = Array.from({ length: 500 }, (_, i) => `f8300000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const profileRows = new Map(ids.map((id, i) => [id, {
    id, username: `submitter_${i}`, profile_image_url: null, bio: null,
    onboarding_completed: true, created_at: '2026-09-17', updated_at: '2026-09-17',
  }]));
  let profileReads = [], failId;
  const unavailable = { code: 'PGRST301', message: 'Session expired' };
  const client = { from: (table) => {
    assert.equal(table, 'profiles');
    return { select: (columns) => {
      assert.equal(columns, '*');
      return { in: async (column, values) => {
        assert.equal(column, 'id');
        profileReads.push(Array.from(values));
        if (failId && values.includes(failId)) return { data: null, error: unavailable };
        // Database order differs from request order; RLS may omit rows.
        return { data: Array.from(values).reverse().flatMap((id) => profileRows.has(id) ? [profileRows.get(id)] : []), error: null };
      } };
    } };
  } };
  const profiles = new SupabaseProfileRepository(client);
  profiles.getById = async () => { assert.fail('Admin must not issue a per-request profile read'); };
  let allowed = true, dashboardReads = 0;
  let pending = ids.map((id, index) => ({ id: `request_${index}`, createdBy: id }));
  const categories = [{ id: 'category' }], items = [{ id: 'item' }], brands = [], aliases = [];
  const repo = {
    isAdmin: async () => allowed,
    getCategories: async () => { dashboardReads++; return categories; },
    getBrands: async () => { dashboardReads++; return brands; },
    getItems: async () => { dashboardReads++; return items; },
    getPendingItems: async () => { dashboardReads++; return pending; },
    getItemAliases: async () => { dashboardReads++; return aliases; },
  };
  const service = new AdminService(repo, profiles);
  profileRows.delete(ids[7]);
  let dashboard = await service.getDashboard();
  assert.ok(profileReads.length <= 5, 'A full 500-author queue must use at most five profile requests');
  assert.equal(new Set(profileReads.flat()).size, 500);
  assert.ok(profileReads.every((batch) => batch.length <= 100), 'UUID filters must stay within the URL budget');
  assert.equal(dashboard.pending.length, 500, 'Unavailable authors must not remove moderation requests');
  dashboard.pending.forEach((item, index) => {
    assert.equal(item.item.id, `request_${index}`, 'Oldest-first moderation order must be retained');
    assert.equal(item.submitter?.username ?? null, index === 7 ? null : `submitter_${index}`);
  });
  assert.equal(dashboard.categories, categories);
  assert.equal(dashboard.items, items);
  assert.equal(dashboard.brands, brands);
  assert.equal(dashboard.aliases, aliases);

  profileReads = [];
  pending = Array.from({ length: 500 }, (_, i) => ({ id: `repeat_${i}`, createdBy: i === 499 ? null : ids[0] }));
  dashboard = await service.getDashboard();
  assert.equal(profileReads.length, 1, 'Repeated authors must be fetched only once');
  assert.equal(profileReads[0].length, 1);
  assert.equal(dashboard.pending[499].submitter, null, 'Deleted accounts must remain reviewable');

  profileReads = []; pending = [];
  dashboard = await service.getDashboard();
  assert.equal(profileReads.length, 0, 'An empty queue must not make a profile request');
  assert.equal(dashboard.pending.length, 0);
  pending = [{ id: 'orphan', createdBy: null }];
  await service.getDashboard();
  assert.equal(profileReads.length, 0, 'Null authors must not create a query');

  pending = ids.map((id, i) => ({ id: `request_${i}`, createdBy: id }));
  failId = ids[250];
  await assert.rejects(() => service.getDashboard(), (error) => error.code === 'AUTH_REQUIRED',
    'A failed batch must surface through normal error handling instead of returning a misleading partial queue');
  failId = undefined; profileReads = [];
  assert.equal((await service.getDashboard()).pending.length, 500, 'A retry must recover the complete queue');

  allowed = false; profileReads = []; dashboardReads = 0;
  await assert.rejects(() => service.getDashboard(), (error) => error.code === 'FORBIDDEN');
  assert.equal(profileReads.length, 0);
  assert.equal(dashboardReads, 0, 'Authorization must happen before any dashboard data read');
  console.log('Admin dashboard checks passed: bounded author lookups, deduplication, stable queue order, missing profiles, retry and authorization.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
