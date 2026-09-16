import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ProductRepository } from '@/repositories/interfaces/productRepository';

export type HomeMode = 'single_category' | 'multi_category';

export class HomeService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly pickRepository: PickRepository,
    private readonly productRepository: ProductRepository,
  ) {}

  async getHomeData(userId?: string) {
    const openCategories = await this.categoryRepository.getOpenCategories();
    const mode: HomeMode =
      openCategories.length <= 1 ? 'single_category' : 'multi_category';
    const singleCategory = mode === 'single_category' ? openCategories[0] : undefined;

    const [myPicks, recentPicks, singleCategoryProducts] = await Promise.all([
      userId
        ? this.pickRepository.getActivePicksByUser(userId)
        : Promise.resolve([]),
      this.pickRepository.getRecentPicks({ limit: 20 }),
      singleCategory
        ? this.productRepository.getByCategory(singleCategory.id)
        : Promise.resolve([]),
    ]);

    return {
      mode,
      openCategories,
      singleCategory: singleCategory ?? null,
      singleCategoryProducts,
      myRecentPicks: myPicks.slice(0, 3),
      recentPicks,
    };
  }
}
