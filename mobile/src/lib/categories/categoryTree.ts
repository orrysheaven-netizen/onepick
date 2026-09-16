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
