import { browseCategoryGroups } from '@/lib/categories/categoryTree';
import type { Category } from '@/types/domain/category';

export const HOME_ROOT_SLUGS:readonly string[]=['food'];
export const HOME_FEED_ROOT_SLUG:string|null=HOME_ROOT_SLUGS.length===1?HOME_ROOT_SLUGS[0]:null;
export interface HomeCategoryFilter{id:string;name:string;categoryIds:string[]}
type Ranked=Category&{homeRecentRankingLoaded?:boolean;homeRecentPickCount?:number;homeRecentRank?:number;homeRecentShowCount?:boolean};

function groups(categories:Category[],roots:readonly string[]){
  return browseCategoryGroups(categories).filter(g=>roots.includes(g.category.slug));
}
export function buildHomeCategoryFilters(categories:Category[],roots:readonly string[]=HOME_ROOT_SLUGS):HomeCategoryFilter[]{
  return groups(categories,roots).map(g=>({id:g.category.id,name:g.category.name,
    categoryIds:[...(g.directlySelectable?[g.category.id]:[]),...g.children.map(c=>c.id)]})).filter(g=>g.categoryIds.length>0);
}
export function homeStarterCategories(categories:Category[],limit=6,roots:readonly string[]=HOME_ROOT_SLUGS):Category[]{
  const rows=categories as Ranked[];
  if(rows.some(c=>c.homeRecentRankingLoaded===true)){
    const allowed=new Set(groups(categories,roots).flatMap(g=>g.children.map(c=>c.id)));
    return rows.filter(c=>allowed.has(c.id)&&Number.isFinite(c.homeRecentRank))
      .sort((a,b)=>(a.homeRecentRank!-b.homeRecentRank!)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id))
      .slice(0,limit).map(c=>({...c,name:c.homeRecentShowCount?`${c.name} · ${c.homeRecentPickCount}명`:c.name}));
  }
  const seen=new Set<string|null>(),out:Category[]=[];
  for(const g of groups(categories,roots))for(const c of g.children){
    if(out.length>=limit)return out;
    if(!seen.has(c.parentId)){seen.add(c.parentId);out.push(c);}
  }
  return out;
}
export function homeMenuCategories(categories:Category[],roots:readonly string[]=HOME_ROOT_SLUGS):Category[]{
  return groups(categories,roots).flatMap(g=>g.children);
}
export const MENU_SUGGESTION_SLUGS:readonly string[]=['pork-gukbap','pyeongyang-naengmyeon','doganitang','malatang','kalguksu','dakgalbi','sushi','fried-chicken'];
export function homeMenuSuggestions(categories:Category[],limit=8):Category[]{
  const menus=homeMenuCategories(categories);
  const curated=MENU_SUGGESTION_SLUGS.map(s=>menus.find(m=>m.slug===s)).filter((m):m is Category=>Boolean(m));
  return [...curated,...homeStarterCategories(categories,limit).filter(m=>!curated.some(c=>c.id===m.id))].slice(0,limit);
}
export function searchMenuCategories(menus:Category[],query:string,limit=12):Category[]{
  const q=query.toLowerCase().replace(/\s+/g,'');if(!q)return[];
  return menus.filter(m=>`${m.name}${m.slug}`.toLowerCase().replace(/\s+/g,'').includes(q)).slice(0,limit);
}
export function filterHomeFeedByCategory<T extends{categoryId:string}>(items:T[],filter?:HomeCategoryFilter|null){
  if(!filter)return items;const ids=new Set(filter.categoryIds);return items.filter(i=>ids.has(i.categoryId));
}
