const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const output=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../supabase/functions/import-product-image/imageImport.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const api={};
vm.runInNewContext(output,{exports:api,URL,Response,AbortSignal,TextDecoder,Uint8Array,DataView,btoa,fetch});
async function main(){
  for(const url of ['http://www.otoki.com/a','https://www.otoki.com.evil.example/a','https://127.0.0.1/a','https://169.254.169.254/','https://user:pass@www.otoki.com/a','https://www.otoki.com:444/a','file:///x','https://www.otoki.com./x']){
    assert.throws(()=>api.validateSource(url),/IMAGE_SOURCE_UNSUPPORTED/);
  }
  const base=new URL('https://www.otoki.com/product');
  assert.equal(api.extractImageUrl('<meta content="/photo.jpg?a=1&amp;b=2" property="og:image">',base).href,'https://www.otoki.com/photo.jpg?a=1&b=2');
  assert.throws(()=>api.extractImageUrl('<meta property="og:image" content="https://localhost/private">',base),/IMAGE_IMPORT_FAILED/);
  let calls=[];
  await assert.rejects(()=>api.importImage(base.href,async(url)=>{calls.push(url);return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}});}),/IMAGE_SOURCE_UNSUPPORTED/);
  assert.equal(calls.length,1,'Unsafe redirects are rejected before the next request');
  await assert.rejects(()=>api.importImage(base.href,async()=>new Response('x',{headers:{'content-type':'image/svg+xml'}})),/PHOTO_INVALID/);
  await assert.rejects(()=>api.readLimited(new Response('oversized').body,2),/PHOTO_TOO_LARGE/);
  await assert.rejects(()=>api.importImage(base.href,async()=>new Response('html disguised as image',{headers:{'content-type':'image/jpeg'}})),/PHOTO_INVALID/);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=','base64');
  calls=[];
  const imported=await api.importImage(base.href,async(url,options)=>{
    calls.push(url);assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,undefined);
    return url.endsWith('/product') ? new Response('<meta property="og:image" content="/photo.png">',{headers:{'content-type':'text/html'}}) : new Response(png,{headers:{'content-type':'image/png'}});
  });
  assert.equal(calls.length,2);assert.ok(imported.dataUri.startsWith('data:image/png;base64,'));
  assert.equal(imported.sourceUrl,base.href);
  const bomb=Buffer.from(png);bomb.writeUInt32BE(100000,16);bomb.writeUInt32BE(100000,20);
  assert.throws(()=>api.imageType(bomb),/PHOTO_INVALID/);
  console.log('Image import checks passed: exact allowed hosts, redirects, no credential forwarding, byte/pixel limits, metadata and downloaded bytes.');
}
main().catch((e)=>{console.error(e);process.exitCode=1;});
