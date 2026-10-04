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
        if (input?.body?.action === 'attach_pending_link') return { data: { ok: true }, error: null };
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
  await repository.attachPendingLink(
    '33333333-3333-4333-8333-333333333333',
    'https://shop.example/product',
  );
  assert.equal(calls[1].input.body.action, 'attach_pending_link');
  assert.equal(calls[1].input.body.url, 'https://shop.example/product');

  // #313: seeded fixed category ids are valid UUID strings without version/variant bits.
  const fixedRamenId = '10000000-0000-0000-0000-000000000001';
  const fixedResponse = {
    ...response,
    suggestions: [{ categoryId: fixedRamenId, label: '먹을것 › 면 › 라면', name: '라면', reason: '“라면” 표현과 일치' }],
    categories: [{ categoryId: fixedRamenId, label: '먹을것 › 면 › 라면', name: '라면' }],
  };
  const repositoryFor = (data) => new SupabaseLinkCategorySuggestionRepository({
    functions: { invoke: async () => ({ data, error: null }) },
  });
  const fixed = await repositoryFor(fixedResponse).suggest({ url: 'https://naver.me/example' });
  assert.equal(fixed.suggestions[0].categoryId, fixedRamenId);
  assert.equal(fixed.categories[0].categoryId, fixedRamenId);
  for (const badId of ['not-a-uuid', '10000000000000000000000000000001', '10000000-0000-0000-0000-00000000000g', '']) {
    await assert.rejects(
      async () => repositoryFor({ ...fixedResponse, categories: [{ ...fixedResponse.categories[0], categoryId: badId }] })
        .suggest({ url: 'https://naver.me/example' }),
      (error) => error.code === 'INTERNAL_ERROR',
      'Non-UUID category id must still be rejected: ' + JSON.stringify(badId),
    );
  }

  const { LinkCategorySuggestionService } = load(
    'services/linkCategorySuggestionService.ts',
    { '@/errors/appError': { AppError: TestAppError } },
  );
  const serviceCalls = [];
  const attachCalls = [];
  const service = new LinkCategorySuggestionService({
    suggest: async (input) => { serviceCalls.push(input); return response; },
    attachPendingLink: async (itemId, url) => { attachCalls.push({ itemId, url }); },
  });
  await service.suggest({ url: ' https://naver.me/example ', name: '  대성집  ' });
  assert.equal(serviceCalls[0].url, 'https://naver.me/example');
  assert.equal(serviceCalls[0].name, '대성집');
  await assert.rejects(
    async () => service.suggest({ url: 'http://naver.me/example' }),
    (error) => error.code === 'ITEM_NOT_ELIGIBLE',
  );
  await service.attachPendingLink(
    '33333333-3333-4333-8333-333333333333',
    ' https://shop.example/product ',
  );
  assert.equal(attachCalls[0].url, 'https://shop.example/product');
  await assert.rejects(
    async () => service.attachPendingLink('bad-id', 'https://shop.example/product'),
    (error) => error.code === 'ITEM_NOT_FOUND',
  );

  const screen = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'pick', 'link.tsx'), 'utf8');
  assert.match(screen, /링크로 원픽 찾기/);
  assert.match(screen, /다른 카테고리 찾기/);
  assert.match(screen, /placeCatalogId: selectedPlace\.catalogId/);
  assert.match(screen, /pathname: '\/pick\/request'/);
  assert.match(screen, /sourceUrl: result\.canonicalUrl/);
  assert.match(screen, /카테고리 없이 등록 요청/,
    'Online links outside the matched taxonomy can still be requested without a category');
  assert.match(screen, /\.\.\.\(categoryId \? \{ categoryId \} : \{\}\)/,
    'The uncategorized request must not send an empty categoryId');
  assert.match(screen, /action: 'suggest_link_category'/);
  assert.match(screen, /linkUrl/);
  assert.doesNotMatch(screen, /result\.categories\.map\(/,
    'The full category taxonomy must not be rendered by default; only filtered search results are shown');

  const finder = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'pick', 'find.tsx'), 'utf8');
  // Category suggestion by link is not offered from the finder any more; /pick/link stays
  // reachable only for in-flight login returns (suggest_link_category).
  assert.doesNotMatch(finder, /링크로 카테고리 추천받기/, 'The finder must not offer link category suggestions');
  assert.doesNotMatch(finder, /\/pick\/link/, 'The finder must not link to the link suggestion screen');

  const edge = fs.readFileSync(
    path.join(__dirname, '..', '..', 'supabase', 'functions', 'link-category-suggestions', 'index.ts'),
    'utf8',
  );
  assert.match(edge, /redirect: 'manual'/);
  assert.match(edge, /naverHost\(next\.hostname\)/,
    'Every followed redirect must remain on a Naver-owned host');
  assert.match(edge, /next\.protocol !== 'https:'/);
  assert.match(edge, /reserve_external_catalog_slot/);
  assert.match(edge, /reserveSlot\(client, 'naver_link', 800, 2500\)/);
  assert.match(edge, /reserveSlot\(client, naverUserSlot\(userId\), 1500, 3000\)/,
    'Each caller has an own Naver slot before the shared one');
  const userSlotSource = /function naverUserSlot[\s\S]*?\n}/.exec(edge)?.[0];
  const naverUserSlot = new Function(userSlotSource.replace(/: string/g, '') + '; return naverUserSlot;')();
  assert.match(naverUserSlot('0F8FAD5B-D9CB-469F-A165-70867728950E'), /^[a-z][a-z0-9_]{0,31}$/,
    'Per-user slot keys satisfy reserve_external_catalog_slot provider validation');
  assert.equal(naverUserSlot('0f8fad5b-d9cb-469f-a165-70867728950e').length, 32);
  assert.match(edge, /if \(!loaded\) throw new Error\('LINK_RESOLVE_FAILED'\)/,
    'Exhausting the redirect budget is not treated as a resolved link');
  assert.match(edge, /\.order\('id'\)\.range\(from, to\)/,
    'Taxonomy reads page past PostgREST max_rows');
  assert.match(edge, /\.eq\('status', 'pending'\)\s*\.select\('id'\)/);
  assert.match(edge, /if \(!updateResult\.data\?\.length\) return json\(\{ error: 'ITEM_NOT_ELIGIBLE' \}, 409\)/,
    'A link is not reported saved when the item left pending before the update');
  assert.match(edge, /auth\.getUser/);
  assert.match(edge, /catalog_user_is_suspended/);
  assert.match(edge, /category_search_terms/);
  assert.match(edge, /place_catalog/);
  assert.match(edge, /const q = placeSearchName\(name\);/,
    'Place lookup must normalize like private.normalize_place_name, not the category matcher');
  const placeSearchSource = /function placeSearchName[\s\S]*?\n}/.exec(edge)?.[0];
  assert.ok(placeSearchSource);
  const placeSearchName = new Function(placeSearchSource.replace(/: string/g, '') + '; return placeSearchName;')();
  assert.equal(placeSearchName(' 을지로 (본점) '), '을지로(본점)');
  assert.equal(placeSearchName('A&B Pizza'), 'a&bpizza');
  assert.equal(placeSearchName('100%_\\맛집'), '100맛집');
  const branchSource = /function branchKey[\s\S]*?\n}/.exec(edge)?.[0];
  assert.ok(branchSource);
  const branchKey = new Function(placeSearchSource.replace(/: string/g, '') + branchSource.replace(/: string/g, '') + '; return branchKey;')();
  assert.equal(branchKey('스타벅스 강남우성점'), '스타벅스강남우성', 'Naver titles drop the trailing 점 the catalog branch lacks');
  assert.match(edge, /\.eq\('normalized_name', head\)\s*\.ilike\('branch_name', '%' \+ branch \+ '%'\)/,
    'A full-title miss retries brand name + branch');
  assert.match(edge, /placeFullName\(place\) === branchKey\(resolvedName\)/);
  const cleanSource = /function cleanNaverTitle[\s\S]*?\n}/.exec(edge)?.[0];
  const cleanNaverTitle = new Function(cleanSource.replace(/: string/g, '') + '; return cleanNaverTitle;')();
  assert.equal(cleanNaverTitle('을밀대 평양냉면 : 네이버\u001c'), '을밀대 평양냉면', 'Invisible control characters do not keep the Naver suffix');
  assert.equal(cleanNaverTitle('스타벅스 강남우성점 - 네이버 지도'), '스타벅스 강남우성점');
  for (const generic of ['네이버 지도', '네이버 플레이스', 'NAVER', '']) assert.equal(cleanNaverTitle(generic), '', generic + ' is not a store name');
  const placeIdSource = /function naverPlaceId[\s\S]*?\n}/.exec(edge)?.[0];
  const naverPlaceId = new Function(placeIdSource.replace(/\(url: URL\)/, '(url)') + '; return naverPlaceId;')();
  assert.equal(naverPlaceId(new URL('https://map.naver.com/p/entry/place/11679611?placePath=%2Fhome')), '11679611');
  assert.equal(naverPlaceId(new URL('https://m.place.naver.com/restaurant/11679611/home')), '11679611');
  assert.equal(naverPlaceId(new URL('https://map.naver.com/p/search/abc')), null);
  assert.match(edge, /new URL\('https:\/\/m\.place\.naver\.com\/place\/' \+ placeId \+ '\/home'\)/,
    'A titleless map page is read through the place page of the same id');
  assert.match(edge, /\.eq\('normalized_name', first\)\.limit\(20\)/, 'A Naver name with an extra word still lists the brand stores');
  assert.match(edge, /body\.action === 'attach_pending_link'/);
  assert.match(edge, /itemResult\.data\.created_by !== auth\.data\.user\.id/);
  assert.match(edge, /\.eq\('created_by', auth\.data\.user\.id\)\.eq\('status', 'pending'\)/,
    'Only the caller own pending item may receive the source link');
  assert.doesNotMatch(edge, /api\.openai\.com|OPENAI_API_KEY/,
    'MVP link category suggestions must not add paid AI calls');
  const naverResolution = edge.slice(edge.indexOf("let canonicalUrl"), edge.indexOf("const canonicalHost"));
  assert.match(naverResolution, /if \(naverHost\(parsed\.hostname\)\)/);
  assert.match(naverResolution, /resolveNaver\(parsed, admin, auth\.data\.user\.id\)/,
    'Only URLs already verified as Naver-owned enter the outbound Naver resolver');
  assert.match(edge, /function naverPlaceHost/);
  assert.match(edge, /smartstore\.naver\.com|naverPlaceHost/,
    'Naver online stores must not be classified solely because they are under naver.com');

  const requestScreen = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'pick', 'request.tsx'), 'utf8');
  assert.match(requestScreen, /useAttachPendingItemLink/);
  assert.match(requestScreen, /sourceUrl/);
  assert.match(requestScreen, /linkAttach\.mutateAsync/);

  console.log('Link category suggestion checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
