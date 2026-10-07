const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Reuse the existing deterministic source-level lifecycle harness, not its tests.
// This runs current production source without rewriting it or weakening old checks.
const original = fs.readFileSync(path.join(__dirname,'test-movie-selection-recovery.cjs'),'utf8');
const boundary = original.indexOf('let checks = 0, failures = 0;');
assert.ok(boundary > 0, 'The shared lifecycle harness boundary remains explicit');
const harness = { exports: {} };
vm.runInNewContext(original.slice(0,boundary)+'\nmodule.exports = { setup };',
  { module:harness,require,__dirname,console,URL,Request,Response,AbortController,setTimeout,clearTimeout,setImmediate });
const { setup } = harness.exports;
const dramaId = 'd4444444-4444-4444-8444-444444444444';
const movieId = 'a1111111-1111-4111-8111-111111111111';
const itemId = 'c3333333-3333-4333-8333-333333333333';
const entry = { source:'tmdb_tv',externalId:'101',title:'테스트 드라마',originalTitle:'Test Series',releaseYear:2020,posterUrl:null,existingItemId:null };
const receipt = { itemId,categoryId:dramaId,created:true };
const flush = () => new Promise((resolve) => setImmediate(resolve));
function drama(params={}) {
  const s = setup({ categoryId:dramaId,query:'테스트',...params });
  s.categories.data.push({ id:dramaId,slug:'drama',label:'콘텐츠 › 드라마' });
  s.catalog.data = [entry]; return s;
}
async function main() {
  const s = drama(); const page = s.render();
  assert.match(page,/드라마/); assert.match(page,/시즌·회차는 나누지 않아요/); assert.match(page,/Test Series/); assert.match(page,/2020/);
  assert.equal(s.writes.length,0,'Browsing must not import or register a Pick');
  const tap = s.button('테스트 드라마 드라마 선택').onPress; tap(); tap(); assert.equal(s.writes.length,1);
  s.pending[0].resolve(receipt); await flush(); assert.equal(s.routes.length,1);
  assert.equal(s.routes[0].route.pathname,'/pick/choose'); assert.equal(s.routes[0].route.params.categoryId,dramaId);
  assert.equal(s.routes[0].route.params.oneLineReview,undefined);
  const guest=drama(); guest.auth.user=null; guest.render(); guest.button('테스트 드라마 드라마 선택').onPress();
  assert.equal(guest.writes.length,0); assert.equal(guest.routes[0].route.params.action,'choose_drama'); assert.equal(guest.routes[0].route.params.externalId,'101');
  const back=drama({ externalDramaId:'101',query:undefined }); back.render(); back.render(); assert.equal(back.writes.length,1);
  back.pending[0].reject(new Error('offline')); await flush(); back.render(); back.render(); assert.equal(back.writes.length,1);
  back.button('선택한 드라마 다시 불러오기').onPress(); assert.equal(back.writes.length,2);
  back.pending[1].resolve(receipt); await flush(); assert.equal(back.routes[0].action,'replace');
  for (const params of [{externalMovieId:'101'},{externalDramaId:['101']},{externalDramaId:'../101'},{externalMovieId:'101',externalDramaId:'101'},{categoryId:movieId,externalDramaId:'101'}]) {
    const wrong=drama(params); wrong.render(); assert.equal(wrong.writes.length,0,'Wrong media or malformed return cannot execute');
  }
  const local=drama(); local.local.data=[{ id:itemId,categoryId:dramaId,name:entry.title,status:'active',externalSource:'tmdb_tv',externalId:'101' }];
  const localPage=local.render(); assert.doesNotMatch(localPage,/이 드라마를 원픽으로 고르기/);
  local.button('테스트 드라마 원픽 선택').onPress(); assert.equal(local.writes.length,0); assert.equal(local.routes[0].route.params.itemId,itemId);
  const wrongSource=drama(); wrongSource.catalog.data=[{ ...entry,source:'tmdb',title:'Wrong movie namespace' }];
  assert.doesNotMatch(wrongSource.render(),/Wrong movie namespace/);
  for (const mode of ['back','blur','unmount','account','category']) {
    const t=drama(); t.render(); t.button('테스트 드라마 드라마 선택').onPress();
    if(mode==='back') t.button('돌아가기').onPress();
    if(mode==='blur') t.focus(false);
    if(mode==='unmount') t.unmount();
    if(mode==='account') { t.auth.user={id:'other'};t.render(); }
    if(mode==='category') { t.setParams({categoryId:movieId,query:'영화'});t.render(); }
    const count=t.routes.length; t.pending[0].resolve(receipt); await flush(); assert.equal(t.routes.length,count,mode+' late result must not navigate');
  }
  const mismatch=drama(); mismatch.render(); mismatch.button('테스트 드라마 드라마 선택').onPress();
  mismatch.pending[0].resolve({...receipt,categoryId:movieId}); await flush(); assert.equal(mismatch.routes.length,0); assert.match(mismatch.render(),/카테고리/);
  const error=drama(); error.catalog.isError=true;error.local.data=[{id:itemId,name:'등록된 드라마',categoryId:dramaId,status:'active'}];
  assert.match(error.render(),/외부 드라마 검색을 불러오지 못했어요/); error.button('등록된 드라마 원픽 선택').onPress(); assert.equal(error.writes.length,0);
  console.log('Drama find passed: series UI, optional public browse, typed login return, retry, double taps, local dedup, wrong media isolation and interruption recovery.');
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
