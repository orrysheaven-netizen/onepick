import { OnePickThresholds } from '@/constants/onepick';
import { publicCountClient } from '@/lib/supabase/client';

export type HomeRecentMenuRank={categoryId:string;pickCount:number;rank:number;showCount:boolean};
type Row={category_id:string;pick_count:number|string;rank:number|string};
type Rpc=(name:string,args:{p_group_category_id:null;p_limit:number})=>PromiseLike<{data:Row[]|null;error:unknown}>;

export async function fetchHomeRecentMenuRanking(limit=6):Promise<HomeRecentMenuRank[]>{
  const p_limit=Math.min(Math.max(Math.trunc(limit),1),50);
  const {data,error}=await (publicCountClient.rpc as unknown as Rpc)('food_menu_recent_ranking',{p_group_category_id:null,p_limit});
  if(error)throw error;
  return (data??[]).map(row=>{
    const pickCount=Number(row.pick_count);
    return {categoryId:row.category_id,pickCount,rank:Number(row.rank),
      showCount:pickCount>=OnePickThresholds.exploreRankingMinPicks};
  });
}
