import type { Category } from '@/types/domain/category';
import type { Comment } from '@/types/domain/comment';
import type { Pick, PickStatus } from '@/types/domain/pick';
import type { Product, ProductStatus } from '@/types/domain/product';
import type { Profile } from '@/types/domain/profile';

export interface PickReadItem {
  pick: Pick;
  profile: Profile | null;
  category: Category | null;
  product: Product | null;
}

export interface CommentReadItem {
  comment: Comment;
  author: Profile | null;
}

export interface ProductRequestReadItem {
  product: Product;
  category: Category | null;
  mergedIntoProduct: Product | null;
}

export interface PickReadInput {
  userId?: string;
  excludeUserId?: string;
  categoryId?: string;
  productId?: string;
  statuses?: PickStatus[];
  limit?: number;
  offset?: number;
  orderBy?: 'started_at' | 'updated_at';
}

export interface ReadRepository {
  getPickById(pickId: string): Promise<PickReadItem | null>;
  getPicks(input: PickReadInput): Promise<PickReadItem[]>;
  getCommentsByPickId(pickId: string, limit?: number, offset?: number): Promise<CommentReadItem[]>;
  getProductRequestsByUser(userId: string, statuses?: ProductStatus[], limit?: number): Promise<ProductRequestReadItem[]>;
}
