import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { ReadCursor, ReadRepository } from '@/repositories/interfaces/readRepository';

export const EXPLORE_PAGE_SIZE=20;
type RecentMenuRank={categoryId:string;pickCount:number;rank:number;showCount:boolean};
type RecentMenuRanking=(limit?:number)=>Promise<RecentMenuRank[]>;

export class ExploreService{
  constructor(
    private readonly categoryRepository:CategoryRepository,
    private readonly readRepository:ReadRepository,
    private readonly recentMenuRanking?:RecentMenuRanking,
  ){}
  async getCategories(){
    const categories=await this.categoryRepository.getBrowseCategories();
    if(!this.recentMenuRanking)return categories;
    const ranks=await this.recentMenuRanking(6).catch(()=>[]);
    const byId=new Map(ranks.map(row=>[row.categoryId,row] as const));
    return categories.map(category=>{
      const row=byId.get(category.id);
      return {...category,homeRecentRankingLoaded:true,homeRecentPickCount:row?.pickCount,
        homeRecentRank:row?.rank,homeRecentShowCount:row?.showCount};
    });
  }
  getCategoryTopItems(categoryId:string){return this.readRepository.getCategoryTopItems(categoryId);}
  getCategoryRanking(slug:string,limit?:number){return this.readRepository.getCategoryRanking(slug,limit);}
  getRankingCategories(){return this.readRepository.getRankingCategories();}
  getCategoryBySlug(slug:string){return this.categoryRepository.getBySlug(slug);}
  getRecentItems(categoryIds:string[]|null,cursor:ReadCursor|null=null,storesOnly=false){
    if(categoryIds&&!categoryIds.length)return Promise.resolve({items:[],nextCursor:null});
    return this.readRepository.getRecentPickedItems(categoryIds,cursor,storesOnly);
  }
  async getExploreData(categoryId?:string,cursor:ReadCursor|null=null,limit=EXPLORE_PAGE_SIZE){
    const pageSize=Number.isFinite(limit)?Math.min(Math.max(Math.trunc(limit),1),99):EXPLORE_PAGE_SIZE;
    const [openCategories,rows]=await Promise.all([
      this.categoryRepository.getOpenCategories(),
      this.readRepository.getPicks({categoryId,statuses:['active'],cursor,limit:pageSize+1}),
    ]);
    const hasMore=rows.length>pageSize,feed=rows.slice(0,pageSize),last=feed[feed.length-1]?.pick;
    return {openCategories,selectedCategoryId:categoryId??null,feed,
      nextCursor:hasMore&&last?{timestamp:last.startedAt,id:last.id}:null};
  }
}
