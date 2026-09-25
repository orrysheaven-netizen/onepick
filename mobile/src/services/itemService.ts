import { AppError } from '@/errors/appError';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ItemRepository } from '@/repositories/interfaces/itemRepository';
import type { PickReadItem, ReadRepository } from '@/repositories/interfaces/readRepository';

/** One of my current picks in the item's category, for choosing which to replace. */
export type HeldPick = { pickId: string; itemId: string; itemName: string; position: number };

export type MyItemPickStatus =
  | { type: 'not_selected' }
  | { type: 'selected_this'; pickId: string; oneLineReview: string }
  // A single-pick category that already holds another item: saving replaces it.
  | { type: 'selected_other'; currentPickId: string; currentItemId: string }
  // A multi-pick category with a free slot: saving adds alongside the others.
  | { type: 'can_add'; heldCount: number; maxPicks: number }
  // A multi-pick category at its limit: the person picks which one to replace.
  | { type: 'category_full'; maxPicks: number; heldPicks: HeldPick[] };

export class ItemService {
  constructor(
    private readonly itemRepository: ItemRepository,
    private readonly pickRepository: PickRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly readRepository: ReadRepository,
  ) {}

  async getItemDetail(itemId: string, userId?: string, focusPickId?: string, prefetchedFocus?: PickReadItem) {
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

    const [category, heldPicks, picks, openCategories] = await Promise.all([
      cachedFocus?.category?.id === item.categoryId
        ? Promise.resolve(cachedFocus.category)
        : this.categoryRepository.getById(item.categoryId),
      userId ? this.pickRepository.getCurrentPicks(userId, item.categoryId) : Promise.resolve([]),
      picksPromise,
      openCategoriesPromise,
    ]);

    const currentPick = heldPicks.find((pick) => pick.itemId === item.id) ?? null;
    const maxPicks = category?.maxPicks ?? 1;
    let myPickStatus: MyItemPickStatus = { type: 'not_selected' };
    if (currentPick) {
      myPickStatus = { type: 'selected_this', pickId: currentPick.id, oneLineReview: currentPick.oneLineReview };
    } else if (heldPicks.length > 0 && maxPicks <= 1) {
      myPickStatus = {
        type: 'selected_other',
        currentPickId: heldPicks[0].id,
        currentItemId: heldPicks[0].itemId,
      };
    } else if (heldPicks.length > 0 && heldPicks.length < maxPicks) {
      myPickStatus = { type: 'can_add', heldCount: heldPicks.length, maxPicks };
    } else if (heldPicks.length > 0 && userId) {
      // Names come from the permission-checked read path; a hidden item keeps a
      // neutral label so the pick can still be chosen for replacement.
      const readable = await this.readRepository.getPicks({
        userId, categoryId: item.categoryId, statuses: ['active', 'needs_review'], limit: 10,
      });
      const names = new Map(readable.map((entry) => [entry.pick.id, entry.item?.name ?? null]));
      myPickStatus = {
        type: 'category_full',
        maxPicks,
        heldPicks: heldPicks.map((pick) => ({
          pickId: pick.id,
          itemId: pick.itemId,
          itemName: names.get(pick.id) ?? '지금은 볼 수 없는 항목',
          position: pick.position,
        })),
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
