import type { Database } from '@/lib/supabase/database.types';
import type { Product, ProductStatus } from '@/types/domain/product';

type ProductRow = Database['public']['Tables']['products']['Row'];

export function mapProductRow(row: ProductRow, imageUrl: string | null = null, thumbnailUrl: string | null = null): Product {
  return {
    id: row.id,
    categoryId: row.category_id,
    brandId: row.brand_id,
    name: row.name,
    normalizedName: row.normalized_name,
    modelCode: row.model_code,
    officialUrl: row.official_url,
    imagePath: row.image_path ?? null,
    imageUrl,
    thumbnailUrl,
    imageSourceUrl: row.image_source_url ?? null,
    status: row.status as ProductStatus,
    mergedIntoProductId: row.merged_into_product_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
