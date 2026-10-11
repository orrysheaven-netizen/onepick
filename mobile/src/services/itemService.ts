import { AppError } from '@/errors/appError';
import type { PickChannel } from '@/lib/items/pickChannel';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ItemRepository } from '@/repositories/interfaces/itemRepository';
import type { PickReadItem, ReadRepository } from '@/repositories/interfaces/readRepository';

const FOOD_ROOT_SLUG = 'food';

/** Food Picks are per channel; the category or one of its ancestors is 먹을것. */
function isFoodCategory(
  categoryId: string | null | undefined,
  categories: readonly { id: string; parentId: string | null; slug: string }[],
) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const seen = new Set<string>();
  let current = categoryId ? byId.get(categoryId) : undefined;
  while (current && !seen.has(current.id)) {
    if (current.slug === FOOD_ROOT_SLUG) return true;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}

/**
 * The channel an item is picked under when the member has not chosen one; mirrors
 * private.default_pick_channel: its representative channel, a video as 레시피,
 * otherwise 온라인 for a packaged product.
 */
function defaultPickChannel(item: { channels?: readonly PickChannel[]; externalSource?: string | null }): PickChannel {
  return item.channels?.[0] ?? (item.externalSource === 'youtube_video' ? 'recipe' : 'online');
}

export type MyItemPickStatus =
  | { type: 'not_selected' }
  | { type: 'selected_this'; pickId: string; oneLineReview: string }
  | { type: 'selected_other'; currentPickId: string; currentItemId: string };

export class ItemService {
  constructor(
    private readonly itemRepository: ItemRepository,
    private readonly pickRepository: PickRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly readRepository: ReadRepository,
  ) {}

  async getItemDetail(
    itemId: string,
    userId?: string,
    focusPickId?: string,
    prefetchedFocus?: PickReadItem,
    channel?: PickChannel,
    options?: { includeProvider?: boolean },
  ) {
    const cachedFocus = prefetchedFocus
      && prefetchedFocus.pick.id === focusPickId
      && prefetchedFocus.item?.id === itemId
      ? prefetchedFocus
      : undefined;
    // Shared links already fetched the focused Pick. Reuse that item/category when
    // available, and start independent list/category reads while the item resolves.
    // A cached focus item comes from the pick read, which already carries providerId.
    const itemPromise = cachedFocus?.item
      ? Promise.resolve(cachedFocus.item)
      : this.itemRepository.getById(itemId, options?.includeProvider ? { includeProvider: true } : undefined);
    const usesItemReviewPage = typeof this.readRepository.getItemReviews === 'function';
    const picksPromise = usesItemReviewPage
      ? this.readRepository.getItemReviews!(itemId, 20)
      : this.readRepository.getPicks({ itemId, excludeUserId: userId, statuses: ['active'], limit: 20 });
    const openCategoriesPromise = this.categoryRepository.getOpenCategories();
    const brandPromise = this.readRepository.getItemBrand?.(itemId).catch(() => null) ?? Promise.resolve(null);
    const item = await itemPromise;
    if (!item) throw new AppError('ITEM_NOT_FOUND');

    const [category, currentPicks, picks, openCategories, brand] = await Promise.all([
      cachedFocus?.category?.id === item.categoryId
        ? Promise.resolve(cachedFocus.category)
        : this.categoryRepository.getById(item.categoryId),
      userId ? this.pickRepository.getCurrentPicksInCategory(userId, item.categoryId) : Promise.resolve([]),
      picksPromise,
      openCategoriesPromise,
      brandPromise,
    ]);

    // A food menu holds one Pick per channel. An explicitly chosen route
    // channel must win: opening the same item through another channel must not
    // silently edit the Pick stored in its old channel. Without an explicit
    // channel, an existing Pick of this item keeps its stored channel.
    const ownItemPick = currentPicks.find((pick) => pick.itemId === item.id) ?? null;
    const foodCategory = isFoodCategory(item.categoryId, openCategories);
    const pickChannel = foodCategory
      ? channel ?? ownItemPick?.channel ?? defaultPickChannel(item)
      : null;
    const currentPick = foodCategory
      ? currentPicks.find((pick) => (pick.channel ?? null) === pickChannel) ?? null
      : ownItemPick ?? currentPicks[0] ?? null;

    let myPickStatus: MyItemPickStatus = { type: 'not_selected' };
    if (currentPick?.itemId === item.id) {
      myPickStatus = { type: 'selected_this', pickId: currentPick.id, oneLineReview: currentPick.oneLineReview };
    } else if (currentPick) {
      myPickStatus = {
        type: 'selected_other',
        currentPickId: currentPick.id,
        currentItemId: currentPick.itemId,
      };
    }

    // item_review_page is the source of truth for both current and ended reviews.
    // It deliberately hides lifecycle details and supplies viewer-scoped permissions.
    let ownReview = userId && usesItemReviewPage
      ? picks.filter((entry) => entry.pick.userId === userId)
          .map((entry) => ({ pick: entry.pick, profile: entry.profile, isMine: true }))
      : [];
    // Compatibility for older adapters/test doubles that do not implement
    // item_review_page yet: keep the previous contract by fetching only the
    // viewer's current Pick for this item. Ended reviews are supplied only by
    // item_review_page, which is the production source of truth.
    if (userId && !usesItemReviewPage && currentPick?.itemId === item.id) {
      const legacyOwn = await this.readRepository.getPickById(currentPick.id);
      ownReview = legacyOwn && legacyOwn.pick.itemId === item.id && legacyOwn.pick.status !== 'hidden'
        ? [{ pick: legacyOwn.pick, profile: legacyOwn.profile, isMine: true }]
        : [];
    }
    const ownIds = new Set(ownReview.map(({ pick }) => pick.id));
    const otherReviews = picks
      .filter((entry) => entry.pick.userId !== userId && !ownIds.has(entry.pick.id))
      .map((entry) => ({ pick: entry.pick, profile: entry.profile, isMine: false }));

    const reviews = [...ownReview, ...otherReviews];
    // Shared links can reference a review beyond the first page or an ended choice.
    // Read through the same permission-checked repository and verify its product.
    if (focusPickId && !reviews.some(({ pick }) => pick.id === focusPickId)) {
      const focused = cachedFocus ?? await this.readRepository.getPickById(focusPickId);
      if (focused && focused.pick.itemId === item.id && focused.pick.status !== 'hidden') {
        reviews.splice(ownReview.length, 0, {
          pick: focused.pick, profile: focused.profile, isMine: focused.pick.userId === userId,
        });
      }
    }
    // Product detail is not a history screen. Keep current reviews ahead of ended
    // reviews while preserving the existing order inside each group.
    reviews.sort((a, b) => {
      const aCurrent = a.pick.isCurrent ?? (a.pick.status === 'active' || a.pick.status === 'needs_review');
      const bCurrent = b.pick.isCurrent ?? (b.pick.status === 'active' || b.pick.status === 'needs_review');
      return Number(bCurrent) - Number(aCurrent);
    });

    const canChoose = Boolean(
      openCategories.some((category) => category.id === item.categoryId) &&
      (item.status === 'active' || item.status === 'discontinued'),
    );

    return {
      item,
      category,
      /** The item's brand and logo, or null when it has none. */
      brand,
      // Restaurants live under the 'food' root; their detail title names the menu (lib/items/itemTitle).
      isRestaurant: openCategories.some((category) => category.id === item.categoryId && category.rootSlug === 'food'),
      myPickStatus,
      /** The channel a Pick of this item is saved under (its own Pick's channel once picked); null outside food. */
      pickChannel: currentPick?.itemId === item.id ? currentPick.channel : pickChannel,
      picks: reviews,
      focusAvailable: !focusPickId || reviews.some(({ pick }) => pick.id === focusPickId),
      canChoose,
    };
  }

  /** Only a query that could name a dish reaches the server; anything shorter is plain search. */
  getDishChannelOverview(query: string) {
    const searchText = query.trim().replace(/\s+/g, ' ');
    return searchText.replace(/\s/g, '').length >= 2
      ? this.readRepository.getDishChannelOverview(searchText)
      : Promise.resolve(null);
  }

  getSearchItemMeta(itemIds: string[]) {
    return this.readRepository.getSearchItemMeta(itemIds);
  }

  getPickCount(itemId: string) {
    return this.readRepository.countActivePicks(itemId);
  }

  async search(query: string, categoryId?: string, signal?: AbortSignal, categoryIds?: string[]) {
    const searchText = query.trim();
    if (!searchText || categoryIds?.length === 0) return [];
    // search_items already checks public item status, selectable leaf categories
    // AND their parents before ranking/limit. A category set lets the registration
    // entry search ordinary products without mixing in content catalogs.
    return this.itemRepository.search({
      query: searchText,
      ...(categoryIds ? { categoryIds } : categoryId ? { categoryId } : {}),
      limit: 20,
      signal,
    });
  }
}
