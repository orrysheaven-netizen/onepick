const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const { QueryClient } = require('@tanstack/react-query');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name) => { assert.ok(name in imports, name); return imports[name]; } });
  return exports;
}
const id = (i) => `f9100000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
const time = '2026-09-17T10:00:00.123456+00:00';
const micros = (value) => BigInt(Date.parse(value)) * 1000n + BigInt((value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(3));
const compare = (a, b, column) => {
  const delta = micros(a[column]) - micros(b[column]);
  return delta < 0n ? -1 : delta > 0n ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};
const row = (i, timestamp = time) => ({
  id: id(i), user_id: id(1000 + i), product_id: id(900), category_id: id(901), pick_id: id(902),
  status: 'active', one_line_review: `Pick ${i}`, body: `Comment ${i}`,
  started_at: timestamp, created_at: timestamp, updated_at: timestamp,
  profile: null, category: null, product: null, author: null,
});

async function main() {
  const { AppError } = load('errors/appError.ts');
  const { mapSupabaseError } = load('errors/mapSupabaseError.ts', { './appError': { AppError } });
  const imports = { '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError } };
  for (const name of ['category', 'comment', 'pick', 'product', 'profile']) {
    imports[`@/repositories/mappers/${name}Mapper`] = load(`repositories/mappers/${name}Mapper.ts`);
  }
  const { SupabaseReadRepository } = load('repositories/supabase/supabaseReadRepository.ts', imports);
  let picks = [], comments = [], calls = [], fail = false;
  // Real Supabase/PostgREST query builders, with an in-memory HTTP boundary.
  const client = createClient('https://onepick.test', 'public-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      if (fail) return new Response(JSON.stringify({ code: 'PGRST301', message: 'Session expired' }), { status: 401 });
      const table = url.pathname.split('/').pop();
      assert.ok(['picks', 'comments'].includes(table));
      const params = url.searchParams;
      assert.equal(params.has('offset'), false, 'Infinite reads must not use positional offsets');
      const [column, direction] = params.get('order').split(',')[0].split('.');
      assert.equal(params.get('order'), `${column}.${direction},id.${direction}`, 'Equal timestamps need deterministic UUID ordering');
      let rows = table === 'picks' ? picks : comments;
      for (const field of ['user_id', 'category_id', 'product_id', 'pick_id']) {
        const value = params.get(field);
        if (value?.startsWith('eq.')) rows = rows.filter((item) => item[field] === value.slice(3));
        if (value?.startsWith('neq.')) rows = rows.filter((item) => item[field] !== value.slice(4));
      }
      if (params.has('status')) {
        const statuses = params.get('status').slice(4, -1).split(',');
        rows = rows.filter((item) => statuses.includes(item.status));
      }
      if (params.has('or')) {
        const expression = params.get('or');
        const match = expression.match(/^\((started_at|created_at|updated_at)\.(lt|gt)\.([^,]+),and\(\1\.eq\.([^,]+),id\.\2\.([a-f0-9-]+)\)\)$/);
        assert.ok(match, `Malformed cursor filter: ${expression}`);
        assert.equal(match[1], column); assert.equal(match[3], match[4]);
        const cursor = { [column]: match[3], id: match[5] };
        rows = rows.filter((item) => match[2] === 'lt' ? compare(item, cursor, column) < 0 : compare(item, cursor, column) > 0);
      }
      rows = [...rows].sort((a, b) => compare(a, b, column) * (direction === 'asc' ? 1 : -1));
      return new Response(JSON.stringify(rows.slice(0, Number(params.get('limit')))), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    } },
  });
  const repo = new SupabaseReadRepository(client);
  const { ExploreService } = load('services/exploreService.ts');
  const { CommentService } = load('services/commentService.ts', { '@/errors/appError': { AppError } });
  const explore = new ExploreService({ getOpenCategories: async () => [{ id: id(901), name: 'Category' }] }, repo);
  const commentService = new CommentService({}, {}, {}, repo);

  picks = Array.from({ length: 45 }, (_, i) => row(i + 1));
  const first = await explore.getExploreData(id(901));
  assert.equal(first.feed.length, 20);
  assert.equal(first.nextCursor.id, id(26), 'The cursor must be the last displayed row, not the lookahead');
  assert.equal(first.nextCursor.timestamp, time, 'Microsecond precision must survive the round trip');
  picks.push(row(100, '2026-09-17T10:00:00.123457+00:00'));
  picks = picks.filter((item) => item.id !== id(45) && item.id !== id(26));
  const second = await explore.getExploreData(id(901), first.nextCursor);
  const third = await explore.getExploreData(id(901), second.nextCursor);
  assert.equal(second.feed[0].pick.id, id(25), 'New/deleted rows before a cursor must not shift the next page');
  assert.equal(third.feed.length, 5); assert.equal(third.nextCursor, null);
  const allIds = [...first.feed, ...second.feed, ...third.feed].map((item) => item.pick.id);
  assert.equal(new Set(allIds).size, 45, 'Dense timestamp ties must have no duplicated or skipped original items');
  assert.equal((await explore.getExploreData(id(901))).feed[0].pick.id, id(100), 'Refreshing from the beginning discovers new Picks');
  assert.equal((await explore.getExploreData(id(999))).feed.length, 0, 'A category change starts an isolated feed');

  comments = Array.from({ length: 45 }, (_, i) => row(i + 1));
  const firstComments = await commentService.getComments(id(902));
  assert.equal(firstComments.nextCursor.id, id(20));
  comments = comments.filter((item) => item.id !== id(1) && item.id !== id(20));
  comments.push(row(46, '2026-09-17T10:00:00.123457+00:00'));
  const secondComments = await commentService.getComments(id(902), firstComments.nextCursor);
  const lastComments = await commentService.getComments(id(902), secondComments.nextCursor);
  assert.equal(secondComments.items[0].comment.id, id(21), 'Deleting an earlier comment must not skip the next one');
  assert.equal(lastComments.items.at(-1).comment.id, id(46));
  assert.equal(lastComments.nextCursor, null);
  assert.equal(new Set([...firstComments.items, ...secondComments.items, ...lastComments.items].map((item) => item.comment.id)).size, 46);
  assert.equal((await commentService.getComments(id(999))).items.length, 0, 'Comments remain scoped to their Pick');

  picks = [row(1), row(2, '2026-09-17T10:00:00.123457+00:00')];
  let precise = await explore.getExploreData(undefined, null, 1);
  assert.equal(precise.feed[0].pick.id, id(2));
  precise = await explore.getExploreData(undefined, precise.nextCursor, 1);
  assert.equal(precise.feed[0].pick.id, id(1), 'Rows separated by less than a millisecond remain reachable');

  for (const cursor of [
    { timestamp: `${time},id.gt.0`, id: id(1) },
    { timestamp: time, id: `${id(1)},status.eq.hidden` },
    { timestamp: '2026-99-99T00:00:00Z', id: id(1) },
  ]) {
    const before = calls.length;
    await assert.rejects(() => repo.getPicks({ cursor }), /INVALID_PAGINATION_CURSOR/);
    await assert.rejects(() => repo.getCommentsByPickId(id(902), 20, cursor), /INVALID_PAGINATION_CURSOR/);
    assert.equal(calls.length, before, 'Malformed cursors must not reach the API');
  }
  picks = Array.from({ length: 120 }, (_, i) => row(i + 1));
  const large = await explore.getExploreData(undefined, null, 500);
  assert.equal(large.feed.length, 99); assert.ok(large.nextCursor, 'Lookahead must fit within the repository limit');
  fail = true;
  await assert.rejects(() => explore.getExploreData(undefined, large.nextCursor), (error) => error.code === 'AUTH_REQUIRED');
  fail = false;
  assert.equal((await explore.getExploreData(undefined, large.nextCursor)).feed[0].pick.id, id(21), 'Retry resumes the same cursor');

  const { queryKeys } = load('lib/query/queryKeys.ts');
  const hooksImports = {
    '@tanstack/react-query': { useInfiniteQuery: (options) => options },
    '@/lib/query/queryKeys': { queryKeys }, '@/services': { exploreService: explore, commentService },
  };
  const { useExploreData } = load('hooks/useExploreData.ts', hooksImports);
  const { usePickComments } = load('hooks/usePickComments.ts', hooksImports);
  const feedOptions = useExploreData(id(901)), commentOptions = usePickComments(id(902));
  assert.equal(feedOptions.initialPageParam, null); assert.equal(commentOptions.initialPageParam, null);
  assert.notEqual(JSON.stringify(feedOptions.queryKey), JSON.stringify(useExploreData(id(999)).queryKey));
  assert.equal(usePickComments().enabled, false);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    picks = Array.from({ length: 45 }, (_, i) => row(i + 1));
    const fetched = await queryClient.fetchInfiniteQuery({ ...feedOptions, pages: 3 });
    assert.equal(fetched.pages.length, 3);
    assert.equal(feedOptions.select(fetched).feed.length, 45);
    assert.equal(fetched.pageParams[1].id, id(26));
    assert.equal(feedOptions.getNextPageParam(fetched.pages[2]), undefined);
    const fetchedComments = await queryClient.fetchInfiniteQuery({ ...commentOptions, pages: 3 });
    assert.equal(commentOptions.select(fetchedComments).length, comments.length);
  } finally { queryClient.clear(); }
  console.log('Pagination checks passed: real query builders, timestamp ties, insert/delete stability, precision, cursor validation, filters, retries and infinite-query wiring.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
