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
    const [currentPicks, showcase] = await Promise.all([
      userId
        ? this.readRepository.getPicks({
            userId,
            statuses: ['active', 'needs_review'],
            orderBy: 'updated_at',
            limit: 100,
          })
        : Promise.resolve([]),
      this.readRepository.getHomeShowcase(cursor),
    ]);

    const selectedCategoryIds = new Set(currentPicks.map((item) => item.pick.categoryId));
    const categoriesToPick = userId
      ? openCategories
          .filter((category) => !selectedCategoryIds.has(category.id))
          .map((category) => ({ category }))
      : [];

    return {
      openCategories,
      currentPicks,
      categoriesToPick,
      featuredItems: showcase.items,
      minimumPickCount: showcase.minimumPickCount,
      nextCursor: showcase.nextCursor,
    };
  }
}
