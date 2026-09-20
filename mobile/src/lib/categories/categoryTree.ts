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
