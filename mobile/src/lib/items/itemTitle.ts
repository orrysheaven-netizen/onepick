/**
 * A restaurant item is a place, so its title names the menu too: 중앙해장 + 내장탕
 * reads "중앙해장 내장탕". Names that already end with the menu are left alone.
 */
export function itemTitle(itemName: string, categoryName: string | null | undefined, isRestaurant: boolean) {
  const name = itemName.trim();
  const menu = categoryName?.trim();
  if (!isRestaurant || !menu || name.replace(/\s+/g, '').endsWith(menu.replace(/\s+/g, ''))) return name;
  return `${name} ${menu}`;
}
