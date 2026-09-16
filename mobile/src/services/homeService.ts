import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ProductRepository } from '@/repositories/interfaces/productRepository';
import type { ProfileRepository } from '@/repositories/interfaces/profileRepository';
import type { Pick } from '@/types/domain/pick';

export type HomeMode = 'single_category' | 'multi_category';

export class HomeService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly pickRepository: PickRepository,
    private readonly productRepository: ProductRepository,
    private readonly profileRepository: ProfileRepository,
  ) {}

  async getHomeData(userId?: string) {
    const openCategories = await this.categoryRepository.getOpenCategories();
    const mode: HomeMode =
      openCategories.length <= 1 ? 'single_category' : 'multi_category';
    const singleCategory = mode === 'single_category' ? openCategories[0] : undefined;

    const [myPicks, recentPicks, singleCategoryProducts] = await Promise.all([
      userId
        ? this.pickRepository.getCurrentPicksByUser(userId)
        : Promise.resolve([]),
      this.pickRepository.getRecentPicks({ limit: 20, excludeUserId: userId }),
      singleCategory
        ? this.productRepository.getByCategory(singleCategory.id)
        : Promise.resolve([]),
    ]);

    const selectedCategoryIds = new Set(myPicks.map((pick) => pick.categoryId));
    const unselectedCategories = userId
      ? openCategories.filter((category) => category.isPickable && !selectedCategoryIds.has(category.id))
      : [];

    const [currentPicks, feed, categoriesToPick] = await Promise.all([
      Promise.all(myPicks.map((pick) => this.hydratePick(pick))),
      userId
        ? Promise.all(recentPicks.map(async (pick) => ({
            ...await this.hydratePick(pick),
            profile: await this.profileRepository.getById(pick.userId),
          })))
        : Promise.resolve([]),
      Promise.all(unselectedCategories.map(async (category) => ({
        category,
        products: category.id === singleCategory?.id
          ? singleCategoryProducts
          : await this.productRepository.getByCategory(category.id),
      }))),
    ]);

    return {
      mode,
      openCategories,
      singleCategory: singleCategory ?? null,
      singleCategoryProducts,
      myRecentPicks: myPicks.slice(0, 3),
      recentPicks,
      currentPicks,
      categoriesToPick,
      feed,
    };
  }

  private async hydratePick(pick: Pick) {
    const [category, product] = await Promise.all([
      this.categoryRepository.getById(pick.categoryId),
      this.productRepository.getById(pick.productId),
    ]);
    return { pick, category, product };
  }
}
