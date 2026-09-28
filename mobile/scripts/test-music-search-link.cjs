const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path'); const vm=require('node:vm'); const ts=require('typescript');
const React=require('react'); const {renderToStaticMarkup}=require('react-dom/server');
let route, categories={data:[{id:'music-id',slug:'music'}],isError:false,isPending:false};
const moduleExports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/components/music-search-link.tsx'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
}).outputText,{exports:moduleExports,require:(name)=>{
  if (name === '@/constants/onepick') return require('./design-tokens.cjs');
  if(name==='react/jsx-runtime')return require(name);
  if(name==='expo-router')return{useRouter:()=>({push:(r)=>{route=r;}})};
  if(name==='react-native')return{Pressable:(p)=>React.createElement('button',{onClick:p.onPress},p.children),Text:({children})=>React.createElement('span',null,children),StyleSheet:{create:x=>x}};
  if(name==='@/hooks/useRegisterPick')return{useRegistrationCategories:()=>categories};
  if(name==='@/lib/onboarding/navigation')return{withOnboardingParam:(params,onboarding)=>onboarding==='1'?{...params,onboarding:'1'}:params};
  throw new Error(name);
}});
const Link=moduleExports.MusicSearchLink;
let page=renderToStaticMarkup(React.createElement(Link,{query:' 밤편지 '})); assert.match(page,/음악 DB에서 찾아보기/);
const button=React.createElement(Link,{query:'밤편지'}); // render once to capture handler through direct component
const tree=Link({query:'밤편지'}); tree.props.onPress();
assert.equal(route.pathname,'/pick/music'); assert.equal(route.params.categoryId,'music-id'); assert.equal(route.params.title,'밤편지');
route=null; Link({query:'밤편지',onboarding:'1'}).props.onPress(); assert.equal(route.params.onboarding,'1');
route=null; page=renderToStaticMarkup(React.createElement(Link,{query:'밤편지',categoryId:'other'})); assert.doesNotMatch(page,/음악 DB/);
categories={data:[],isError:false,isPending:false}; page=renderToStaticMarkup(React.createElement(Link,{query:'밤편지'})); assert.doesNotMatch(page,/음악 DB/);
console.log('Music search link passed: optional local-empty handoff, category scope and normalized title.');
