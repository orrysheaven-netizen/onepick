import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type {
  PickReadInput,
  ReadRepository,
} from '@/repositories/interfaces/readRepository';
import { mapCategoryRow } from '@/repositories/mappers/categoryMapper';
import { mapCommentRow } from '@/repositories/mappers/commentMapper';
import { mapPickRow } from '@/repositories/mappers/pickMapper';
import { mapProductRow } from '@/repositories/mappers/productMapper';
import { mapProfileRow } from '@/repositories/mappers/profileMapper';

type PickRow = Database['public']['Tables']['picks']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type CategoryRow = Database['public']['Tables']['categories']['Row'];
type ProductRow = Database['public']['Tables']['products']['Row'];
type CommentRow = Database['public']['Tables']['comments']['Row'];

type Related<T> = T | T[] | null;
type PickReadRow = PickRow & {
  profile: Related<ProfileRow>;
  category: Related<CategoryRow>;
  product: Related<ProductRow>;
};
type CommentReadRow = CommentRow & {
  author: Related<ProfileRow>;
};
type ProductRequestReadRow = ProductRow & {
  category: Related<CategoryRow>;
  mergedIntoProduct: Related<ProductRow>;
};

const PICK_READ_SELECT = `
  *,
  profile:profiles!picks_user_id_fkey(*),
  category:categories!picks_category_id_fkey(*),
  product:products!picks_product_category_fk(*)
`;

function one<T>(value: Related<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export class SupabaseReadRepository implements ReadRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  private mapProduct(row: ProductRow | null) {
    if (!row) return null;
    return mapProductRow(
      row,
      row.image_path ? this.client.storage.from('product-photos').getPublicUrl(row.image_path).data.publicUrl : null,
      row.thumbnail_path ? this.client.storage.from('product-photos').getPublicUrl(row.thumbnail_path).data.publicUrl : null,
    );
  }

  private mapPickItem(row: PickReadRow) {
    const profile = one(row.profile);
    const category = one(row.category);
    const product = one(row.product);
    return {
      pick: mapPickRow(row),
      profile: profile ? mapProfileRow(profile) : null,
      category: category ? mapCategoryRow(category) : null,
      product: this.mapProduct(product),
    };
  }

  async getPickById(pickId: string) {
    const { data, error } = await this.client
      .from('picks')
      .select(PICK_READ_SELECT)
      .eq('id', pickId)
      .maybeSingle();

    if (error) throw mapSupabaseError(error);
    return data ? this.mapPickItem(data as unknown as PickReadRow) : null;
  }

  async getPicks(input: PickReadInput) {
    const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);
    let query = this.client
      .from('picks')
      .select(PICK_READ_SELECT)
      .order(input.orderBy ?? 'started_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (input.userId) query = query.eq('user_id', input.userId);
    if (input.excludeUserId) query = query.neq('user_id', input.excludeUserId);
    if (input.categoryId) query = query.eq('category_id', input.categoryId);
    if (input.productId) query = query.eq('product_id', input.productId);
    if (input.statuses?.length) query = query.in('status', input.statuses);

    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);
    return (data as unknown as PickReadRow[]).map((row) => this.mapPickItem(row));
  }

  async getCommentsByPickId(pickId: string, limit = 20, offset = 0) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = Math.max(offset, 0);
    const { data, error } = await this.client
      .from('comments')
      .select(`*, author:profiles!comments_user_id_fkey(*)`)
      .eq('pick_id', pickId)
      .order('created_at', { ascending: true })
      .range(safeOffset, safeOffset + safeLimit - 1);

    if (error) throw mapSupabaseError(error);
    return (data as unknown as CommentReadRow[]).map((row) => {
      const author = one(row.author);
      return {
        comment: mapCommentRow(row),
        author: author ? mapProfileRow(author) : null,
      };
    });
  }

  async getProductRequestsByUser(userId: string, statuses?: ProductRequestReadRow['status'][], limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    let query = this.client
      .from('products')
      .select(`
        *,
        category:categories!products_category_id_fkey(*),
        mergedIntoProduct:products!products_merged_into_product_id_fkey(*)
      `)
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .limit(safeLimit);

    if (statuses?.length) query = query.in('status', statuses);

    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);
    return (data as unknown as ProductRequestReadRow[]).map((row) => {
      const category = one(row.category);
      const mergedIntoProduct = one(row.mergedIntoProduct);
      return {
        product: this.mapProduct(row)!,
        category: category ? mapCategoryRow(category) : null,
        mergedIntoProduct: this.mapProduct(mergedIntoProduct),
      };
    });
  }
}
