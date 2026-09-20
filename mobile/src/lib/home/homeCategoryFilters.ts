import { browseCategoryGroups } from '@/lib/categories/categoryTree';
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

/** Keeps feed rows (Picks, showcase items — anything with a categoryId) inside one top-level group. */
export function filterHomeFeedByCategory<T extends { categoryId: string }>(
  items: T[],
  filter?: HomeCategoryFilter | null,
) {
  if (!filter) return items;
  const allowed = new Set(filter.categoryIds);
  return items.filter((item) => allowed.has(item.categoryId));
}
