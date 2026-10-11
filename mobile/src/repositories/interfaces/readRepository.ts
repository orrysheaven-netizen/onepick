import type { PickChannelScope } from '@/lib/home/channelFeedMerge';
import type { PickChannel } from '@/lib/items/pickChannel';
import type { Category } from '@/types/domain/category';
import type { Comment } from '@/types/domain/comment';
import type { Pick, PickStatus } from '@/types/domain/pick';
import type { Item, ItemStatus } from '@/types/domain/item';
import type { Profile } from '@/types/domain/profile';

export interface PickReadItem {
  pick: Pick;
  profile: Profile | null;
  category: Category | null;
  item: Item | null;
}

export interface CommentReadItem {
  comment: Comment;
  author: Profile | null;
  replies?: CommentReadItem[];
  replyCount?: number;
}

/** Keeps rows whose Pick sits under the top-level category `rootSlug` (inside) or under any other (outside). */
export interface RootCategoryScope {
  rootSlug: string;
  inside: boolean;
}

/** A comment I wrote, with the review it answers. Pick/item/author are null when no longer visible. */
export interface MyCommentReadItem {
  comment: Comment;
  pick: Pick | null;
  pickAuthor: Profile | null;
  item: Item | null;
}

export interface ItemRequestReadItem {
  item: Item;
  category: Category | null;
  mergedIntoItem: Item | null;
}

export interface ReadCursor {
  timestamp: string;
  id: string;
}

export interface CommentLocation {
  rootCommentId: string;
  pickId: string;
  itemId: string;
  categoryId: string;
  channel: PickChannel | null;
  reviewIsCurrent: boolean;
  reviewIsDeleted: boolean;
  pageCursor: ReadCursor | null;
}

export type { PickChannel } from '@/lib/items/pickChannel';

/** One person's current choice, not an aggregate product or a follower event. */

export interface HomeFeedPick {
  pickId: string;
  userId: string;
  username: string;
  profileImageUrl: string | null;
  itemId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  oneLineReview: string;
  thumbnailUrl: string | null;
  /** The item's brand logo, used as the card image when there is no photo. */
  brandLogoUrl?: string | null;
  startedAt: string;
  /** Empty for legacy items with no channel, and on the following feed. */
  channels: PickChannel[];
  /** Public provider profile for store/online items. */
  providerId?: string | null;
}

export interface HomePickPage {
  items: HomeFeedPick[];
  nextCursor: ReadCursor | null;
}

export interface CategoryTopItem {
  itemId: string;
  name: string;
  thumbnailUrl: string | null;
  /** The item's brand logo, used as the card image when there is no photo. */
  brandLogoUrl?: string | null;
  pickCount: number;
  rank: number;
  isTied: boolean;
  channels: PickChannel[];
}

/** One food menu ranked by distinct current pickers during the rolling last 7 days. */
export interface FoodMenuRecentRankingItem {
  categoryId: string;
  categoryName: string;
  groupCategoryId: string | null;
  pickCount: number;
  rank: number;
  isTied: boolean;
  coverItemId: string | null;
  thumbnailUrl: string | null;
}

/** One store's menu in the 7-day ranking (Home 인기 메뉴 and its 더보기 screen). */
export interface FoodItemRecentRankingItem {
  itemId: string;
  /** Store name (the item is named for its provider). */
  itemName: string;
  categoryId: string;
  /** Menu name. */
  categoryName: string;
  pickCount: number;
  rank: number;
  isTied: boolean;
  thumbnailUrl: string | null;
}

/** A leaf category that has a public ranking page (/ranking/<slug>). */
export interface RankingCategory {
  categoryId: string;
  slug: string;
  name: string;
  /** Full visible path, e.g. 먹을것 › 쇼핑몰 › 김치. */
  path: string;
}

/** One place/product per row, ordered by its latest visible active Pick. */
export interface RecentPickedItem {
  itemId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  thumbnailUrl: string | null;
  /** The item's brand logo, used as the card image when there is no photo. */
  brandLogoUrl?: string | null;
  lastPickedAt: string;
  channels: PickChannel[];
}

export interface RecentPickedItemPage {
  items: RecentPickedItem[];
  nextCursor: ReadCursor | null;
}

export interface HomeShowcaseItem {
  itemId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  thumbnailUrl: string | null;
  /** The item's brand logo, used as the card image when there is no photo. */
  brandLogoUrl?: string | null;
  pickCount: number;
  latestPickId: string | null;
  latestPickerUsername: string | null;
  latestPickReview: string | null;
}

export interface HomeShowcase {
  minimumPickCount: number;
  items: HomeShowcaseItem[];
  nextCursor: ReadCursor | null;
}

export interface EditorialHomeItem {
  itemId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  categoryPath: string;
  thumbnailUrl: string | null;
  /** The item's brand logo, used as the card image when there is no photo. */
  brandLogoUrl?: string | null;
  editorialNote: string | null;
  editorialPriority: number;
  pickCount: number;
  channels: PickChannel[];
}

export interface PickReadInput {
  userId?: string;
  excludeUserId?: string;
  categoryId?: string;
  itemId?: string;
  statuses?: PickStatus[];
  limit?: number;
  cursor?: ReadCursor | null;
  orderBy?: 'started_at' | 'updated_at';
}

/** The brand an item belongs to (99밀크티 for its 강남점 milk tea). */
export interface ItemBrand {
  brandId: string;
  name: string;
  logoUrl: string | null;
}

/** One item of a dish shown in one channel, with how many people picked it there. */
export interface DishChannelItem {
  itemId: string;
  name: string;
  thumbnailUrl: string | null;
  /** The item's brand logo, used as the card image when there is no photo. */
  brandLogoUrl?: string | null;
  pickCount: number;
}

/** A searched dish shown three ways: 오프라인 맛집, 온라인 맛집 and 레시피. */
export interface DishChannelOverview {
  categoryId: string;
  categoryName: string;
  channels: Record<PickChannel, DishChannelItem[]>;
}

export interface ReadRepository {
  /** Optional so test doubles need not stub it; a missing brand is never an error. */
  getItemBrand?(itemId: string): Promise<ItemBrand | null>;
  /** The dish the query names exactly (e.g. 미역국) split by channel; null when the query is not a dish. */
  getDishChannelOverview(query: string): Promise<DishChannelOverview | null>;
  /**
   * `channel` narrows the feed server-side (Home 매장/온라인 tabs), `rootSlug`
   * keeps one top-level category tree (MVP: 'food') and `categoryId` one dish
   * (the 미역국 page); null keeps every Pick.
   */
  getHomePicks(cursor?: ReadCursor | null, channel?: PickChannelScope, rootSlug?: string | null, categoryId?: string | null): Promise<HomePickPage>;
  /** Same cards as getHomePicks, limited to people the session user follows. */
  getFollowingPicks(cursor?: ReadCursor | null, channel?: PickChannelScope, rootSlug?: string | null): Promise<HomePickPage>;
  getHomeShowcase(cursor?: ReadCursor | null): Promise<HomeShowcase>;
  getEditorialHomeItems(limit?: number, channel?: PickChannel | null, rootSlug?: string | null): Promise<EditorialHomeItem[]>;
  getFoodMenuRecentRanking(groupCategoryId?: string | null, channel?: PickChannel | null, limit?: number): Promise<FoodMenuRecentRankingItem[]>;
  getFoodItemRecentRanking(channel?: PickChannel | null, limit?: number): Promise<FoodItemRecentRankingItem[]>;
  getCategoryTopItems(categoryId: string, channel?: PickChannel | null): Promise<CategoryTopItem[]>;
  /** Explore (Figma 31): current public Picks per food menu; menus without a row have none. */
  getFoodMenuPickCounts(channel?: PickChannel | null): Promise<Map<string, number>>;
  /**
   * Daily random open food menu chosen by the DB, using the Asia/Seoul calendar.
   * null when the public food catalog has no eligible menu.
   */
  getDailyQuestionCategoryId(): Promise<string | null>;
  /** Public ranking page: the same eligibility as getCategoryTopItems, addressed by slug and longer. */
  getCategoryRanking(slug: string, limit?: number, channel?: PickChannel | null, rootSlug?: string | null): Promise<CategoryTopItem[]>;
  /** Leaf categories that have a public ranking page, in browse order. */
  getRankingCategories(rootSlug?: string | null): Promise<RankingCategory[]>;
  /**
   * Explore list: items in the given leaf categories (all open leaves when omitted), newest Pick first.
   * storesOnly keeps items with a 매장/온라인 channel (places), dropping plain products.
   */
  getRecentPickedItems(categoryIds?: string[] | null, cursor?: ReadCursor | null, storesOnly?: boolean): Promise<RecentPickedItemPage>;
  /** Explore search (Figma 43): current Pick count and short store region per item. */
  getSearchItemMeta(itemIds: string[]): Promise<Record<string, { pickCount: number; region: string | null }>>;
  countActivePicks(itemId: string): Promise<number>;
  getPickById(pickId: string): Promise<PickReadItem | null>;
  getPicks(input: PickReadInput): Promise<PickReadItem[]>;
  /** Item-scoped reviews include current and ended Picks without exposing lifecycle history. */
  getItemReviews?(itemId: string, limit?: number): Promise<PickReadItem[]>;
  getCommentsByPickId(pickId: string, limit?: number, cursor?: ReadCursor | null): Promise<CommentReadItem[]>;
  locateComment(commentId: string): Promise<CommentLocation | null>;
  getCommentsByUser(userId: string, limit?: number, cursor?: ReadCursor | null, scope?: RootCategoryScope | null): Promise<MyCommentReadItem[]>;
  getItemRequestsByUser(userId: string, statuses?: ItemStatus[], limit?: number, cursor?: ReadCursor | null): Promise<ItemRequestReadItem[]>;
}

