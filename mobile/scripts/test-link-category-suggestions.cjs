const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, mocks = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', relative), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObject = {};
  vm.runInNewContext(output, {
    exports: exportsObject,
    URL,
    Response,
    require: (name) => {
      if (name in mocks) return mocks[name];
      assert.fail('Unexpected runtime dependency: ' + name);
    },
  });
  return exportsObject;
}

class TestAppError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function main() {
  const calls = [];
  const response = {
    kind: 'place',
    inputUrl: 'https://naver.me/example',
    canonicalUrl: 'https://map.naver.com/example',
    host: 'map.naver.com',
    title: '대성집',
    description: null,
    resolvedName: '대성집',
    needsName: false,
    places: [{
      catalogId: '11111111-1111-4111-8111-111111111111',
      name: '대성집',
      branchName: null,
      roadAddress: '서울 종로구 테스트로 1',
      address: null,
      region1: '서울',
      region2: '종로구',
      providerCategory: '한식 > 곰탕/설렁탕',
    }],
    suggestions: [{
      categoryId: '22222222-2222-4222-8222-222222222222',
      label: '먹을것 › 국/탕/찌개/밥 › 곰탕',
      name: '곰탕',
      reason: '“곰탕” 표현과 일치',
    }],
    categories: [{
      categoryId: '22222222-2222-4222-8222-222222222222',
      label: '먹을것 › 국/탕/찌개/밥 › 곰탕',
      name: '곰탕',
    }],
  };

  const client = {
    functions: {
      invoke: async (slug, input) => {
        calls.push({ slug, input });
        return { data: response, error: null };
      },
    },
  };

  const { SupabaseLinkCategorySuggestionRepository } = load(
    'repositories/supabase/supabaseLinkCategorySuggestionRepository.ts',
    { '@/errors/appError': { AppError: TestAppError } },
  );
  const repository = new SupabaseLinkCategorySuggestionRepository(client);
  const result = await repository.suggest({ url: 'https://naver.me/example', name: '대성집' });
  assert.equal(result.kind, 'place');
  assert.equal(result.places[0].name, '대성집');
  assert.equal(result.suggestions[0].name, '곰탕');
  assert.equal(calls[0].slug, 'link-category-suggestions');
  assert.equal(calls[0].input.body.name, '대성집');

  const { LinkCategorySuggestionService } = load(
    'services/linkCategorySuggestionService.ts',
    { '@/errors/appError': { AppError: TestAppError } },
  );
  const serviceCalls = [];
  const service = new LinkCategorySuggestionService({
    suggest: async (input) => { serviceCalls.push(input); return response; },
  });
  await service.suggest({ url: ' https://naver.me/example ', name: '  대성집  ' });
  assert.equal(serviceCalls[0].url, 'https://naver.me/example');
  assert.equal(serviceCalls[0].name, '대성집');
  await assert.rejects(
    async () => service.suggest({ url: 'http://naver.me/example' }),
    (error) => error.code === 'ITEM_NOT_ELIGIBLE',
  );

  const screen = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'pick', 'link.tsx'), 'utf8');
  assert.match(screen, /링크로 원픽 찾기/);
  assert.match(screen, /다른 카테고리 찾기/);
  assert.match(screen, /placeCatalogId: selectedPlace\.catalogId/);
  assert.match(screen, /pathname: '\/pick\/request'/);
  assert.match(screen, /action: 'suggest_link_category'/);
  assert.match(screen, /linkUrl/);
  assert.doesNotMatch(screen, /result\.categories\.map\(/,
    'The full category taxonomy must not be rendered by default; only filtered search results are shown');

  const finder = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'pick', 'find.tsx'), 'utf8');
  assert.match(finder, /링크로 카테고리 추천받기/);
  assert.match(finder, /router\.push\('\/pick\/link'\)/);

  const edge = fs.readFileSync(
    path.join(__dirname, '..', '..', 'supabase', 'functions', 'link-category-suggestions', 'index.ts'),
    'utf8',
  );
  assert.match(edge, /redirect: 'manual'/);
  assert.match(edge, /naverHost\(next\.hostname\)/,
    'Every followed redirect must remain on a Naver-owned host');
  assert.match(edge, /next\.protocol !== 'https:'/);
  assert.match(edge, /reserve_external_catalog_slot/);
  assert.match(edge, /p_provider: 'naver_link'/);
  assert.match(edge, /auth\.getUser/);
  assert.match(edge, /catalog_user_is_suspended/);
  assert.match(edge, /category_search_terms/);
  assert.match(edge, /place_catalog/);
  assert.doesNotMatch(edge, /api\.openai\.com|OPENAI_API_KEY/,
    'MVP link category suggestions must not add paid AI calls');
  const onlineBranch = edge.slice(edge.indexOf("const kind = naverHost"), edge.indexOf("const resolvedName"));
  assert.match(onlineBranch, /if \(kind === 'place'\)/,
    'Only Naver place links may trigger an outbound metadata fetch');
  assert.doesNotMatch(onlineBranch, /fetch\(parsed|fetch\(canonicalUrl/,
    'Arbitrary online URLs must never be fetched server-side');

  console.log('Link category suggestion checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
