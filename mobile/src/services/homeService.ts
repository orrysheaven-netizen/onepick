import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { ItemRepository } from '@/repositories/interfaces/itemRepository';
import type { ReadCursor, ReadRepository } from '@/repositories/interfaces/readRepository';

export class HomeService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    _itemRepository: ItemRepository,
    private readonly readRepository: ReadRepository,
  ) {}

  async getHomeData(userId?: string, cursor: ReadCursor | null = null) {
    const openCategories = await this.categoryRepository.getOpenCategories();
    const [currentPicks, feed] = await Promise.all([
      userId
        ? this.readRepository.getPicks({
            userId,
            statuses: ['active', 'needs_review'],
            orderBy: 'updated_at',
            limit: 100,
          })
        : Promise.resolve([]),
      this.readRepository.getHomePicks(cursor),
    ]);
    const selectedCategoryIds = new Set(currentPicks.map((entry) => entry.pick.categoryId));
    const publicCategoryIds = new Set(openCategories.map((category) => category.id));
    return {
      openCategories,
      currentPicks,
      categoriesToPick: userId
        ? openCategories.filter((category) => !selectedCategoryIds.has(category.id)).map((category) => ({ category }))
        : [],
      // Defence in depth for stale category metadata/account transitions. The RPC
      // applies all current visibility rules BEFORE pagination and excludes self.
      featuredPicks: feed.items.filter((entry) => entry.userId !== userId && publicCategoryIds.has(entry.categoryId)),
      nextCursor: feed.nextCursor,
    };
  }
}
