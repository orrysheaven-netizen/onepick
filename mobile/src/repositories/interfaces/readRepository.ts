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

/** One person's current choice, not an aggregate product or a follower event. */
/** Sales channel of a Pick's item: a store (incl. delivery) or online/shipped sales. */
export type PickChannel = 'offline' | 'online';

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
  startedAt: string;
  /** Empty for legacy items with no channel, and on the following feed. */
  channels: PickChannel[];
}

export interface HomePickPage {
  items: HomeFeedPick[];
  nextCursor: ReadCursor | null;
}

export interface CategoryTopItem {
  itemId: string;
  name: string;
  thumbnailUrl: string | null;
  pickCount: number;
  rank: number;
  isTied: boolean;
}

export interface HomeShowcaseItem {
  itemId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  thumbnailUrl: string | null;
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
  editorialNote: string | null;
  editorialPriority: number;
  pickCount: number;
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

export interface ReadRepository {
  /** `channel` narrows the feed server-side (Home 매장/온라인 tabs); null keeps every Pick. */
  getHomePicks(cursor?: ReadCursor | null, channel?: PickChannel | null): Promise<HomePickPage>;
  /** Same cards as getHomePicks, limited to people the session user follows. */
  getFollowingPicks(cursor?: ReadCursor | null): Promise<HomePickPage>;
  getHomeShowcase(cursor?: ReadCursor | null): Promise<HomeShowcase>;
  getEditorialHomeItems(limit?: number): Promise<EditorialHomeItem[]>;
  getCategoryTopItems(categoryId: string): Promise<CategoryTopItem[]>;
  countActivePicks(itemId: string): Promise<number>;
  getPickById(pickId: string): Promise<PickReadItem | null>;
  getPicks(input: PickReadInput): Promise<PickReadItem[]>;
  getCommentsByPickId(pickId: string, limit?: number, cursor?: ReadCursor | null): Promise<CommentReadItem[]>;
  getItemRequestsByUser(userId: string, statuses?: ItemStatus[], limit?: number, cursor?: ReadCursor | null): Promise<ItemRequestReadItem[]>;
}
