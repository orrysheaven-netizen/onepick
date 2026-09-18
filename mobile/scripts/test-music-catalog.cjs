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
  }).outputText, { exports, URL, Request, Response, AbortController, console,
    require: (name) => { if (name in imports) return imports[name]; throw new Error(name); } });
  return exports;
}
const { mapMusicBrainzRecording, createMusicCatalogHandler, buildRecordingQuery, musicItemName } =
  load('supabase/functions/music-catalog/musicCatalog.ts', { '@supabase/supabase-js': {} });
const recordingId = '11111111-2222-4333-8444-555555555555';
const groupId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const raw = {
  id: recordingId, title: '밤편지', 'first-release-date': '2017-03-24', video: false,
  disambiguation: '', 'artist-credit': [{ name: '아이유', artist: { name: 'IU' } }],
  releases: [{ id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', title: 'Palette', status: 'Official', date: '2017-04-21',
    'release-group': { id: groupId, title: 'Palette', 'primary-type': 'Album' } }],
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function setup() {
  const state = {
    rows: [], writes: [], upstream: [], cache: new Map(), waits: 0, auth: true, suspended: false, cover: 'https://coverartarchive.org/release-group/'+groupId+'/front-500',
    categories: [{ id:'music',parent_id:'content',slug:'music',status:'open',is_visible:true,is_pickable:true },
      { id:'content',parent_id:null,slug:'content',status:'open',is_visible:true,is_pickable:false }],
  };
  const client = {
    auth: { getUser: async () => ({ data:{ user: state.auth ? { id:'user' } : null }, error:null }) },
    rpc: async (name) => {
      assert.equal(name,'user_is_suspended');
      return { data:state.suspended,error:null };
    },
    from(table) {
      assert.ok(['categories','items'].includes(table));
      const filters=[]; let insert=null, limit=Infinity;
      const run=async(single)=>{
        if(insert){
          state.writes.push(insert);
          if(state.rows.some(r=>r.external_source===insert.external_source&&r.external_id===insert.external_id))
            return {data:null,error:{code:'23505'}};
          const saved={...insert,id:'saved-'+state.rows.length}; state.rows.push(saved); return {data:saved,error:null};
        }
        const src=table==='categories'?state.categories:state.rows;
        const rows=src.filter(r=>filters.every(f=>f(r))).slice(0,limit);
        return {data:single?(rows[0]??null):rows,error:null};
      };
      const q={ select:()=>q, eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},
        in:(k,vs)=>{filters.push(r=>vs.includes(r[k]));return q;}, limit:(n)=>{limit=n;return q;},
        insert:(row)=>{insert=row;return q;}, maybeSingle:()=>run(true),
        then:(resolve,reject)=>run(false).then(resolve,reject) };
      return q;
    }
  };
  const handler=createMusicCatalogHandler({
    client:()=>client, json,
    fetchMusicBrainz:async(url)=>{state.upstream.push(url); return {data:url.pathname.endsWith(recordingId)?raw:{recordings:[raw]}};},
    fetchCoverArt:async()=>state.cover,
    readCache:async(_client,key)=>state.cache.get(key)??null,
    writeCache:async(_client,key,payload)=>{state.cache.set(key,payload);},
    waitForProvider:async()=>{state.waits++;return true;},
  });
  const request=(action,extra={},auth=true)=>handler({action,title:'밤편지',artist:'아이유',externalId:recordingId,...extra},
    new Request('https://edge.test',{headers:auth?{Authorization:'Bearer token'}:{}}));
  return {state,request};
}

async function main(){
  const mapped=mapMusicBrainzRecording(raw);
  assert.equal(mapped.externalId,recordingId); assert.equal(mapped.title,'밤편지'); assert.equal(mapped.artistName,'아이유');
  assert.equal(mapped.releaseTitle,'Palette'); assert.equal(mapped.releaseYear,2017); assert.equal(mapped.releaseGroupId,groupId);
  assert.match(mapped.coverArtUrl,/coverartarchive\.org\/release-group/);
  assert.match(buildRecordingQuery('밤"편지','아이유'),/recording:"밤\\\"편지" AND artist:"아이유"/);
  assert.equal(musicItemName(mapped),'밤편지 · 아이유');
  assert.equal(mapMusicBrainzRecording({...raw,video:true}),null);
  assert.equal(mapMusicBrainzRecording({...raw,'artist-credit':[]}),null);

  const s=setup();
  const search=await (await s.request('search',{},false)).json();
  assert.equal(search.recordings.length,1); assert.equal(search.recordings[0].existingItemId,null);
  assert.equal(s.state.writes.length,0,'Search never creates catalog items');
  assert.equal(s.state.waits,1); assert.equal(s.state.upstream[0].hostname,'musicbrainz.org');
  const cached=await (await s.request('search',{},false)).json();
  assert.equal(cached.recordings.length,1); assert.equal(s.state.waits,1,'Cached search avoids another provider slot');

  const saved=await (await s.request('import')).json();
  assert.equal(saved.created,true); assert.equal(saved.categoryId,'music');
  assert.equal(s.state.writes[0].external_source,'musicbrainz_recording');
  assert.equal(s.state.writes[0].name,'밤편지 · 아이유'); assert.equal(s.state.writes[0].original_name,'밤편지');
  assert.equal(s.state.writes[0].creator_name,'아이유'); assert.equal(s.state.writes[0].collection_name,'Palette');
  assert.equal(s.state.writes[0].image_source_url,s.state.cover);
  const upstream=s.state.upstream.length;
  const again=await (await s.request('import')).json();
  assert.equal(again.itemId,saved.itemId); assert.equal(again.created,false); assert.equal(s.state.upstream.length,upstream);
  const known=await (await s.request('search',{},false)).json();
  assert.equal(known.recordings[0].existingItemId,saved.itemId);

  for(const mode of ['no-auth','expired','suspended','hidden-category','hidden-parent','non-leaf','bad-id','bad-query']){
    const t=setup();
    if(mode==='expired') t.state.auth=false;
    if(mode==='suspended') t.state.suspended=true;
    if(mode==='hidden-category') t.state.categories[0].is_visible=false;
    if(mode==='hidden-parent') t.state.categories[1].is_visible=false;
    if(mode==='non-leaf') t.state.categories.push({id:'child',parent_id:'music'});
    const res=await t.request(mode==='bad-query'?'search':'import',
      mode==='bad-id'?{externalId:'bad'}:mode==='bad-query'?{title:'a',artist:''}:{}, mode!=='no-auth');
    assert.ok(res.status>=400,mode); assert.equal(t.state.writes.length,0,mode);
  }

  const { AppError }=load('mobile/src/errors/appError.ts');
  const { SupabaseMusicCatalogRepository }=load('mobile/src/repositories/supabase/supabaseMusicCatalogRepository.ts',{
    '@/errors/appError':{AppError}
  });
  const calls=[]; let failure=null;
  const repo=new SupabaseMusicCatalogRepository({functions:{invoke:async(name,options)=>{
    calls.push(options); assert.equal(name,'music-catalog');
    return {data:options.body.action==='search'?{recordings:[mapped]}:
      {itemId:'c3333333-3333-4333-8333-333333333333',categoryId:'d4444444-4444-4444-8444-444444444444',created:false},error:failure};
  }}});
  const signal=new AbortController().signal;
  assert.equal((await repo.search('밤편지','아이유',signal))[0].artistName,'아이유');
  assert.equal(calls[0].signal,signal); assert.equal(calls[0].body.artist,'아이유');
  await repo.importRecording(recordingId); assert.equal(calls.at(-1).body.externalId,recordingId);
  failure={context:new Response(JSON.stringify({error:'RECORDING_NOT_FOUND'}),{status:404})};
  await assert.rejects(()=>repo.importRecording(recordingId),e=>e.code==='ITEM_NOT_FOUND');

  const { MusicCatalogService }=load('mobile/src/services/musicCatalogService.ts');
  const serviceCalls=[]; const service=new MusicCatalogService({
    search:async(...args)=>{serviceCalls.push(args);return[mapped];}, importRecording:async()=>({created:true})
  });
  assert.equal((await service.search(' 밤편지 ',' 아이유 '))[0].title,'밤편지');
  assert.deepEqual(serviceCalls[0].slice(0,2),['밤편지','아이유']);
  assert.equal((await service.search('a','')).length,0);
  await service.search('a','IU'); assert.equal(serviceCalls.length,2,'One-character titles require an artist');

  const intents=load('mobile/src/lib/auth/authIntent.ts');
  const categoryId='d4444444-4444-4444-8444-444444444444';
  const intent=intents.getAuthIntent({action:'choose_music',externalMusicId:recordingId,categoryId});
  assert.equal(intent.action,'choose_music'); assert.equal(intents.getPostAuthRoute(intent).pathname,'/pick/music');
  assert.equal(intents.getPostAuthRoute(intent).params.externalMusicId,recordingId);
  assert.equal(intents.getAuthIntent({action:'choose_music',externalMusicId:'bad',categoryId}).action,'home');
  console.log('Music catalog passed: recording identity, artist/release metadata, cached on-demand import, auth/category safety and login return.');
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
