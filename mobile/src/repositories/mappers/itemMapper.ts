import type { Database } from '@/lib/supabase/database.types';
import type { Item, ItemStatus } from '@/types/domain/item';

type ItemRow = Database['public']['Tables']['items']['Row'];

export function mapItemRow(row: ItemRow, imageUrl: string | null = null, thumbnailUrl: string | null = null): Item {
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
    status: row.status as ItemStatus,
    mergedIntoItemId: row.merged_into_item_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
