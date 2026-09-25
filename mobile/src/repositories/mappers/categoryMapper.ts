import type { Database } from '@/lib/supabase/database.types';
import type { Category, CategoryStatus } from '@/types/domain/category';

type CategoryRow = Database['public']['Tables']['categories']['Row'];

export function mapCategoryRow(row: CategoryRow): Category {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    slug: row.slug,
    status: row.status as CategoryStatus,
    isVisible: row.is_visible,
    isPickable: row.is_pickable,
    rankingMinSample: row.ranking_min_sample,
    maxPicks: row.max_picks ?? 1,
    sortOrder: row.sort_order,
    imageUrl: row.image_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
