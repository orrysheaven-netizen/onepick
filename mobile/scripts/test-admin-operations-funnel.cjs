const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      if (name in imports) return imports[name];
      throw new Error('Unexpected dependency: ' + name);
    },
  });
  return exports;
}

async function main() {
  let rpcName, rpcParams;
  const snapshotData = {
    metrics: {
      profiles: 2, active_picks: 8, comments: 3,
      active_items: 140, pending_items: 1, open_reports: 0,
    },
    funnel: {
      days: 7, pick_created: 4, pick_share_clicked: 3,
      pick_link_opened: 2, item_detail_viewed: 9,
      auth_started: 5, auth_completed: 4,
    },
    generated_at: '2026-09-19T00:00:00Z',
  };
  const client = {
    rpc: async (name, params) => {
      rpcName = name; rpcParams = params;
      return { data: snapshotData, error: null };
    },
  };
  const { SupabaseAdminRepository } = load('repositories/supabase/supabaseAdminRepository.ts', {
    '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
    '@/errors/appError': { AppError: class AppError extends Error {} },
    '@/repositories/mappers/brandMapper': { mapBrandRow: (row) => row },
    '@/repositories/mappers/categoryMapper': { mapCategoryRow: (row) => row },
    '@/repositories/mappers/itemMapper': { mapItemRow: (row) => row },
  });
  const repository = new SupabaseAdminRepository(client);
  const snapshot = await repository.getOperationsSnapshot(7);
  assert.equal(rpcName, 'admin_operations_snapshot');
  assert.equal(rpcParams.p_days, 7);
  assert.equal(snapshot.metrics.profiles, 2);
  assert.equal(snapshot.metrics.activePicks, 8);
  assert.equal(snapshot.funnel.pickCreated, 4);
  assert.equal(snapshot.funnel.pickShareClicked, 3);
  assert.equal(snapshot.funnel.pickLinkOpened, 2);
  assert.equal(snapshot.funnel.itemDetailViewed, 9);
  assert.equal(snapshot.funnel.authStarted, 5);
  assert.equal(snapshot.funnel.authCompleted, 4);
  assert.equal(snapshot.generatedAt, '2026-09-19T00:00:00Z');

  const { AdminService } = load('services/adminService.ts', {
    '@/errors/appError': { AppError: class AppError extends Error { constructor(code) { super(code); this.code = code; } } },
    '@/lib/categories/categoryTree': { selectableCategories: () => [] },
    '@/lib/items/itemIdentity': { canonicalItemName: (name) => name },
  });
  const serviceRepo = {
    isAdmin: async () => true,
    getOperationsSnapshot: async () => snapshot,
    getAuditLogs: async () => [],
    getClientErrorEvents: async () => [],
  };
  const service = new AdminService(serviceRepo, {});
  const overview = await service.getOperationsOverview();
  assert.equal(overview.metrics.profiles, 2);
  assert.equal(overview.funnel.days, 7);
  assert.equal(overview.funnel.itemDetailViewed, 9);
  assert.equal(overview.errorSummary.length, 0);

  const source = fs.readFileSync(path.join(__dirname, '../src/app/admin/ops.tsx'), 'utf8');
  assert.match(source, /최근 \{query\.data\.funnel\.days\}일 퍼널/);
  assert.match(source, /DEMO 제외/);
  assert.match(source, /원픽 등록/);
  assert.match(source, /공유 링크 방문/);
  assert.match(source, /로그인 완료/);

  console.log('Admin operations funnel checks passed: RPC mapping, service overview and demo-filtered UI copy.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
