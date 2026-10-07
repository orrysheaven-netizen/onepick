type RecordValue = Record<string, unknown>;

export const MVP_PUBLIC_PICK_CHANNEL = 'offline';
export const MVP_MAIN_THEME = 'food';

function rows(value: unknown): RecordValue[] {
  if (Array.isArray(value)) return value.filter((entry): entry is RecordValue => Boolean(entry) && typeof entry === 'object');
  return value && typeof value === 'object' ? [value as RecordValue] : [];
}

export function primaryThemeCode(category: RecordValue | null | undefined) {
  const themes = rows(category?.category_taste_dimensions);
  const primary = themes.find((theme) => theme.is_primary === true);
  return typeof primary?.dimension_code === 'string' ? primary.dimension_code : null;
}

export function itemChannels(item: RecordValue | null | undefined) {
  return rows(item?.item_channels)
    .map((entry) => entry.channel)
    .filter((channel): channel is string => typeof channel === 'string');
}

function foodItemHasPublicChannel(item: RecordValue | null | undefined) {
  return itemChannels(item).includes(MVP_PUBLIC_PICK_CHANNEL) || item?.external_source === 'onepick_place';
}

function itemHasPublicPhoto(item: RecordValue | null | undefined) {
  return [item?.thumbnail_path, item?.image_path, item?.image_source_url]
    .some((value) => typeof value === 'string' && value.trim().length > 0);
}

/** Direct Pick links keep non-food Picks, but FOOD is limited to the public channel. */
export function isMvpPublicPick(
  pick: RecordValue,
  category: RecordValue | null | undefined,
  item: RecordValue | null | undefined,
) {
  if (!itemHasPublicPhoto(item)) return false;
  const channel = typeof pick.channel === 'string' ? pick.channel : null;
  if (channel && channel !== MVP_PUBLIC_PICK_CHANNEL) return false;
  if (primaryThemeCode(category) !== MVP_MAIN_THEME) return true;
  return channel === MVP_PUBLIC_PICK_CHANNEL || (!channel && foodItemHasPublicChannel(item));
}

/** Profile cards mirror the app's main profile: FOOD + unmapped legacy, not lab themes. */
export function isMvpProfilePick(
  pick: RecordValue,
  category: RecordValue | null | undefined,
  item: RecordValue | null | undefined,
) {
  if (!itemHasPublicPhoto(item)) return false;
  const channel = typeof pick.channel === 'string' ? pick.channel : null;
  if (channel && channel !== MVP_PUBLIC_PICK_CHANNEL) return false;
  const theme = primaryThemeCode(category);
  if (theme && theme !== MVP_MAIN_THEME) return false;
  if (theme === MVP_MAIN_THEME) return channel === MVP_PUBLIC_PICK_CHANNEL || (!channel && foodItemHasPublicChannel(item));
  return true;
}

/** Item links remain available outside FOOD; FOOD needs an offline-capable item or a public offline Pick. */
export function isMvpPublicItem(
  category: RecordValue | null | undefined,
  item: RecordValue,
  hasPublicOfflinePick = false,
) {
  return primaryThemeCode(category) !== MVP_MAIN_THEME
    || foodItemHasPublicChannel(item)
    || hasPublicOfflinePick;
}
