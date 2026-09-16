import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { ReadRepository } from '@/repositories/interfaces/readRepository';

export class ExploreService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly readRepository: ReadRepository,
  ) {}

  async getExploreData(categoryId?: string) {
    const [openCategories, feed] = await Promise.all([
      this.categoryRepository.getOpenCategories(),
      this.readRepository.getPicks({ categoryId, statuses: ['active'], limit: 30 }),
    ]);

    const seenProductIds = new Set<string>();
    const recentProducts = feed
      .filter((item) => item.product && item.category)
      .filter((item) => {
        if (seenProductIds.has(item.pick.productId)) return false;
        seenProductIds.add(item.pick.productId);
        return true;
      })
      .map((item) => ({ product: item.product!, category: item.category! }))
      .slice(0, 8);

    return {
      openCategories,
      selectedCategoryId: categoryId ?? null,
      feed,
      recentProducts,
    };
  }
}
