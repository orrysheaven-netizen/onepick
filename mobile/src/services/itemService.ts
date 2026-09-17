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

  async getItemDetail(itemId: string, userId?: string) {
    const item = await this.itemRepository.getById(itemId);
    if (!item) throw new AppError('ITEM_NOT_FOUND');

    const [category, currentPick, picks, openCategories] = await Promise.all([
      this.categoryRepository.getById(item.categoryId),
      userId ? this.pickRepository.getCurrentPick(userId, item.categoryId) : Promise.resolve(null),
      this.readRepository.getPicks({ itemId, statuses: ['active'], limit: 20 }),
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

    const canChoose = Boolean(
      openCategories.some((category) => category.id === item.categoryId) &&
      (item.status === 'active' || item.status === 'discontinued'),
    );

    return {
      item,
      category,
      myPickStatus,
      picks: picks.map((item) => ({ pick: item.pick, profile: item.profile })),
      canChoose,
    };
  }

  async search(query: string, categoryId?: string) {
    const categories = await this.categoryRepository.getOpenCategories();
    const ids = categories.filter((item) => !categoryId || item.id === categoryId).map((item) => item.id);
    if (!ids.length || !query.trim()) return [];
    return this.itemRepository.search({ query, categoryId, categoryIds: ids, limit: 20 });
  }
}
