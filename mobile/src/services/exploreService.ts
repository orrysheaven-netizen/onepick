import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ProductRepository } from '@/repositories/interfaces/productRepository';
import type { ProfileRepository } from '@/repositories/interfaces/profileRepository';

export class ExploreService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly pickRepository: PickRepository,
    private readonly productRepository: ProductRepository,
    private readonly profileRepository: ProfileRepository,
  ) {}

  async getExploreData(categoryId?: string) {
    const [openCategories, recentPicks] = await Promise.all([
      this.categoryRepository.getOpenCategories(),
      this.pickRepository.getRecentPicks({ categoryId, limit: 30 }),
    ]);

    const feed = await Promise.all(
      recentPicks.map(async (pick) => {
        const [profile, product, category] = await Promise.all([
          this.profileRepository.getById(pick.userId),
          this.productRepository.getById(pick.productId),
          this.categoryRepository.getById(pick.categoryId),
        ]);

        return { pick, profile, product, category };
      }),
    );

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
