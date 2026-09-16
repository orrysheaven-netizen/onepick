import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';

export type HomeMode = 'single_category' | 'multi_category';

export class HomeService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly pickRepository: PickRepository,
  ) {}

  async getHomeData(userId?: string) {
    const openCategories = await this.categoryRepository.getOpenCategories();

    const [myPicks, recentPicks] = await Promise.all([
      userId
        ? this.pickRepository.getActivePicksByUser(userId)
        : Promise.resolve([]),
      this.pickRepository.getRecentPicks({ limit: 20 }),
    ]);

    const mode: HomeMode =
      openCategories.length <= 1 ? 'single_category' : 'multi_category';

    return {
      mode,
      openCategories,
      myRecentPicks: myPicks.slice(0, 3),
      recentPicks,
    };
  }
}
