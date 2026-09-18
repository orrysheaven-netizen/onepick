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

const {
  mapNlkBook, extractNlkRows, normalizeIsbn13, bookItemName, createBookCatalogHandler,
} = load('supabase/functions/book-catalog/bookCatalog.ts', { '@supabase/supabase-js': {} });

const isbn = '9788936434120';
const secondIsbn = '9780306406157';
const raw = {
  TITLE: '소년이 온다', AUTHOR: '한강', EA_ISBN: isbn, PUBLISHER: '창비',
  EDITION_STMT: '초판', FORM: '종이책', PUBLISH_PREDATE: '20140519',
  EBOOK_YN: 'N', TITLE_URL: 'https://example.invalid/cover.jpg',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function setup() {
  const state = {
    rows: [], writes: [], upstream: [], cache: new Map(), auth: true, suspended: false, apiKey: 'server-secret',
    categories: [
      { id:'book',parent_id:'content',slug:'book',status:'open',is_visible:true,is_pickable:true },
      { id:'content',parent_id:null,slug:'content',status:'open',is_visible:true,is_pickable:false },
    ],
    searchRows: [raw],
    importRows: [raw],
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
  const handler=createBookCatalogHandler({
    client:()=>client,
    json,
    apiKey:()=>state.apiKey || null,
    readCache:async(_client,key)=>state.cache.get(key)??null,
    writeCache:async(_client,key,payload)=>{state.cache.set(key,payload);},
    fetchNlk:async(url)=>{
      state.upstream.push(url);
      return { data:{ docs: url.searchParams.has('isbn') ? state.importRows : state.searchRows } };
    },
  });
  const request=(action,extra={},auth=true)=>handler(
    { action,title:'소년이 온다',author:'한강',externalId:isbn,...extra },
    new Request('https://edge.test',{headers:auth?{Authorization:'Bearer token'}:{}}),
  );
  return { state,request };
}

async function main() {
  assert.equal(normalizeIsbn13('978-89-364-3412-0'), isbn);
  assert.equal(normalizeIsbn13('9788936434121'), null, 'bad checksum rejected');
  const mapped=mapNlkBook(raw);
  assert.equal(mapped.externalId,isbn);
  assert.equal(mapped.title,'소년이 온다');
  assert.equal(mapped.authorName,'한강');
  assert.equal(mapped.publisherName,'창비');
  assert.equal(mapped.publishYear,2014);
  assert.equal(mapped.isEbook,false);
  assert.equal(mapped.coverUrl,null,'provider cover is deliberately not exposed before rights verification');
  assert.equal(bookItemName(mapped),'소년이 온다 · 한강');
  assert.equal(mapNlkBook({...raw,EA_ISBN:'bad'}),null);
  assert.equal(extractNlkRows({docs:{e:[raw]}}).length,1);

  const s=setup();
  s.state.searchRows=[raw,{...raw,EA_ISBN:secondIsbn,TITLE:'소년이 온다',EDITION_STMT:'개정판'}];
  const search=await (await s.request('search',{},false)).json();
  assert.equal(search.books.length,2,'different ISBN editions are never title-merged');
  assert.equal(s.state.writes.length,0,'search never writes unselected books');
  assert.equal(s.state.upstream[0].hostname,'www.nl.go.kr');
  assert.equal(s.state.upstream[0].pathname,'/seoji/SearchApi.do');
  assert.equal(s.state.upstream[0].searchParams.get('cert_key'),'server-secret');
  assert.equal(s.state.upstream[0].searchParams.get('title'),'소년이 온다');
  assert.equal(s.state.upstream[0].searchParams.get('author'),'한강');
  assert.equal(s.state.upstream[0].searchParams.get('result_style'),'json');

  await s.request('search',{},false);
  assert.equal(s.state.upstream.length,1,'exact search cache avoids another provider request');

  const saved=await (await s.request('import')).json();
  assert.equal(saved.created,true);
  assert.equal(saved.categoryId,'book');
  assert.equal(s.state.writes[0].external_source,'nlk_isbn');
  assert.equal(s.state.writes[0].external_id,isbn);
  assert.equal(s.state.writes[0].name,'소년이 온다 · 한강');
  assert.equal(s.state.writes[0].creator_name,'한강');
  assert.equal(s.state.writes[0].collection_name,'창비');
  assert.equal(s.state.writes[0].image_source_url,null);
  const upstream=s.state.upstream.length;
  const again=await (await s.request('import')).json();
  assert.equal(again.itemId,saved.itemId);
  assert.equal(again.created,false);
  assert.equal(s.state.upstream.length,upstream,'reselect reuses existing item before provider call');

  const known=await (await s.request('search',{},false)).json();
  assert.equal(known.books.find((b)=>b.externalId===isbn).existingItemId,saved.itemId);

  for(const mode of ['no-auth','expired','suspended','hidden-category','hidden-parent','non-leaf','bad-isbn','bad-query','no-key']){
    const t=setup();
    if(mode==='expired') t.state.auth=false;
    if(mode==='suspended') t.state.suspended=true;
    if(mode==='hidden-category') t.state.categories[0].is_visible=false;
    if(mode==='hidden-parent') t.state.categories[1].is_visible=false;
    if(mode==='non-leaf') t.state.categories.push({id:'child',parent_id:'book'});
    if(mode==='no-key') t.state.apiKey='';
    const res=await t.request(mode==='bad-query'?'search':'import',
      mode==='bad-isbn'?{externalId:'9788936434121'}:mode==='bad-query'?{title:'a',author:''}:{},
      mode!=='no-auth');
    assert.ok(res.status>=400,mode);
    assert.equal(t.state.writes.length,0,mode);
    if(mode!=='no-key') assert.equal(t.state.upstream.length,0,mode);
  }

  const { AppError }=load('mobile/src/errors/appError.ts');
  const { SupabaseBookCatalogRepository }=load('mobile/src/repositories/supabase/supabaseBookCatalogRepository.ts',{
    '@/errors/appError':{AppError},
  });
  const calls=[]; let failure=null;
  const repo=new SupabaseBookCatalogRepository({functions:{invoke:async(name,options)=>{
    calls.push(options); assert.equal(name,'book-catalog');
    return { data: options.body.action==='search' ? {books:[mapped]} :
      {itemId:'c3333333-3333-4333-8333-333333333333',categoryId:'d4444444-4444-4444-8444-444444444444',created:false}, error:failure };
  }}});
  const signal=new AbortController().signal;
  assert.equal((await repo.search('소년이 온다','한강',signal))[0].publisherName,'창비');
  assert.equal(calls[0].signal,signal);
  assert.equal(calls[0].body.author,'한강');
  await repo.importBook(isbn);
  assert.equal(calls.at(-1).body.externalId,isbn);
  failure={context:new Response(JSON.stringify({error:'CATALOG_NOT_CONFIGURED'}),{status:503})};
  await assert.rejects(()=>repo.search('소년이 온다','한강'),(error)=>error.code==='CATALOG_NOT_CONFIGURED');

  const { BookCatalogService }=load('mobile/src/services/bookCatalogService.ts');
  const serviceCalls=[]; const service=new BookCatalogService({
    search:async(...args)=>{serviceCalls.push(args);return[mapped];},
    importBook:async()=>({created:true}),
  });
  await service.search(' 소년이 온다 ',' 한강 ');
  assert.deepEqual(serviceCalls[0].slice(0,2),['소년이 온다','한강']);
  assert.equal((await service.search('a','')).length,0);

  const intents=load('mobile/src/lib/auth/authIntent.ts');
  const categoryId='d4444444-4444-4444-8444-444444444444';
  const intent=intents.getAuthIntent({action:'choose_book',externalBookId:'978-89-364-3412-0',categoryId});
  assert.equal(intent.action,'choose_book');
  assert.equal(intent.externalBookId,isbn);
  assert.equal(intents.getPostAuthRoute(intent).pathname,'/pick/book');
  assert.equal(intents.getAuthIntent({action:'choose_book',externalBookId:'bad',categoryId}).action,'home');

  console.log('Book catalog passed: ISBN-13 edition identity, no search writes/covers, selected-only import, cache, auth/category gates and login return.');
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
