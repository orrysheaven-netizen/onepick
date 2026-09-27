import type { Category } from '@/types/domain/category';

function categoryLineage(category: Category, categories: Category[]) {
  const byId = new Map(categories.map((item) => [item.id, item]));
  const lineage: Category[] = [];
  const seen = new Set<string>();
  let current: Category | undefined = category;

  while (current) {
    if (seen.has(current.id) || lineage.length >= 3) return [];
    seen.add(current.id);
    lineage.unshift(current);
    if (!current.parentId) break;
    current = byId.get(current.parentId);
    if (!current) return [];
  }

  return lineage[0]?.parentId ? [] : lineage;
}

function compareCategoryPaths(a: Category, b: Category, categories: Category[]) {
  const aPath = categoryLineage(a, categories);
  const bPath = categoryLineage(b, categories);
  const length = Math.max(aPath.length, bPath.length);
  for (let index = 0; index < length; index += 1) {
    const left = aPath[index];
    const right = bPath[index];
    if (!left) return -1;
    if (!right) return 1;
    const bySort = left.sortOrder - right.sortOrder;
    if (bySort) return bySort;
    const byName = left.name.localeCompare(right.name);
    if (byName) return byName;
  }
  return a.name.localeCompare(b.name);
}

export function selectableCategories(categories: Category[]) {
  const parentIds = new Set(categories.map((category) => category.parentId).filter(Boolean));
  return categories.filter((category) => {
    if (category.status !== 'open' || !category.isVisible || !category.isPickable || parentIds.has(category.id)) return false;

    const lineage = categoryLineage(category, categories);
    if (!lineage.length || lineage.length > 3) return false;

    return lineage.every((node, index) => {
      if (node.status !== 'open' || !node.isVisible) return false;
      return index === lineage.length - 1 ? node.isPickable : !node.isPickable;
    });
  });
}

/**
 * Categories that can take a new pickable child which is selectable right away:
 * open, visible, not pickable themselves, at most two levels deep, with an open,
 * visible, non-pickable lineage.
 */
export function newLeafParentCategories(categories: Category[]) {
  return categories.filter((category) => {
    const lineage = categoryLineage(category, categories);
    return lineage.length >= 1 && lineage.length <= 2
      && lineage.every((node) => node.status === 'open' && node.isVisible && !node.isPickable);
  });
}

/** Slug of the top-level group a category sits under (e.g. 'food'), or null when its lineage is broken. */
export function categoryRootSlug(category: Category, categories: Category[]) {
  return categoryLineage(category, categories)[0]?.slug ?? null;
}

export function categoryLabel(category: Category, categories: Category[]) {
  const lineage = categoryLineage(category, categories);
  return lineage.length ? lineage.map((item) => item.name).join(' › ') : category.name;
}

export function browseCategoryGroups(categories: Category[]) {
  const available = selectableCategories(categories);
  return categories
    .filter((category) => !category.parentId && category.status === 'open' && category.isVisible)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((category) => ({
      category,
      children: available
        .filter((leaf) => leaf.id !== category.id && categoryLineage(leaf, categories)[0]?.id === category.id)
        .sort((a, b) => compareCategoryPaths(a, b, categories)),
      directlySelectable: available.some((leaf) => leaf.id === category.id),
    }));
}


export function categoryPath(category: Category, categories: Category[]) {
  const parent = category.parentId ? categories.find((item) => item.id === category.parentId) ?? null : null;
  return {
    parent,
    label: parent ? `${parent.name} › ${category.name}` : category.name,
  };
}

export function selectionCategoryGroups(categories: Category[], selectable: Category[]) {
  const allowed = new Set(selectable.map((category) => category.id));
  const groups = browseCategoryGroups(categories)
    .map((group) => ({
      ...group,
      directlySelectable: group.directlySelectable && allowed.has(group.category.id),
      children: group.children.filter((child) => allowed.has(child.id)),
    }))
    .filter((group) => group.directlySelectable || group.children.length > 0);

  if (groups.length || !selectable.length) return groups;

  return [...selectable]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((category) => ({ category, children: [], directlySelectable: true }));
}
