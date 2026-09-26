function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown, maximum = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

/**
 * Count meaningful Pick changes by category, or by (category, channel) once the
 * stored snapshot itself contains channel information. This keeps snapshots
 * created before channel-specific food Picks backwards-compatible: adding the
 * migrated channel field alone is not treated as a user change.
 */
export function meaningfulPickChangeCount(previousValue: unknown, currentValue: unknown): number {
  const previous = Array.isArray(previousValue) ? previousValue.map(record) : [];
  const current = Array.isArray(currentValue) ? currentValue.map(record) : [];
  const perChannel = previous.some((row) => 'channel' in row);

  const signatureByCategory = (rows: Record<string, unknown>[]) => {
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const categoryId = text(row.categoryId, 36);
      const category = text(row.category);
      const categoryKey = categoryId || (category ? `name:${category}` : '');
      if (!categoryKey) continue;

      const channel = text(row.channel, 16);
      const key = perChannel ? `${categoryKey}|${channel}` : categoryKey;
      const itemId = text(row.itemId, 36);
      const item = text(row.item);
      const itemKey = itemId || (item ? `name:${item}` : '');
      const review = text(row.review, 100);
      const values = grouped.get(key) ?? [];
      values.push(JSON.stringify([itemKey, review]));
      grouped.set(key, values);
    }
    return new Map([...grouped].map(([key, values]) => [key, JSON.stringify(values.sort())]));
  };

  const before = signatureByCategory(previous);
  const after = signatureByCategory(current);
  const keys = new Set([...before.keys(), ...after.keys()]);
  let changed = 0;
  for (const key of keys) {
    if (before.get(key) !== after.get(key)) changed += 1;
  }
  return changed;
}
