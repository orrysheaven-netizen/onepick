const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path'); const vm=require('node:vm'); const ts=require('typescript');
const React=require('react'); const {renderToStaticMarkup}=require('react-dom/server');
let route, categories={data:[{id:'game-id',slug:'game'}],isError:false,isPending:false};
const moduleExports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/components/game-search-link.tsx'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
}).outputText,{exports:moduleExports,require:(name)=>{
  if (name === '@/constants/onepick') return require('./design-tokens.cjs');
  if(name==='react/jsx-runtime')return require(name);
  if(name==='expo-router')return{useRouter:()=>({push:(r)=>{route=r;}})};
  if(name==='react-native')return{Pressable:(p)=>React.createElement('button',{onClick:p.onPress},p.children),Text:({children})=>React.createElement('span',null,children),StyleSheet:{create:x=>x}};
  if(name==='@/hooks/useRegisterPick')return{useRegistrationCategories:()=>categories};
  if(name==='@/lib/categories/registrationRoute')return{withOnboardingParam:(params,onboarding)=>onboarding==='1'?{...params,onboarding:'1'}:params};
  throw new Error(name);
}});
const Link=moduleExports.GameSearchLink;
let page=renderToStaticMarkup(React.createElement(Link,{query:' 젤다 '})); assert.match(page,/게임 DB에서 찾아보기/);
const tree=Link({query:'젤다'}); tree.props.onPress();
assert.equal(route.pathname,'/pick/game'); assert.equal(route.params.categoryId,'game-id'); assert.equal(route.params.query,'젤다');
route=null; Link({query:'젤다',onboarding:'1'}).props.onPress(); assert.equal(route.params.onboarding,'1');
route=null; page=renderToStaticMarkup(React.createElement(Link,{query:'젤다',categoryId:'other'})); assert.doesNotMatch(page,/게임 DB/);
categories={data:[],isError:false,isPending:false}; page=renderToStaticMarkup(React.createElement(Link,{query:'젤다'})); assert.doesNotMatch(page,/게임 DB/);
console.log('Game search link passed: optional local-empty handoff, category scope and normalized query.');
