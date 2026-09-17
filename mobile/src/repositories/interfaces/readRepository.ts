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
  latestPickId: string;
  latestPickerUsername: string | null;
  latestPickerProfileImageUrl: string | null;
  latestPickReview: string;
}

export interface HomeShowcase {
  minimumPickCount: number;
  items: HomeShowcaseItem[];
  nextCursor: ReadCursor | null;
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
  getHomeShowcase(cursor?: ReadCursor | null): Promise<HomeShowcase>;
  getCategoryTopItems(categoryId: string): Promise<CategoryTopItem[]>;
  countActivePicks(itemId: string): Promise<number>;
  getPickById(pickId: string): Promise<PickReadItem | null>;
  getPicks(input: PickReadInput): Promise<PickReadItem[]>;
  getCommentsByPickId(pickId: string, limit?: number, cursor?: ReadCursor | null): Promise<CommentReadItem[]>;
  getItemRequestsByUser(userId: string, statuses?: ItemStatus[], limit?: number, cursor?: ReadCursor | null): Promise<ItemRequestReadItem[]>;
}
