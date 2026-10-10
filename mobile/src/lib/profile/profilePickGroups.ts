import type { PickChannel, PickReadItem } from '@/repositories/interfaces/readRepository';
import type { Category } from '@/types/domain/category';

export interface ProfilePickGroup {
  id: string;
  name: string;
  sortOrder: number;
  items: PickReadItem[];
  /** 'channel' = a FOOD lane (오프라인 맛집 / 온라인 맛집 / 레시피), not a catalog parent. */
  kind?: 'category' | 'channel';
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
    .map((group) => ({ ...group, items: sortGroupItems(group.items) }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function sortGroupItems(items: PickReadItem[]) {
  return [...items].sort((a, b) => {
    const aSort = a.category?.sortOrder ?? FALLBACK_SORT;
    const bSort = b.category?.sortOrder ?? FALLBACK_SORT;
    if (aSort !== bSort) return aSort - bSort;
    const nameDiff = (a.category?.name ?? '').localeCompare(b.category?.name ?? '');
    if (nameDiff !== 0) return nameDiff;
    return b.pick.updatedAt.localeCompare(a.pick.updatedAt);
  });
}

export type FoodLane = 'offline' | 'online' | 'recipe';

const FOOD_LANES: { code: FoodLane; label: string }[] = [
  { code: 'offline', label: '오프라인 맛집' },
  { code: 'online', label: '온라인 맛집' },
  { code: 'recipe', label: '레시피' },
];

const RECIPE_CATEGORY_SLUG = 'recipe';

/**
 * A food Pick carries its channel. Older reads without one fall back to the 레시피
 * category and the item's sales channel. An item sold both ways
 * counts once, as 오프라인 (Home treats delivery as 매장 too). Legacy items without a
 * channel (packaged food, drinks) are bought at a mart or online, so they count as 온라인.
 */
export function resolveFoodLane(item: PickReadItem, categories: Category[]): FoodLane {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const seen = new Set<string>();
  let current = categoryById.get(item.pick.categoryId) ?? item.category ?? undefined;
  while (current && !seen.has(current.id)) {
    if (current.slug === RECIPE_CATEGORY_SLUG) return 'recipe';
    seen.add(current.id);
    current = current.parentId ? categoryById.get(current.parentId) : undefined;
  }
  if (item.pick.channel) return item.pick.channel;
  return item.item?.channels?.includes('offline') ? 'offline' : 'online';
}

/** FOOD lanes in fixed order; empty lanes are left out. */
export function buildFoodLaneGroups(picks: PickReadItem[], categories: Category[]): ProfilePickGroup[] {
  return FOOD_LANES.map((lane, index) => ({
    id: lane.code,
    name: lane.label,
    sortOrder: index,
    kind: 'channel' as const,
    items: sortGroupItems(picks.filter((item) => resolveFoodLane(item, categories) === lane.code)),
  })).filter((group) => group.items.length > 0);
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

/** Splits Picks into FOOD / CULTURE & ART / … sections; FOOD holds channel lanes, the rest category groups; unmapped Picks land in a trailing 기타 section. */
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
    const groups = theme.code === 'food' ? buildFoodLaneGroups(themePicks, categories) : buildProfilePickGroups(themePicks, categories);
    return { ...theme, pickCount: themePicks.length, groups };
  });
}

export function defaultCollapsedProfilePickGroups(groups: ProfilePickGroup[], totalPickCount: number) {
  if (totalPickCount <= 6) return new Set<string>();
  return new Set(groups.slice(2).map((group) => group.id));
}

/** A theme other than the main one goes to 실험실; unmapped (기타) Picks stay on the main profile. */
export function isLabTheme(code: string, mainThemeCode: string) {
  return code !== mainThemeCode && code !== OTHER_PROFILE_THEME;
}

/** Splits Picks for the main profile and 실험실. With the lab off, everything stays main. */
export function splitLabPicks(picks: PickReadItem[], categories: Category[], mainThemeCode: string, labEnabled: boolean) {
  if (!labEnabled) return { main: picks, lab: [] as PickReadItem[] };
  const main: PickReadItem[] = [];
  const lab: PickReadItem[] = [];
  for (const item of picks) {
    (isLabTheme(resolveCategoryTheme(item.pick.categoryId, categories), mainThemeCode) ? lab : main).push(item);
  }
  return { main, lab };
}

export function filterMainProfileByChannel(
  picks: PickReadItem[],
  categories: Category[],
  mainThemeCode: string,
  publicChannel: PickChannel,
) {
  if (mainThemeCode !== 'food') return picks;
  return picks.filter((item) => {
    // Explicit food channels are authoritative even before the category catalog
    // finishes loading, so online/recipe Picks never flash on the public FOOD tab.
    if (item.pick.channel && item.pick.channel !== publicChannel) return false;
    const theme = resolveCategoryTheme(item.pick.categoryId, categories);
    // Unmapped/legacy Picks stay visible; only FOOD is narrowed by the MVP channel.
    return theme !== mainThemeCode || resolveFoodLane(item, categories) === publicChannel;
  });
}

/**
 * Early-MVP profile eligibility (#879 comment 6097734198, #757): one predicate for the
 * profile list and its 원픽 N count, mirroring the server contract.
 *
 * - Food tree: some ancestor (the category itself, its parent, …) has slug `rootSlug`,
 *   like `private.category_is_food`. Theme mapping is not used, so an unmapped or
 *   unknown category, or one whose chain cannot be resolved (catalog not loaded,
 *   missing parent), is excluded instead of passing by default.
 * - Recipes wait for a later stage: anything under the `recipe` category or picked
 *   under the `recipe` channel is excluded.
 * - Channel: an explicit channel must be in `channels`. A legacy Pick without one uses
 *   the `private.default_pick_channel` fallback (item channels, else online).
 */
export function isMvpProfilePick(
  item: PickReadItem,
  categories: Category[],
  rootSlug: string,
  channels: readonly PickChannel[],
) {
  if (item.pick.channel === 'recipe') return false;
  if (item.pick.channel && !channels.includes(item.pick.channel)) return false;
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const seen = new Set<string>();
  // A Pick's own category may be hidden from the browse catalog; its embedded row still counts.
  let current = categoryById.get(item.pick.categoryId) ?? item.category ?? undefined;
  let inRoot = false;
  while (current && !seen.has(current.id)) {
    if (current.slug === RECIPE_CATEGORY_SLUG) return false;
    if (current.slug === rootSlug) inRoot = true;
    seen.add(current.id);
    current = current.parentId ? categoryById.get(current.parentId) : undefined;
  }
  if (!inRoot) return false;
  return channels.includes(item.pick.channel ?? legacyPickChannel(item));
}

/** `private.default_pick_channel` order for a Pick stored before channels: offline, online, recipe, else online. */
function legacyPickChannel(item: PickReadItem): PickChannel {
  const itemChannels = item.item?.channels ?? [];
  return (['offline', 'online', 'recipe'] as const).find((channel) => itemChannels.includes(channel)) ?? 'online';
}

/**
 * Whether a current Pick is one a visitor sees on the public profile: active, with a
 * reviewed photo (the same rule as `ProfileService.getProfileByUsername`). My own
 * profile also lists Picks awaiting review and photo-less legacy Picks so I can manage
 * them, but what I share counts only these (#826 GPT review). A candidate photo laid
 * over my own Pick while it waits for review does not count.
 */
export function isPublicProfilePick(item: PickReadItem) {
  const photo = item.item;
  return item.pick.status === 'active'
    && !photo?.photoPendingReview
    && [photo?.imagePath, photo?.imageUrl, photo?.thumbnailUrl, photo?.imageSourceUrl]
      .some((value) => typeof value === 'string' && value.trim().length > 0);
}

export function filterMvpProfilePicks(
  picks: PickReadItem[],
  categories: Category[],
  rootSlug: string,
  channels: readonly PickChannel[],
) {
  return picks.filter((item) => isMvpProfilePick(item, categories, rootSlug, channels));
}

/** Whether a category belongs to 실험실 (used to keep lab categories out of onboarding and search). */
export function isLabCategory(categoryId: string, categories: Category[], mainThemeCode: string, labEnabled: boolean) {
  return labEnabled && isLabTheme(resolveCategoryTheme(categoryId, categories), mainThemeCode);
}
