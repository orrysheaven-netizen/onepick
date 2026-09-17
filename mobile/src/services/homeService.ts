import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { ItemRepository } from '@/repositories/interfaces/itemRepository';
import type { ReadRepository } from '@/repositories/interfaces/readRepository';

export type HomeMode = 'single_category' | 'multi_category';

export class HomeService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly itemRepository: ItemRepository,
    private readonly readRepository: ReadRepository,
  ) {}

  async getHomeData(userId?: string) {
    const openCategories = await this.categoryRepository.getOpenCategories();
    const mode: HomeMode = openCategories.length <= 1 ? 'single_category' : 'multi_category';
    const singleCategory = mode === 'single_category' ? openCategories[0] : undefined;

    const [currentPicks, feed, singleCategoryItems] = await Promise.all([
      userId
        ? this.readRepository.getPicks({
            userId,
            statuses: ['active', 'needs_review'],
            orderBy: 'updated_at',
            limit: 100,
          })
        : Promise.resolve([]),
      this.readRepository.getPicks({
        statuses: ['active'],
        orderBy: 'started_at',
        limit: 20,
      }),
      singleCategory && !userId
        ? this.itemRepository.getByCategory(singleCategory.id)
        : Promise.resolve([]),
    ]);

    const selectedCategoryIds = new Set(currentPicks.map((item) => item.pick.categoryId));
    const categoriesToPick = userId
      ? openCategories
          .filter((category) => !selectedCategoryIds.has(category.id))
          .map((category) => ({ category }))
      : [];

    return {
      mode,
      openCategories,
      singleCategory: singleCategory ?? null,
      singleCategoryItems,
      myRecentPicks: currentPicks.slice(0, 3).map((item) => item.pick),
      recentPicks: feed.map((item) => item.pick),
      currentPicks,
      categoriesToPick,
      feed,
    };
  }
}
