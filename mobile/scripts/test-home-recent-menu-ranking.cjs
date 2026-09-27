const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file,imports={}){
  const exports={};
  const js=ts.transpileModule(fs.readFileSync(path.join(root,'src',file),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{exports,require:n=>{assert.ok(n in imports,n);return imports[n];}});
  return exports;
}
(async()=>{
  const calls=[];
  const helper=load('lib/home/recentMenuRanking.ts',{
    '@/constants/onepick':{OnePickThresholds:{exploreRankingMinPicks:3}},
    '@/lib/supabase/client':{publicCountClient:{rpc:async(name,args)=>{
      calls.push([name,args]);return{data:[
        {category_id:'ramen',pick_count:'3',rank:'1'},
        {category_id:'snacks',pick_count:'2',rank:'2'}],error:null};
    }}},
  });
  const rows=await helper.fetchHomeRecentMenuRanking(6);
  assert.deepEqual(calls,[['food_menu_recent_ranking',{p_group_category_id:null,p_limit:6}]]);
  assert.deepEqual(rows.map(r=>[r.categoryId,r.pickCount,r.rank,r.showCount]),
    [['ramen',3,1,true],['snacks',2,2,false]]);

  const tree=load('lib/categories/categoryTree.ts');
  const filters=load('lib/home/homeCategoryFilters.ts',{'@/lib/categories/categoryTree':tree});
  const base={status:'open',isVisible:true,sortOrder:1};
  const categories=[
    {id:'food',slug:'food',parentId:null,name:'음식',isPickable:false,...base,homeRecentRankingLoaded:true},
    {id:'group',slug:'group',parentId:'food',name:'그룹',isPickable:false,...base,homeRecentRankingLoaded:true},
    {id:'ramen',slug:'ramen',parentId:'group',name:'라면',isPickable:true,...base,homeRecentRankingLoaded:true,homeRecentRank:1,homeRecentPickCount:3,homeRecentShowCount:true},
    {id:'snacks',slug:'snacks',parentId:'group',name:'과자',isPickable:true,...base,homeRecentRankingLoaded:true,homeRecentRank:2,homeRecentPickCount:2,homeRecentShowCount:false},
  ];
  assert.deepEqual(Array.from(filters.homeStarterCategories(categories),c=>c.name),['라면 · 3명','과자']);

  const {ExploreService}=load('services/exploreService.ts');
  const service=new ExploreService({getBrowseCategories:async()=>categories}, {}, async()=>rows);
  const enriched=await service.getCategories();
  assert.equal(enriched.find(c=>c.id==='ramen').homeRecentPickCount,3);
  assert.equal(enriched.find(c=>c.id==='snacks').homeRecentShowCount,false);

  const header=fs.readFileSync(path.join(root,'src/components/ui/section-header.tsx'),'utf8');
  assert.match(header,/이번 주 많이 고른 메뉴/);assert.match(header,/최근 7일/);
  console.log('Weekly menu ranking checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
