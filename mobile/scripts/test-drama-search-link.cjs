const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
let button,route;
const categories={data:[{id:'drama-id',slug:'drama'}],isError:false,isPending:false};
const imports={
  'expo-router':{useRouter:()=>({push:(value)=>{route=value;}})},
  'react-native':{StyleSheet:{create:(v)=>v},Text:({children})=>React.createElement('span',null,children),Pressable:(props)=>{button=props;return React.createElement('button',null,props.children);}},
  '@/hooks/useRegisterPick':{useRegistrationCategories:()=>categories},
};
const output={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/components/drama-search-link.tsx'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText,{exports:output,require:(name)=>name === '@/constants/onepick' ? require('./design-tokens.cjs') : name==='react/jsx-runtime'?require(name):imports[name]});
const render=(categoryId,query='  테스트  드라마  ')=>{button=null;return renderToStaticMarkup(React.createElement(output.DramaSearchLink,{categoryId,query}));};
assert.match(render(),/드라마 DB에서 찾아보기/);button.onPress();assert.equal(route.pathname,'/pick/find');assert.equal(route.params.categoryId,'drama-id');assert.equal(route.params.query,'테스트 드라마');
assert.match(render('drama-id'),/드라마 DB/);assert.equal(render('ramen-id'),'');assert.equal(render('movie-id'),'');
assert.equal(render(undefined,'a'),'');assert.equal(render(undefined,'a'.repeat(61)),'');
categories.isError=true;assert.equal(render(),'');categories.isError=false;categories.isPending=true;assert.equal(render(),'');
console.log('Drama search link passed: existing empty search connects to drama, correct scope/query and failure visibility.');
