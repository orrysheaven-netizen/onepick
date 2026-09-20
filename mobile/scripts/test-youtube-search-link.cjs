const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path'); const vm=require('node:vm'); const ts=require('typescript');
const React=require('react'); const {renderToStaticMarkup}=require('react-dom/server');
let route, categories={data:[{id:'youtube-id',slug:'youtube'}],isError:false,isPending:false};
const moduleExports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/components/youtube-search-link.tsx'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
}).outputText,{exports:moduleExports,require:(name)=>{
  if(name==='react/jsx-runtime')return require(name);
  if(name==='expo-router')return{useRouter:()=>({push:(r)=>{route=r;}})};
  if(name==='react-native')return{Pressable:(p)=>React.createElement('button',{onClick:p.onPress},p.children),Text:({children})=>React.createElement('span',null,children),StyleSheet:{create:x=>x}};
  if(name==='@/hooks/useRegisterPick')return{useRegistrationCategories:()=>categories};
  throw new Error(name);
}});
const Link=moduleExports.YoutubeSearchLink;
let page=renderToStaticMarkup(React.createElement(Link,{query:' mkbhd '})); assert.match(page,/YouTube 채널에서 찾아보기/);
const tree=Link({query:'mkbhd'}); tree.props.onPress();
assert.equal(route.pathname,'/pick/youtube'); assert.equal(route.params.categoryId,'youtube-id'); assert.equal(route.params.query,'mkbhd');
route=null; page=renderToStaticMarkup(React.createElement(Link,{query:'mkbhd',categoryId:'other'})); assert.doesNotMatch(page,/YouTube 채널/);
categories={data:[],isError:false,isPending:false}; page=renderToStaticMarkup(React.createElement(Link,{query:'mkbhd'})); assert.doesNotMatch(page,/YouTube 채널/);
console.log('YouTube search link passed: optional local-empty handoff, category scope and normalized query.');
