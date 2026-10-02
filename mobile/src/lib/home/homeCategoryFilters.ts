import { browseCategoryGroups } from '@/lib/categories/categoryTree';
import type { Category } from '@/types/domain/category';

/**
 * MVP Home launches with restaurants only. Other top-level groups (culture, tech,
 * style, living) stay in the catalog, Explore and registration; Home just hides
 * their entry points. Add a root slug here to bring its Home buttons back.
 */
export const HOME_ROOT_SLUGS: readonly string[] = ['food'];

/** The people feed is filtered on the server by one root; null (several roots) keeps every Pick. */
export const HOME_FEED_ROOT_SLUG: string | null = HOME_ROOT_SLUGS.length === 1 ? HOME_ROOT_SLUGS[0] : null;

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

export interface HomeMenuRankingGroup {
  id: string;
  name: string;
}

/** Second-level food groups used by the Home recent-menu ranking chips. */
export function homeMenuRankingGroups(categories: Category[], rootSlug: string = HOME_FEED_ROOT_SLUG ?? 'food'): HomeMenuRankingGroup[] {
  const root = categories.find((category) => !category.parentId && category.slug === rootSlug
    && category.status === 'open' && category.isVisible);
  if (!root) return [];
  const byId = new Map(categories.map((category) => [category.id, category]));
  const hasPickableDescendant = (groupId: string) => categories.some((category) => {
    if (category.status !== 'open' || !category.isVisible || !category.isPickable) return false;
    if (category.parentId === groupId) return true;
    const parent = category.parentId ? byId.get(category.parentId) : null;
    return parent?.parentId === groupId;
  });
  return categories
    .filter((category) => category.parentId === root.id && category.status === 'open' && category.isVisible && !category.isPickable)
    .filter((category) => hasPickableDescendant(category.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((category) => ({ id: category.id, name: category.name }));
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

/** Every pickable menu under the MVP roots, in tree order (registration's "어떤 메뉴인가요?"). */
export function homeMenuCategories(categories: Category[], rootSlugs: readonly string[] = HOME_ROOT_SLUGS): Category[] {
  return homeGroups(categories, rootSlugs).flatMap((group) => group.children);
}

// Restaurant menus people look for first. Missing slugs are skipped and the list is
// topped up with one menu per food sub-group.
export const MENU_SUGGESTION_SLUGS: readonly string[] = [
  'pork-gukbap', 'pyeongyang-naengmyeon', 'doganitang', 'malatang', 'kalguksu', 'dakgalbi', 'sushi', 'fried-chicken',
];

/** "자주 찾는 메뉴" for registration: curated restaurant menus first, then one per sub-group. */
export function homeMenuSuggestions(categories: Category[], limit = 8): Category[] {
  const menus = homeMenuCategories(categories);
  const curated = MENU_SUGGESTION_SLUGS
    .map((slug) => menus.find((menu) => menu.slug === slug))
    .filter((menu): menu is Category => Boolean(menu));
  const rest = homeStarterCategories(categories, limit).filter((menu) => !curated.some((picked) => picked.id === menu.id));
  return [...curated, ...rest].slice(0, limit);
}

/** Menu search by name or slug, ignoring spaces and case (e.g. "돼지 국밥" → 돼지국밥). */
export function searchMenuCategories(menus: Category[], query: string, limit = 12): Category[] {
  const needle = query.toLowerCase().replace(/\s+/g, '');
  if (!needle) return [];
  return menus.filter((menu) => `${menu.name}${menu.slug}`.toLowerCase().replace(/\s+/g, '').includes(needle)).slice(0, limit);
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
