import { browseCategoryGroups } from '@/lib/categories/categoryTree';
import type { Category } from '@/types/domain/category';

export interface BrowseScope {
  /** Show top-level/child category chips. */
  showChips: boolean;
  /** Leaf category ids to browse; null means every open leaf. */
  leafIds: string[] | null;
}

/**
 * Home/Explore browsing scope. With chips on, everything is browsable and the
 * chips narrow it down. With chips off (MVP), only one top-level group is
 * browsed; if that group is missing, nothing is (never silently widen to all).
 */
export function browseScope(categories: Category[], options: { chips: boolean; groupSlug: string }): BrowseScope {
  if (options.chips) return { showChips: true, leafIds: null };
  const group = browseCategoryGroups(categories).find((entry) => entry.category.slug === options.groupSlug);
  if (!group) return { showChips: false, leafIds: [] };
  return {
    showChips: false,
    leafIds: [
      ...(group.directlySelectable ? [group.category.id] : []),
      ...group.children.map((category) => category.id),
    ],
  };
}
