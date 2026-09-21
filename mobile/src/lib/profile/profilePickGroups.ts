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
