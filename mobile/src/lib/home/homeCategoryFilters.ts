import { browseCategoryGroups } from '@/lib/categories/categoryTree';
import type { HomeShowcaseItem } from '@/repositories/interfaces/readRepository';
import type { Category } from '@/types/domain/category';

export interface HomeCategoryFilter {
  id: string;
  name: string;
  categoryIds: string[];
}

export function buildHomeCategoryFilters(categories: Category[]): HomeCategoryFilter[] {
  return browseCategoryGroups(categories)
    .map((group) => ({
      id: group.category.id,
      name: group.category.name,
      categoryIds: [
        ...(group.directlySelectable ? [group.category.id] : []),
        ...group.children.map((category) => category.id),
      ],
    }))
    .filter((group) => group.categoryIds.length > 0);
}

export function filterHomeShowcaseItems(
  items: HomeShowcaseItem[],
  filter?: HomeCategoryFilter | null,
) {
  if (!filter) return items;
  const allowed = new Set(filter.categoryIds);
  return items.filter((item) => allowed.has(item.categoryId));
}
