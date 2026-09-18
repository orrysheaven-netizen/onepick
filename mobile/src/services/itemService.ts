import { AppError } from '@/errors/appError';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ItemRepository } from '@/repositories/interfaces/itemRepository';
import type { ReadRepository } from '@/repositories/interfaces/readRepository';

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

  async getItemDetail(itemId: string, userId?: string, focusPickId?: string) {
    const item = await this.itemRepository.getById(itemId);
    if (!item) throw new AppError('ITEM_NOT_FOUND');

    const [category, currentPick, picks, openCategories] = await Promise.all([
      this.categoryRepository.getById(item.categoryId),
      userId ? this.pickRepository.getCurrentPick(userId, item.categoryId) : Promise.resolve(null),
      this.readRepository.getPicks({ itemId, excludeUserId: userId, statuses: ['active'], limit: 20 }),
      this.categoryRepository.getOpenCategories(),
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
      const focused = await this.readRepository.getPickById(focusPickId);
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

  async search(query: string, categoryId?: string, signal?: AbortSignal) {
    const searchText = query.trim();
    if (!searchText) return [];
    // search_items already checks public item status, selectable leaf categories
    // AND their parents before ranking/limit. Do not pay for the same category
    // read on every keystroke. The existing RPC and its visibility rules stay unchanged.
    return this.itemRepository.search({ query: searchText, categoryId, limit: 20, signal });
  }
}
