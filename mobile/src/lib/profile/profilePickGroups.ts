import type { PickReadItem } from '@/repositories/interfaces/readRepository';
import type { Category } from '@/types/domain/category';

export interface ProfilePickGroup {
  id: string;
  name: string;
  sortOrder: number;
  items: PickReadItem[];
}

const FALLBACK_SORT = Number.MAX_SAFE_INTEGER;

export function buildProfilePickGroups(picks: PickReadItem[], categories: Category[]): ProfilePickGroup[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const groups = new Map<string, ProfilePickGroup>();

  for (const item of picks) {
    const category = item.category;
    const parent = category?.parentId ? categoryById.get(category.parentId) ?? null : null;
    const groupId = parent?.id ?? category?.id ?? 'uncategorized';
    const groupName = parent?.name ?? category?.name ?? '기타';
    const groupSortOrder = parent?.sortOrder ?? category?.sortOrder ?? FALLBACK_SORT;

    const existing = groups.get(groupId);
    if (existing) existing.items.push(item);
    else groups.set(groupId, { id: groupId, name: groupName, sortOrder: groupSortOrder, items: [item] });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => {
        const aSort = a.category?.sortOrder ?? FALLBACK_SORT;
        const bSort = b.category?.sortOrder ?? FALLBACK_SORT;
        if (aSort !== bSort) return aSort - bSort;
        const nameDiff = (a.category?.name ?? '').localeCompare(b.category?.name ?? '');
        if (nameDiff !== 0) return nameDiff;
        return b.pick.updatedAt.localeCompare(a.pick.updatedAt);
      }),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export interface ProfileThemeSection {
  code: string;
  label: string;
  pickCount: number;
  groups: ProfilePickGroup[];
}

export const OTHER_PROFILE_THEME = 'other';

/** Display order and labels of the taste themes (`taste_dimensions.code`). */
const PROFILE_THEMES: { code: string; label: string }[] = [
  { code: 'food', label: 'FOOD' },
  { code: 'culture', label: 'CULTURE & ART' },
  { code: 'tech', label: 'TECH' },
  { code: 'style', label: 'STYLE' },
  { code: 'living', label: 'LIVING' },
];

/** A category's own theme, else the nearest ancestor's; new leaves under a mapped parent need no mapping of their own. */
export function resolveCategoryTheme(categoryId: string | null | undefined, categories: Category[]) {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const seen = new Set<string>();
  let current = categoryId ? categoryById.get(categoryId) : undefined;
  while (current && !seen.has(current.id)) {
    if (current.themeCode) return current.themeCode;
    seen.add(current.id);
    current = current.parentId ? categoryById.get(current.parentId) : undefined;
  }
  return OTHER_PROFILE_THEME;
}

/** Splits the category groups into FOOD / CULTURE & ART / … sections; unmapped Picks land in a trailing 기타 section. */
export function buildProfileThemeSections(picks: PickReadItem[], categories: Category[]): ProfileThemeSection[] {
  const picksByTheme = new Map<string, PickReadItem[]>();
  for (const item of picks) {
    const code = resolveCategoryTheme(item.pick.categoryId, categories);
    picksByTheme.set(code, [...(picksByTheme.get(code) ?? []), item]);
  }

  const known = PROFILE_THEMES.filter((theme) => picksByTheme.has(theme.code));
  // A theme added in the DB before the app knows its label still gets its own section.
  const unknown = [...picksByTheme.keys()]
    .filter((code) => code !== OTHER_PROFILE_THEME && !PROFILE_THEMES.some((theme) => theme.code === code))
    .sort()
    .map((code) => ({ code, label: code.toUpperCase() }));
  const other = picksByTheme.has(OTHER_PROFILE_THEME) ? [{ code: OTHER_PROFILE_THEME, label: '기타' }] : [];

  return [...known, ...unknown, ...other].map((theme) => {
    const themePicks = picksByTheme.get(theme.code) ?? [];
    return { ...theme, pickCount: themePicks.length, groups: buildProfilePickGroups(themePicks, categories) };
  });
}

export function defaultCollapsedProfilePickGroups(groups: ProfilePickGroup[], totalPickCount: number) {
  if (totalPickCount <= 6) return new Set<string>();
  return new Set(groups.slice(2).map((group) => group.id));
}

/** Pickable leaves in a top-level group that have no current Pick yet (the owner's dashed "remaining" tile). */
export function remainingProfileCategories(groupId: string, pickedCategoryIds: Set<string>, categories: Category[]) {
  return categories
    .filter((category) => category.isPickable && category.status === 'open' && category.isVisible)
    .filter((category) => (category.parentId ?? category.id) === groupId)
    .filter((category) => !pickedCategoryIds.has(category.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}
