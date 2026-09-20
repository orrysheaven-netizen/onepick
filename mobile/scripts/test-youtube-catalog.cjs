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
    exports, URL, Request, Response, AbortController, console, Deno: undefined,
    require: (name) => { if (name in imports) return imports[name]; throw new Error(name); },
  });
  return exports;
}

const {
  mapYouTubeSearchResult, mapYouTubeChannel, directLookup, channelUrl, rankChannels, createYouTubeCatalogHandler,
} = load('supabase/functions/youtube-catalog/youtubeCatalog.ts', { '@supabase/supabase-js': {} });

const channelId = 'UC1234567890123456789012';
const secondId = 'UCabcdefghijklmnopqrstuv';
const searchRaw = {
  id: { channelId },
  snippet: {
    title: '테스트 채널',
    thumbnails: {
      high: { url: 'https://yt3.ggpht.com/test-high' },
      default: { url: 'https://yt3.ggpht.com/test-default' },
    },
  },
};
const channelRaw = {
  id: channelId,
  snippet: {
    title: '테스트 채널',
    thumbnails: { high: { url: 'https://yt3.ggpht.com/test-high' } },
  },
};
const videoId = 'QzTOFNbgU-s';
const videoRaw = {
  id: videoId,
  snippet: { channelId, channelTitle: '테스트 채널', title: '테스트 영상' },
};
const secondRaw = {
  id: { channelId: secondId },
  snippet: { title: '두번째 채널', thumbnails: {} },
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function setup() {
  const state = {
    rows: [], writes: [], updates: [], upstream: [], cache: new Map(), auth: true, suspended: false,
    apiKey: 'server-key',
    categories: [
      { id:'youtube',parent_id:'content',slug:'youtube',status:'open',is_visible:true,is_pickable:true },
      { id:'content',parent_id:null,slug:'content',status:'open',is_visible:true,is_pickable:false },
    ],
    searchItems: [searchRaw, secondRaw],
    channelItems: [channelRaw],
    videoItems: [videoRaw],
  };
  const client = {
    auth: { getUser: async () => ({ data:{ user: state.auth ? { id:'user' } : null }, error:null }) },
    rpc: async (name) => {
      assert.equal(name, 'user_is_suspended');
      return { data: state.suspended, error: null };
    },
    from(table) {
      assert.ok(['categories','items'].includes(table));
      const filters=[]; let insert=null, update=null, limit=Infinity, selected=true;
      const run=async(single)=>{
        if (insert) {
          state.writes.push(insert);
          if (state.rows.some((r)=>r.external_source===insert.external_source && r.external_id===insert.external_id))
            return { data:null,error:{code:'23505'} };
          const saved={...insert,id:'saved-'+state.rows.length,category_id:insert.category_id};
          state.rows.push(saved);
          return { data:saved,error:null };
        }
        if (update) {
          const matched=state.rows.filter((r)=>filters.every((f)=>f(r)));
          matched.forEach((row)=>Object.assign(row,update));
          state.updates.push({update,matched:matched.map((row)=>row.id)});
          return { data:single?(matched[0]??null):matched,error:null };
        }
        const source=table==='categories'?state.categories:state.rows;
        const rows=source.filter((r)=>filters.every((f)=>f(r))).slice(0,limit);
        return { data:single?(rows[0]??null):rows,error:null };
      };
      const q={
        select:()=>{selected=true;return q;},
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
  const handler=createYouTubeCatalogHandler({
    client:()=>client,
    apiKey:()=>state.apiKey || null,
    json,
    readCache:async(_client,key)=>state.cache.get(key)??null,
    writeCache:async(_client,key,payload)=>{state.cache.set(key,payload);},
    fetchYouTube:async(url)=>{
      state.upstream.push(url);
      const items = url.pathname.endsWith('/channels') ? state.channelItems
        : url.pathname.endsWith('/videos') ? state.videoItems
          : state.searchItems;
      return { data:{ items } };
    },
  });
  const request=(action,extra={},auth=true)=>handler(
    { action,query:'테스트 채널',externalId:channelId,...extra },
    new Request('https://edge.test',{headers:auth?{Authorization:'Bearer token'}:{}}),
  );
  return { state,request };
}

async function main() {
  const mappedSearch=mapYouTubeSearchResult(searchRaw);
  assert.equal(mappedSearch.externalId,channelId);
  assert.equal(mappedSearch.title,'테스트 채널');
  assert.equal(mappedSearch.thumbnailUrl,'https://yt3.ggpht.com/test-high');
  assert.equal(mappedSearch.channelUrl,channelUrl(channelId));
  assert.equal(mapYouTubeChannel(channelRaw).externalId,channelId);
  assert.equal(mapYouTubeSearchResult({id:{channelId:'bad'},snippet:{title:'x'}}),null);

  assert.equal(JSON.stringify(directLookup('@GoogleDevelopers')),JSON.stringify({type:'handle',value:'@GoogleDevelopers'}));
  assert.equal(JSON.stringify(directLookup(channelId)),JSON.stringify({type:'id',value:channelId}));
  assert.equal(JSON.stringify(directLookup('https://www.youtube.com/@GoogleDevelopers')),JSON.stringify({type:'handle',value:'@GoogleDevelopers'}));
  assert.equal(JSON.stringify(directLookup('https://www.youtube.com/channel/'+channelId)),JSON.stringify({type:'id',value:channelId}));
  assert.equal(JSON.stringify(directLookup('https://youtu.be/'+videoId+'?si=share')),JSON.stringify({type:'video',value:videoId}));
  assert.equal(JSON.stringify(directLookup('https://www.youtube.com/watch?v='+videoId+'&feature=share')),JSON.stringify({type:'video',value:videoId}));
  assert.equal(JSON.stringify(directLookup('https://www.youtube.com/shorts/'+videoId)),JSON.stringify({type:'video',value:videoId}));
  assert.equal(directLookup('https://example.com/@GoogleDevelopers'),null);

  const ranked = rankChannels([
    {...mappedSearch,title:'다른 채널'},
    {...mappedSearch,externalId:secondId,title:'최재천의 아마존'},
  ], '최재천의 아마존');
  assert.equal(ranked[0].title,'최재천의 아마존','exact normalized channel title ranks first');

  const s=setup();
  const search=await (await s.request('search',{},false)).json();
  assert.equal(search.channels.length,2);
  assert.equal(s.state.writes.length,0,'search never creates OnePick items');
  assert.equal(s.state.upstream.length,1);
  const searchUrl=s.state.upstream[0];
  assert.equal(searchUrl.pathname,'/youtube/v3/search');
  assert.equal(searchUrl.searchParams.get('type'),'channel');
  assert.equal(searchUrl.searchParams.get('safeSearch'),'strict');
  assert.equal(searchUrl.searchParams.get('relevanceLanguage'),'ko');
  assert.equal(searchUrl.searchParams.get('regionCode'),'KR');
  assert.equal(searchUrl.searchParams.get('maxResults'),'25');
  assert.equal(searchUrl.searchParams.get('part'),'snippet');
  assert.equal(searchUrl.searchParams.has('statistics'),false);
  await s.request('search',{},false);
  assert.equal(s.state.upstream.length,1,'10-minute server cache avoids another search request');

  const direct=setup();
  await direct.request('search',{query:'@GoogleDevelopers'},false);
  assert.equal(direct.state.upstream[0].pathname,'/youtube/v3/channels');
  assert.equal(direct.state.upstream[0].searchParams.get('forHandle'),'@GoogleDevelopers');

  const byVideo=setup();
  const longVideoUrl='https://www.youtube.com/watch?v='+videoId+'&si='+'x'.repeat(140);
  const videoSearch=await (await byVideo.request('search',{query:longVideoUrl},false)).json();
  assert.equal(videoSearch.channels.length,1);
  assert.equal(videoSearch.channels[0].externalId,channelId);
  assert.equal(byVideo.state.upstream.length,2,'video links resolve through videos.list then channels.list');
  assert.equal(byVideo.state.upstream[0].pathname,'/youtube/v3/videos');
  assert.equal(byVideo.state.upstream[0].searchParams.get('id'),videoId);
  assert.equal(byVideo.state.upstream[1].pathname,'/youtube/v3/channels');
  assert.equal(byVideo.state.upstream[1].searchParams.get('id'),channelId);

  const saved=await (await s.request('import')).json();
  assert.equal(saved.created,true);
  assert.equal(s.state.writes[0].external_source,'youtube_channel');
  assert.equal(s.state.writes[0].external_id,channelId);
  assert.equal(s.state.writes[0].name,'테스트 채널');
  assert.equal(s.state.writes[0].image_source_url,'https://yt3.ggpht.com/test-high');
  assert.equal(s.state.writes[0].official_url,'https://www.youtube.com/channel/'+channelId);
  assert.ok(Date.parse(s.state.writes[0].external_refreshed_at));

  const afterImportCalls=s.state.upstream.length;
  const again=await (await s.request('import')).json();
  assert.equal(again.created,false);
  assert.equal(s.state.upstream.length,afterImportCalls,'fresh existing channel is reused for 20 days');

  s.state.rows[0].external_refreshed_at=new Date(Date.now()-21*24*60*60_000).toISOString();
  s.state.channelItems=[{...channelRaw,snippet:{...channelRaw.snippet,title:'갱신된 채널'}}];
  const refreshed=await (await s.request('import')).json();
  assert.equal(refreshed.created,false);
  assert.equal(s.state.rows[0].name,'갱신된 채널');
  assert.ok(Date.now()-Date.parse(s.state.rows[0].external_refreshed_at)<60_000);

  const known=await (await s.request('search',{},false)).json();
  assert.equal(known.channels.find((entry)=>entry.externalId===channelId).existingItemId,saved.itemId);

  for(const mode of ['no-auth','expired','suspended','hidden-category','hidden-parent','non-leaf','bad-id','bad-query','no-key']){
    const t=setup();
    if(mode==='expired') t.state.auth=false;
    if(mode==='suspended') t.state.suspended=true;
    if(mode==='hidden-category') t.state.categories[0].is_visible=false;
    if(mode==='hidden-parent') t.state.categories[1].is_visible=false;
    if(mode==='non-leaf') t.state.categories.push({id:'child',parent_id:'youtube'});
    if(mode==='no-key') t.state.apiKey='';
    const res=await t.request(mode==='bad-query'?'search':'import',
      mode==='bad-id'?{externalId:'bad'}:mode==='bad-query'?{query:'a'}:{},
      mode!=='no-auth');
    assert.ok(res.status>=400,mode);
    assert.equal(t.state.writes.length,0,mode);
    if(mode!=='no-key' && !['expired','suspended'].includes(mode)) {
      // Category and input validation failures also happen before upstream.
      assert.equal(t.state.upstream.length,0,mode);
    }
  }

  const { AppError }=load('mobile/src/errors/appError.ts');
  const { SupabaseYouTubeCatalogRepository }=load('mobile/src/repositories/supabase/supabaseYouTubeCatalogRepository.ts',{
    '@/errors/appError':{AppError},
  });
  const calls=[]; let failure=null;
  const repo=new SupabaseYouTubeCatalogRepository({functions:{invoke:async(name,options)=>{
    calls.push(options); assert.equal(name,'youtube-catalog');
    return { data: options.body.action==='search' ? {channels:[mappedSearch]} :
      {itemId:'c3333333-3333-4333-8333-333333333333',categoryId:'d4444444-4444-4444-8444-444444444444',created:false}, error:failure };
  }}});
  const signal=new AbortController().signal;
  assert.equal((await repo.search('테스트 채널',signal))[0].title,'테스트 채널');
  assert.equal(calls[0].signal,signal);
  await repo.importChannel(channelId);
  assert.equal(calls.at(-1).body.externalId,channelId);
  failure={context:new Response(JSON.stringify({error:'RATE_LIMITED'}),{status:429})};
  await assert.rejects(()=>repo.search('테스트 채널'),(error)=>error.code==='RATE_LIMITED');

  const { YouTubeCatalogService }=load('mobile/src/services/youtubeCatalogService.ts');
  const serviceCalls=[]; const service=new YouTubeCatalogService({
    search:async(...args)=>{serviceCalls.push(args);return[mappedSearch];},
    importChannel:async()=>({created:true}),
  });
  await service.search(' 테스트 채널 ');
  assert.equal(serviceCalls[0][0],'테스트 채널');
  const longServiceUrl='https://youtu.be/'+videoId+'?si='+'z'.repeat(160);
  await service.search(longServiceUrl);
  assert.equal(serviceCalls.at(-1)[0],longServiceUrl,'long shared YouTube links reach the repository');
  assert.equal((await service.search('a')).length,0);

  const intents=load('mobile/src/lib/auth/authIntent.ts');
  const categoryId='d4444444-4444-4444-8444-444444444444';
  const intent=intents.getAuthIntent({action:'choose_youtube',externalYouTubeId:channelId,categoryId});
  assert.equal(intent.action,'choose_youtube');
  assert.equal(intents.getPostAuthRoute(intent).pathname,'/pick/youtube');
  assert.equal(intents.getAuthIntent({action:'choose_youtube',externalYouTubeId:'bad',categoryId}).action,'home');

  const screen=fs.readFileSync(path.join(root,'mobile/src/app/pick/youtube.tsx'),'utf8');
  assert.match(screen,/getYouTubePolicyConsent/);
  assert.match(screen,/acceptYouTubePolicyConsent/);
  assert.match(screen,/YouTube 이용약관/);
  assert.match(screen,/Google 개인정보처리방침/);
  assert.match(screen,/영상·Shorts 링크/);
  assert.match(screen,/slice\(0, 1000\)/);
  assert.match(screen,/maxLength=\{1000\}/);
  assert.doesNotMatch(screen,/구독자 수.*toLocaleString|subscriberCount/);

  const indexSource=fs.readFileSync(path.join(root,'supabase/functions/youtube-catalog/index.ts'),'utf8');
  assert.match(indexSource,/YOUTUBE_API_KEY/);
  assert.match(indexSource,/provider: 'youtube_diag'/);
  assert.match(indexSource,/stage: 'youtube'/);
  assert.match(indexSource,/stage: 'config'/);
  assert.doesNotMatch(indexSource,/EXPO_PUBLIC_YOUTUBE/);
  assert.doesNotMatch(indexSource,/statistics/);

  const termsSource=fs.readFileSync(path.join(root,'mobile/src/app/legal/terms.tsx'),'utf8');
  assert.match(termsSource,/YouTube 이용약관에 동의하고 그 적용을 받습니다/);

  console.log('YouTube catalog passed: ranked channel search, handle/channel/video-link lookup, safe name search, no search writes/stats, selected-only import, freshness refresh, consent gate and login return.');
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
