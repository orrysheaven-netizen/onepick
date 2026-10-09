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
  mapGraphqlSpecies, searchSpeciesIndex, createPokemonCatalogHandler, pokemonArtworkUrl,
} = load('supabase/functions/pokemon-catalog/pokemonCatalog.ts', { '@supabase/supabase-js': {} });

const index = [
  { id: 25, name: 'pikachu', pokemonspeciesnames: [
    { name: '피카츄', language: { name: 'ko' } },
    { name: 'Pikachu', language: { name: 'en' } },
  ] },
  { id: 26, name: 'raichu', pokemonspeciesnames: [
    { name: '라이츄', language: { name: 'ko' } },
    { name: 'Raichu', language: { name: 'en' } },
  ] },
  { id: 172, name: 'pichu', pokemonspeciesnames: [
    { name: '피츄', language: { name: 'ko' } },
    { name: 'Pichu', language: { name: 'en' } },
  ] },
];
const detail = {
  id: 25,
  name: 'pikachu',
  names: [
    { name: '피카츄', language: { name: 'ko' } },
    { name: 'Pikachu', language: { name: 'en' } },
  ],
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function setup() {
  const state = {
    rows: [], writes: [], auth: true, suspended: false,
    categories: [
      { id:'pokemon',parent_id:'character',slug:'pokemon',status:'open',is_visible:true,is_pickable:true },
      { id:'character',parent_id:null,slug:'character',status:'open',is_visible:true,is_pickable:false },
    ],
    index,
    detail,
    indexLoads:0,
    detailLoads:0,
  };
  const client = {
    auth: { getUser: async () => ({ data:{ user: state.auth ? { id:'user' } : null }, error:null }) },
    rpc: async (name) => {
      if (name === 'catalog_user_is_suspended') return { data: state.suspended, error: null };
      if (name === 'reserve_external_catalog_import') return { data: true, error: null };
      assert.fail('Unexpected RPC: ' + name);
    },
    from(table) {
      assert.ok(['categories','items'].includes(table));
      const filters=[]; let insert=null; let update=null; let limit=Infinity;
      const run=async(single)=>{
        if (insert) {
          state.writes.push({type:'insert',row:insert});
          if (state.rows.some((r)=>r.external_source===insert.external_source && r.external_id===insert.external_id))
            return { data:null,error:{code:'23505'} };
          const saved={...insert,id:'saved-'+state.rows.length,category_id:insert.category_id};
          state.rows.push(saved);
          return { data:saved,error:null };
        }
        const source=table==='categories'?state.categories:state.rows;
        const rows=source.filter((r)=>filters.every((f)=>f(r))).slice(0,limit);
        if (update) {
          state.writes.push({type:'update',row:update});
          for (const row of rows) Object.assign(row,update);
          return { data:rows,error:null };
        }
        return { data:single?(rows[0]??null):rows,error:null };
      };
      const q={
        select:()=>q,
        eq:(k,v)=>{filters.push((r)=>r[k]===v);return q;},
        in:(k,vs)=>{filters.push((r)=>vs.includes(r[k]));return q;},
        limit:(n)=>{limit=n;return q;},
        insert:(row)=>{assert.equal(table,'items');insert=row;return q;},
        update:(row)=>{assert.equal(table,'items');update=row;return q;},
        maybeSingle:()=>run(true),
        then:(resolve,reject)=>run(false).then(resolve,reject),
      };
      return q;
    },
  };
  const handler=createPokemonCatalogHandler({
    client:()=>client,
    json,
    loadIndex:async()=>{state.indexLoads++; return { data:state.index };},
    loadSpecies:async()=>{state.detailLoads++; return { data:state.detail };},
  });
  const request=(action,extra={},auth=true)=>handler(
    { action,query:'피카츄',externalId:'25',...extra },
    new Request('https://edge.test',{headers:auth?{Authorization:'Bearer token'}:{}}),
  );
  return { state,request };
}

async function main() {
  const mapped=mapGraphqlSpecies(index[0]);
  assert.equal(mapped.id,25);
  assert.equal(mapped.slug,'pikachu');

  assert.equal(searchSpeciesIndex(index,'피카츄')[0].externalId,'25');
  assert.equal(searchSpeciesIndex(index,'피캬츄')[0].externalId,'25');
  assert.equal(searchSpeciesIndex(index,'Pikachu')[0].name,'피카츄');
  assert.equal(searchSpeciesIndex(index,'Pikchu')[0].externalId,'25');
  assert.equal(searchSpeciesIndex(index,'pika')[0].externalId,'25');
  assert.equal(searchSpeciesIndex(index,'#25')[0].englishName,'Pikachu');
  assert.equal(searchSpeciesIndex(index,'26')[0].name,'라이츄');
  assert.equal(searchSpeciesIndex(index,'없는포켓몬').length,0);
  assert.equal(pokemonArtworkUrl('25'),'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png');
  assert.equal(pokemonArtworkUrl('bad'),null);

  const s=setup();
  const search=await (await s.request('search',{},false)).json();
  assert.equal(search.pokemon[0].name,'피카츄');
  assert.equal(search.pokemon[0].dexNumber,25);
  assert.equal(search.pokemon[0].imageUrl,'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png');
  assert.equal(s.state.writes.length,0,'search must never create OnePick items');
  assert.equal(s.state.detailLoads,0,'search uses cached species-name index only');

  const saved=await (await s.request('import')).json();
  assert.equal(saved.created,true);
  assert.equal(s.state.detailLoads,1);
  assert.equal(s.state.writes[0].type,'insert');
  assert.equal(s.state.writes[0].row.external_source,'pokeapi_species');
  assert.equal(s.state.writes[0].row.external_id,'25');
  assert.equal(s.state.writes[0].row.name,'피카츄');
  assert.equal(s.state.writes[0].row.original_name,'Pikachu');
  assert.equal(s.state.writes[0].row.image_source_url,'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png');
  assert.equal(s.state.writes[0].row.official_url,null);

  const again=await (await s.request('import')).json();
  assert.equal(again.created,false);
  assert.equal(s.state.detailLoads,1,'existing imported species does not re-fetch');

  const known=await (await s.request('search',{},false)).json();
  assert.equal(known.pokemon[0].existingItemId,saved.itemId);

  const stale=setup();
  stale.state.rows.push({
    id:'existing',category_id:'pokemon',status:'active',
    external_source:'pokeapi_species',external_id:'25',image_source_url:null,
  });
  const reused=await (await stale.request('import')).json();
  assert.equal(reused.created,false);
  assert.equal(stale.state.detailLoads,0,'existing species should not require provider detail fetch');
  assert.equal(stale.state.rows[0].image_source_url,'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png');
  assert.equal(stale.state.writes[0].type,'update');

  for(const mode of ['no-auth','expired','suspended','hidden-category','hidden-parent','non-leaf','bad-id','bad-query']){
    const t=setup();
    if(mode==='expired') t.state.auth=false;
    if(mode==='suspended') t.state.suspended=true;
    if(mode==='hidden-category') t.state.categories[0].is_visible=false;
    if(mode==='hidden-parent') t.state.categories[1].is_visible=false;
    if(mode==='non-leaf') t.state.categories.push({id:'child',parent_id:'pokemon'});
    const res=await t.request(mode==='bad-query'?'search':'import',
      mode==='bad-id'?{externalId:'bad'}:mode==='bad-query'?{query:''}:{},
      mode!=='no-auth');
    assert.ok(res.status>=400,mode);
    assert.equal(t.state.writes.length,0,mode);
  }

  const { AppError }=load('mobile/src/errors/appError.ts');
  const { SupabasePokemonCatalogRepository }=load('mobile/src/repositories/supabase/supabasePokemonCatalogRepository.ts',{
    '@/errors/appError':{AppError},
  });
  const calls=[]; let failure=null;
  const repo=new SupabasePokemonCatalogRepository({functions:{invoke:async(name,options)=>{
    calls.push(options); assert.equal(name,'pokemon-catalog');
    return { data: options.body.action==='search'
      ? {pokemon:[{source:'pokeapi_species',externalId:'25',name:'피카츄',englishName:'Pikachu',dexNumber:25,imageUrl:'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png',existingItemId:null}]}
      : {itemId:'c3333333-3333-4333-8333-333333333333',categoryId:'d4444444-4444-4444-8444-444444444444',created:false}, error:failure };
  }}});
  const signal=new AbortController().signal;
  assert.equal((await repo.search('피카츄',signal))[0].externalId,'25');
  assert.equal(calls[0].signal,signal);
  await repo.importPokemon('25');
  assert.equal(calls.at(-1).body.externalId,'25');
  failure={context:new Response(JSON.stringify({error:'RATE_LIMITED'}),{status:429})};
  await assert.rejects(()=>repo.search('피카츄'),(error)=>error.code==='RATE_LIMITED');

  const { PokemonCatalogService }=load('mobile/src/services/pokemonCatalogService.ts');
  const serviceCalls=[]; const service=new PokemonCatalogService({
    search:async(...args)=>{serviceCalls.push(args);return[];},
    importPokemon:async()=>({created:true}),
  });
  await service.search(' 피카츄 ');
  assert.equal(serviceCalls[0][0],'피카츄');
  assert.equal((await service.search(' ')).length,0);

  const intents=load('mobile/src/lib/auth/authIntent.ts');
  const categoryId='d4444444-4444-4444-8444-444444444444';
  const intent=intents.getAuthIntent({action:'choose_pokemon',externalPokemonId:'25',categoryId});
  assert.equal(intent.action,'choose_pokemon');
  assert.equal(intents.getPostAuthRoute(intent).pathname,'/pick/pokemon');
  assert.equal(intents.getAuthIntent({action:'choose_pokemon',externalPokemonId:'bad',categoryId}).action,'home');

  const screen=fs.readFileSync(path.join(root,'mobile/src/app/pick/pokemon.tsx'),'utf8');
  assert.match(screen,/피카츄, Pikachu, #25/);
  assert.match(screen,/이미지 파일을 OnePick Storage에 복사하지 않아요/);
  assert.match(screen,/uri=\{entry\.imageUrl\}/);
  assert.match(screen,/상업화 전에 다시 검토해요/);

  const indexSource=fs.readFileSync(path.join(root,'supabase/functions/pokemon-catalog/index.ts'),'utf8');
  assert.match(indexSource,/graphql\.pokeapi\.co\/v1beta2/);
  assert.match(indexSource,/24 \* 60 \* 60_000/);
  assert.match(indexSource,/30 \* 24 \* 60 \* 60_000/);
  const coreSource=fs.readFileSync(path.join(root,'supabase/functions/pokemon-catalog/pokemonCatalog.ts'),'utf8');
  assert.match(coreSource,/raw\.githubusercontent\.com\/PokeAPI\/sprites\/master\/sprites\/pokemon\/other\/official-artwork/);
  assert.match(coreSource,/image_source_url: pokemonArtworkUrl\(id\)/);

  const itemSearchSource=fs.readFileSync(path.join(root,'mobile/src/components/item-search.tsx'),'utf8');
  assert.match(itemSearchSource,/onSearchPokemon/);
  assert.match(itemSearchSource,/PokéAPI에서 포켓몬 검색/);
  const exploreSource=fs.readFileSync(path.join(root,'mobile/src/app/(tabs)/explore.tsx'),'utf8');
  assert.match(exploreSource,/pathname: '\/pick\/pokemon'/);

  const docsSource=fs.readFileSync(path.join(root,'docs/pokemon-catalog.md'),'utf8');
  assert.match(docsSource,/Commercialization gate/);
  assert.match(docsSource,/release blocker for commercialization/);

  console.log('Pokémon catalog passed: Korean/English/dex/typo search, daily cached index, no search-created items, selected-only import, remote artwork, existing-item backfill, category/auth gates and login return.');
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
