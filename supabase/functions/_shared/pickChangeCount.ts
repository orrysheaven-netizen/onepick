/** One pick reduced to what the AI re-analysis gate compares. */
export type PickSignature = { categoryKey: string; itemKey: string; review: string };

/**
 * Counts taste changes between two pick snapshots, category by category.
 *
 * A category may hold several picks (culture categories allow up to five), so
 * picks are matched by item inside their category rather than one per category:
 * - an edited review on a kept item is one change;
 * - swapping one item for another is one change, not an add plus a remove;
 * - adding or removing without a counterpart is one change each.
 * For a one-pick category this gives the same count as the old per-category
 * comparison. Reordering picks is not a change.
 */
export function countPickChanges(previous: readonly PickSignature[], current: readonly PickSignature[]): number {
  const group = (rows: readonly PickSignature[]) => {
    const byCategory = new Map<string, Map<string, string>>();
    for (const row of rows) {
      if (!row.categoryKey) continue;
      const items = byCategory.get(row.categoryKey) ?? new Map<string, string>();
      items.set(row.itemKey, row.review);
      byCategory.set(row.categoryKey, items);
    }
    return byCategory;
  };

  const before = group(previous);
  const after = group(current);
  let changed = 0;
  for (const categoryKey of new Set([...before.keys(), ...after.keys()])) {
    const oldItems = before.get(categoryKey) ?? new Map<string, string>();
    const newItems = after.get(categoryKey) ?? new Map<string, string>();
    let added = 0;
    let removed = 0;
    for (const [itemKey, review] of newItems) {
      if (!oldItems.has(itemKey)) added += 1;
      else if (oldItems.get(itemKey) !== review) changed += 1;
    }
    for (const itemKey of oldItems.keys()) if (!newItems.has(itemKey)) removed += 1;
    changed += Math.max(added, removed);
  }
  return changed;
}
