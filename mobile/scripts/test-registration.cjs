const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports,URL,require:(name)=>{assert.ok(name in imports,name);return imports[name];}});
  return exports;
}
async function main() {
  const {AppError}=load('errors/appError.ts');
  const identity=load('lib/products/productIdentity.ts');
  const {canonicalProductName}=identity;
  for (const [input,slug,expected] of [
    ['진라면 매운맛 컵라면 110g','ramen','진라면 매운맛'],
    ['진라면 매운맛 봉지면 120g 5봉','ramen','진라면 매운맛'],
    ['진라면 순한맛 용기','ramen','진라면 순한맛'],
    ['신라면큰사발','ramen','신라면'], ['컵누들 매콤한맛','ramen','컵누들 매콤한맛'],
    ['카스 프레시 500ml 캔','beer','카스 프레시'], ['카스 0.0 330ml 병','beer','카스 0.0'],
    ['참이슬 후레쉬 360ml 병','soju','참이슬 후레쉬'], ['새우깡 매운맛 90g','snacks','새우깡 매운맛'],
    ['새우깡 미니','snacks','새우깡 미니'], ['신라면 컵 120g','future','신라면 컵 120g'],
  ]) assert.equal(canonicalProductName(input,slug),expected,input);
  let calls=[], product=null;
  const category={id:'ramen',slug:'ramen',isVisible:true,isPickable:true,status:'open'};
  const {RegistrationService}=load('services/registrationService.ts',{'@/errors/appError':{AppError},'@/lib/products/productIdentity':identity});
  const service=new RegistrationService(
    {getById:async()=>category,getOpenCategories:async()=>[category,{...category,slug:'future'},{...category,isPickable:false}]},
    {registerPick:async(input)=>{calls.push(['save',input]);return {id:'pick'};}},
    {getById:async()=>product},
    {cleanupUnused:async()=>calls.push(['cleanup']),upload:async()=>{calls.push(['upload']);return {imagePath:'photo',thumbnailPath:'thumb'};},removeUnused:async(paths)=>calls.push(['removeUnused',paths]),importFromUrl:async(url)=>({dataUri:'data:image/jpeg;base64,eA==',sourceUrl:url})},
    {preparePhoto:async(uri,sourceUrl)=>({uri,sourceUrl}),choosePhoto:async()=>null},
  );
  assert.equal((await service.getCategories()).length,1);
  const input={userId:'me',categoryId:'ramen',productName:'진라면 매운맛 컵라면',variant:'',oneLineReview:'  이유  '};
  await service.register(input);
  assert.equal(calls.length,1,'Image-free registration needs no upload');
  assert.equal(calls[0][1].productName,'진라면 매운맛');
  assert.equal(calls[0][1].oneLineReview,'이유');
  calls=[];
  product={id:'existing',name:'진라면 매운맛',categoryId:'ramen',status:'active',imagePath:'shared'};
  await service.register({...input,productId:product.id,photo:{base64:'unused'}});
  assert.deepEqual(calls.map(([name])=>name),['save'],'Existing representative image is reused');
  calls=[]; product={...product,imagePath:null};
  await service.register({...input,productId:product.id,photo:{base64:'image',sourceUrl:'https://www.otoki.com/test'}});
  assert.deepEqual(calls.map(([name])=>name),['cleanup','upload','save','removeUnused']);
  assert.equal(calls[2][1].imageSourceUrl,'https://www.otoki.com/test');
  calls=[]; category.isVisible=false;
  await assert.rejects(()=>service.register(input),(e)=>e.code==='CATEGORY_NOT_PICKABLE');
  assert.equal(calls.length,0,'Validate availability before uploading');
  category.isVisible=true;
  await assert.rejects(()=>service.register({...input,oneLineReview:' '}),(e)=>e.code==='REVIEW_INVALID');
  await assert.rejects(()=>service.importPhoto('http://localhost/test'),(e)=>e.code==='IMAGE_SOURCE_UNSUPPORTED');
  const imported=await service.importPhoto('https://www.otoki.com/product');
  assert.equal(imported.sourceUrl,'https://www.otoki.com/product');
  console.log('Registration checks passed: category identity, optional photos, shared image reuse, validation and URL import.');
}
main().catch((e)=>{console.error(e);process.exitCode=1;});
