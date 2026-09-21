import type { AdminCategory } from '@/lib/admin-api';
import type { Category } from '@/types/domain/category';

// The admin API returns snake_case category rows; the category-tree helpers
// (selectableCategories, categoryLabel, ...) work on the domain shape.
export function toDomainCategory(category: AdminCategory): Category {
  return {
    id: category.id,
    parentId: category.parent_id,
    name: category.name,
    slug: category.slug,
    status: category.status,
    isVisible: category.is_visible,
    isPickable: category.is_pickable,
    rankingMinSample: category.ranking_min_sample,
    sortOrder: category.sort_order,
    imageUrl: category.image_url,
    createdAt: '',
    updatedAt: '',
  };
}
