const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '../..');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, URL, Request, Response, AbortController, console,
    require: (name) => { if (name in imports) return imports[name]; throw new Error(name); },
  });
  return exports;
}

const {
  mapIgdbGame, coverUrl, buildGameSearchQuery, buildGameDetailQuery, createGameCatalogHandler,
} = load('supabase/functions/game-catalog/gameCatalog.ts', { '@supabase/supabase-js': {} });

const raw = {
  id: 1942,
  name: '테스트 게임',
  slug: 'test-game',
  url: 'https://www.igdb.com/games/test-game',
  first_release_date: 1704067200,
  version_parent: null,
  game_type: { type: 'Main Game' },
  platforms: [{ name: 'PC (Microsoft Windows)' }, { name: 'Nintendo Switch' }],
  cover: { image_id: 'co1234' },
  involved_companies: [
    { developer: true, publisher: false, company: { name: '테스트 스튜디오' } },
    { developer: false, publisher: true, company: { name: '테스트 퍼블리셔' } },
  ],
};
const version = { ...raw, id: 1943, name: '테스트 게임 Collector Edition', version_parent: 1942 };
const second = { ...raw, id: 1944, name: '테스트 게임 리마스터', url: 'https://www.igdb.com/games/test-game-remaster' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function setup() {
  const state = {
    rows: [], writes: [], upstream: [], cache: new Map(), auth: true, suspended: false, configured: true,
    categories: [
      { id:'game',parent_id:'content',slug:'game',status:'open',is_visible:true,is_pickable:true },
      { id:'content',parent_id:null,slug:'content',status:'open',is_visible:true,is_pickable:false },
    ],
    searchRows: [raw, version, second],
    detailRows: [raw],
  };
  const client = {
    auth: { getUser: async () => ({ data:{ user: state.auth ? { id:'user' } : null }, error:null }) },
    rpc: async (name) => {
      assert.equal(name, 'user_is_suspended');
      return { data: state.suspended, error: null };
    },
    from(table) {
      assert.ok(['categories','items'].includes(table));
      const filters=[]; let insert=null, limit=Infinity;
      const run=async(single)=>{
        if (insert) {
          state.writes.push(insert);
          if (state.rows.some((r)=>r.external_source===insert.external_source && r.external_id===insert.external_id))
            return { data:null,error:{code:'23505'} };
          const saved={...insert,id:'saved-'+state.rows.length}; state.rows.push(saved);
          return { data:saved,error:null };
        }
        const source=table==='categories'?state.categories:state.rows;
        const rows=source.filter((r)=>filters.every((f)=>f(r))).slice(0,limit);
        return { data:single?(rows[0]??null):rows,error:null };
      };
      const q={
        select:()=>q,
        eq:(k,v)=>{filters.push((r)=>r[k]===v);return q;},
        in:(k,vs)=>{filters.push((r)=>vs.includes(r[k]));return q;},
        limit:(n)=>{limit=n;return q;},
        insert:(row)=>{assert.equal(table,'items');insert=row;return q;},
        maybeSingle:()=>run(true),
        then:(resolve,reject)=>run(false).then(resolve,reject),
      };
      return q;
    },
  };
  const handler=createGameCatalogHandler({
    client:()=>client,
    configured:()=>state.configured,
    json,
    readCache:async(_client,key)=>state.cache.get(key)??null,
    writeCache:async(_client,key,payload)=>{state.cache.set(key,payload);},
    fetchIgdb:async(query)=>{
      state.upstream.push(query);
      return { data: query.includes('where id =') ? state.detailRows : state.searchRows };
    },
  });
  const request=(action,extra={},auth=true)=>handler(
    { action,query:'테스트 게임',externalId:'1942',...extra },
    new Request('https://edge.test',{headers:auth?{Authorization:'Bearer token'}:{}}),
  );
  return { state,request };
}

async function main() {
  const mapped=mapIgdbGame(raw);
  assert.equal(mapped.externalId,'1942');
  assert.equal(mapped.title,'테스트 게임');
  assert.equal(mapped.developerName,'테스트 스튜디오');
  assert.deepEqual(Array.from(mapped.platformNames),['PC (Microsoft Windows)','Nintendo Switch']);
  assert.equal(mapped.releaseYear,2024);
  assert.equal(mapped.coverUrl,'https://images.igdb.com/igdb/image/upload/t_cover_big/co1234.jpg');
  assert.equal(mapped.igdbUrl,'https://www.igdb.com/games/test-game');
  assert.equal(mapped.gameType,'Main Game');
  assert.equal(mapIgdbGame(version),null,'collector/edition versions are excluded');
  assert.equal(coverUrl('../bad'),null);
  assert.equal(mapIgdbGame({...raw,url:'https://evil.example/games/test'}).igdbUrl,null);

  const escaped=buildGameSearchQuery('A "Quoted" \\ Game');
  assert.match(escaped,/search "A \\"Quoted\\" \\\\ Game"/);
  assert.match(escaped,/where version_parent = null/);
  assert.match(escaped,/limit 20/);
  assert.match(buildGameDetailQuery('1942'),/where id = 1942/);

  const s=setup();
  const search=await (await s.request('search',{},false)).json();
  assert.equal(search.games.length,2,'versions are filtered but separately-ID remasters remain');
  assert.equal(search.games.some((game)=>game.externalId==='1943'),false);
  assert.equal(search.games.some((game)=>game.externalId==='1944'),true);
  assert.equal(s.state.writes.length,0,'search never writes unselected games');
  assert.equal(s.state.upstream.length,1);
  await s.request('search',{},false);
  assert.equal(s.state.upstream.length,1,'exact search cache avoids another IGDB request');

  const saved=await (await s.request('import')).json();
  assert.equal(saved.created,true);
  assert.equal(saved.categoryId,'game');
  assert.equal(s.state.writes[0].external_source,'igdb_game');
  assert.equal(s.state.writes[0].external_id,'1942');
  assert.equal(s.state.writes[0].name,'테스트 게임');
  assert.equal(s.state.writes[0].creator_name,'테스트 스튜디오');
  assert.equal(s.state.writes[0].collection_name,'PC (Microsoft Windows) · Nintendo Switch');
  assert.equal(s.state.writes[0].image_source_url,'https://images.igdb.com/igdb/image/upload/t_cover_big/co1234.jpg');
  assert.equal(s.state.writes[0].official_url,'https://www.igdb.com/games/test-game');
  const upstream=s.state.upstream.length;
  const again=await (await s.request('import')).json();
  assert.equal(again.itemId,saved.itemId);
  assert.equal(again.created,false);
  assert.equal(s.state.upstream.length,upstream,'reselect reuses existing item before provider call');

  const known=await (await s.request('search',{},false)).json();
  assert.equal(known.games.find((game)=>game.externalId==='1942').existingItemId,saved.itemId);

  const edition=setup();
  edition.state.detailRows=[version];
  const editionResponse=await edition.request('import',{externalId:'1943'});
  assert.equal(editionResponse.status,404);
  assert.equal(edition.state.writes.length,0,'direct edition IDs cannot bypass version filtering');

  for(const mode of ['no-auth','expired','suspended','hidden-category','hidden-parent','non-leaf','bad-id','bad-query','no-config']){
    const t=setup();
    if(mode==='expired') t.state.auth=false;
    if(mode==='suspended') t.state.suspended=true;
    if(mode==='hidden-category') t.state.categories[0].is_visible=false;
    if(mode==='hidden-parent') t.state.categories[1].is_visible=false;
    if(mode==='non-leaf') t.state.categories.push({id:'child',parent_id:'game'});
    if(mode==='no-config') t.state.configured=false;
    const res=await t.request(mode==='bad-query'?'search':'import',
      mode==='bad-id'?{externalId:'bad'}:mode==='bad-query'?{query:'a'}:{},
      mode!=='no-auth');
    assert.ok(res.status>=400,mode);
    assert.equal(t.state.writes.length,0,mode);
    assert.equal(t.state.upstream.length,0,mode);
  }

  const { AppError }=load('mobile/src/errors/appError.ts');
  const { SupabaseGameCatalogRepository }=load('mobile/src/repositories/supabase/supabaseGameCatalogRepository.ts',{
    '@/errors/appError':{AppError},
  });
  const calls=[]; let failure=null;
  const repo=new SupabaseGameCatalogRepository({functions:{invoke:async(name,options)=>{
    calls.push(options); assert.equal(name,'game-catalog');
    return { data: options.body.action==='search' ? {games:[mapped]} :
      {itemId:'c3333333-3333-4333-8333-333333333333',categoryId:'d4444444-4444-4444-8444-444444444444',created:false}, error:failure };
  }}});
  const signal=new AbortController().signal;
  assert.equal((await repo.search('테스트 게임',signal))[0].developerName,'테스트 스튜디오');
  assert.equal(calls[0].signal,signal);
  assert.equal(calls[0].body.query,'테스트 게임');
  await repo.importGame('1942');
  assert.equal(calls.at(-1).body.externalId,'1942');
  failure={context:new Response(JSON.stringify({error:'CATALOG_NOT_CONFIGURED'}),{status:503})};
  await assert.rejects(()=>repo.search('테스트 게임'),(error)=>error.code==='CATALOG_NOT_CONFIGURED');

  const { GameCatalogService }=load('mobile/src/services/gameCatalogService.ts');
  const serviceCalls=[]; const service=new GameCatalogService({
    search:async(...args)=>{serviceCalls.push(args);return[mapped];},
    importGame:async()=>({created:true}),
  });
  await service.search(' 테스트 게임 ');
  assert.equal(serviceCalls[0][0],'테스트 게임');
  assert.equal((await service.search('a')).length,0);

  const intents=load('mobile/src/lib/auth/authIntent.ts');
  const categoryId='d4444444-4444-4444-8444-444444444444';
  const intent=intents.getAuthIntent({action:'choose_game',externalGameId:'1942',categoryId});
  assert.equal(intent.action,'choose_game');
  assert.equal(intent.externalGameId,'1942');
  assert.equal(intents.getPostAuthRoute(intent).pathname,'/pick/game');
  assert.equal(intents.getAuthIntent({action:'choose_game',externalGameId:'bad',categoryId}).action,'home');

  const indexSource=fs.readFileSync(path.join(root,'supabase/functions/game-catalog/index.ts'),'utf8');
  assert.match(indexSource,/IGDB_CLIENT_ID/);
  assert.match(indexSource,/IGDB_CLIENT_SECRET/);
  assert.match(indexSource,/provider: 'igdb_oauth'/);
  assert.match(indexSource,/p_interval_ms: 650/);
  assert.match(indexSource,/AbortSignal\.timeout\(5_000\)/);
  assert.doesNotMatch(indexSource,/EXPO_PUBLIC_IGDB/);

  console.log('Game catalog passed: IGDB identity, edition filtering, no search writes, selected-only import, cover/developer/platform mapping, cache, auth/category gates and login return.');
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
