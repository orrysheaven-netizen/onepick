import { browseCategoryGroups } from '@/lib/categories/categoryTree';
import type { Category } from '@/types/domain/category';

/**
 * MVP Home launches with restaurants only. Other top-level groups (culture, tech,
 * style, living) stay in the catalog, Explore and registration; Home just hides
 * their entry points. Add a root slug here to bring its Home buttons back.
 */
export const HOME_ROOT_SLUGS: readonly string[] = ['food'];

export interface HomeCategoryFilter {
  id: string;
  name: string;
  categoryIds: string[];
}

function homeGroups(categories: Category[], rootSlugs: readonly string[]) {
  return browseCategoryGroups(categories).filter((group) => rootSlugs.includes(group.category.slug));
}

export function buildHomeCategoryFilters(categories: Category[], rootSlugs: readonly string[] = HOME_ROOT_SLUGS): HomeCategoryFilter[] {
  return homeGroups(categories, rootSlugs)
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

/**
 * Signed-out starter cards: one leaf per sub-group (e.g. 고기, 면, 국/탕) in tree
 * order, so a large restaurant taxonomy shows variety instead of its first rows.
 */
export function homeStarterCategories(categories: Category[], limit = 6, rootSlugs: readonly string[] = HOME_ROOT_SLUGS): Category[] {
  const seenParents = new Set<string | null>();
  const starters: Category[] = [];
  for (const group of homeGroups(categories, rootSlugs)) {
    for (const leaf of group.children) {
      if (starters.length >= limit) return starters;
      if (seenParents.has(leaf.parentId)) continue;
      seenParents.add(leaf.parentId);
      starters.push(leaf);
    }
  }
  return starters;
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
