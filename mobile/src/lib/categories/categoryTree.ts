import type { Category } from '@/types/domain/category';

export function selectableCategories(categories: Category[]) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const parents = new Set(categories.map((category) => category.parentId).filter(Boolean));
  return categories.filter((category) => {
    if (category.status !== 'open' || !category.isVisible || !category.isPickable || parents.has(category.id)) return false;
    if (!category.parentId) return true;
    const parent = byId.get(category.parentId);
    return Boolean(parent && !parent.parentId && parent.status === 'open' && parent.isVisible && !parent.isPickable);
  });
}

export function categoryLabel(category: Category, categories: Category[]) {
  const parent = categories.find((item) => item.id === category.parentId);
  return parent ? `${parent.name} › ${category.name}` : category.name;
}

export function browseCategoryGroups(categories: Category[]) {
  const available = selectableCategories(categories);
  return categories.filter((category) => !category.parentId && category.status === 'open' && category.isVisible)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((category) => ({ category, children: available.filter((child) => child.parentId === category.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    directlySelectable: available.some((leaf) => leaf.id === category.id) }));
}
