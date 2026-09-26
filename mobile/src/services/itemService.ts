import { AppError } from '@/errors/appError';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ItemRepository } from '@/repositories/interfaces/itemRepository';
import type { PickReadItem, ReadRepository } from '@/repositories/interfaces/readRepository';

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

  async getItemDetail(itemId: string, userId?: string, focusPickId?: string, prefetchedFocus?: PickReadItem, pickChannel?: 'offline' | 'online' | 'recipe') {
    const cachedFocus = prefetchedFocus
      && prefetchedFocus.pick.id === focusPickId
      && prefetchedFocus.item?.id === itemId
      ? prefetchedFocus
      : undefined;
    // Shared links already fetched the focused Pick. Reuse that item/category when
    // available, and start independent list/category reads while the item resolves.
    const itemPromise = cachedFocus?.item ? Promise.resolve(cachedFocus.item) : this.itemRepository.getById(itemId);
    const picksPromise = this.readRepository.getPicks({ itemId, excludeUserId: userId, statuses: ['active'], limit: 20 });
    const openCategoriesPromise = this.categoryRepository.getOpenCategories();
    const item = await itemPromise;
    if (!item) throw new AppError('ITEM_NOT_FOUND');

    const [category, currentPick, picks, openCategories] = await Promise.all([
      cachedFocus?.category?.id === item.categoryId
        ? Promise.resolve(cachedFocus.category)
        : this.categoryRepository.getById(item.categoryId),
      userId ? this.pickRepository.getCurrentPick(userId, item.categoryId, pickChannel) : Promise.resolve(null),
      picksPromise,
      openCategoriesPromise,
    ]);

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

    // Fetch my current choice separately so it stays first even outside the latest page.
    const mine = userId && currentPick?.itemId === item.id
      ? await this.readRepository.getPickById(currentPick.id)
      : null;
    const ownReview = mine && mine.pick.userId === userId && mine.pick.itemId === item.id
      && mine.pick.id === currentPick?.id && ['active', 'needs_review'].includes(mine.pick.status)
      ? [{ pick: mine.pick, profile: mine.profile, isMine: true }]
      : [];
    const otherReviews = picks.filter((entry) => entry.pick.userId !== userId)
      .map((entry) => ({ pick: entry.pick, profile: entry.profile, isMine: false }));

    const reviews = [...ownReview, ...otherReviews];
    // Shared links can reference a review beyond the first page or a previous choice.
    // Read through the same permission-checked repository and verify its product.
    if (focusPickId && !reviews.some(({ pick }) => pick.id === focusPickId)) {
      const focused = cachedFocus ?? await this.readRepository.getPickById(focusPickId);
      if (focused && focused.pick.itemId === item.id && focused.pick.status !== 'hidden') {
        reviews.splice(ownReview.length, 0, {
          pick: focused.pick, profile: focused.profile, isMine: focused.pick.userId === userId,
        });
      }
    }

    const canChoose = Boolean(
      openCategories.some((category) => category.id === item.categoryId) &&
      (item.status === 'active' || item.status === 'discontinued'),
    );

    return {
      item,
      category,
      myPickStatus,
      picks: reviews,
      focusAvailable: !focusPickId || reviews.some(({ pick }) => pick.id === focusPickId),
      canChoose,
    };
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
