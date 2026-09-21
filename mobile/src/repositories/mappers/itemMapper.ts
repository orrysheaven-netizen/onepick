import type { Database } from '@/lib/supabase/database.types';
import type { Item, ItemStatus } from '@/types/domain/item';

type ItemRow = Omit<Database['public']['Tables']['items']['Row'], 'requested_category_label'> & {
  creator_name?: string | null;
  collection_name?: string | null;
  requested_category_label?: string | null;
};

export function mapItemRow(row: ItemRow, imageUrl: string | null = null, thumbnailUrl: string | null = null): Item {
  const sourceImageUrl = row.image_source_url ?? null;
  return {
    id: row.id,
    categoryId: row.category_id,
    brandId: row.brand_id,
    name: row.name,
    normalizedName: row.normalized_name,
    modelCode: row.model_code,
    officialUrl: row.official_url,
    imagePath: row.image_path ?? null,
    imageUrl: imageUrl ?? sourceImageUrl,
    thumbnailUrl: thumbnailUrl ?? imageUrl ?? sourceImageUrl,
    imageSourceUrl: sourceImageUrl,
    externalSource: row.external_source,
    externalId: row.external_id,
    originalName: row.original_name,
    releaseYear: row.release_year,
    creatorName: row.creator_name ?? null,
    collectionName: row.collection_name ?? null,
    requestedCategoryLabel: row.requested_category_label ?? null,
    status: row.status as ItemStatus,
    mergedIntoItemId: row.merged_into_item_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
