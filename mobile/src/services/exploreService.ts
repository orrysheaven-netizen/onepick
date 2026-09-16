import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { ReadRepository } from '@/repositories/interfaces/readRepository';

export const EXPLORE_PAGE_SIZE = 20;

export class ExploreService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly readRepository: ReadRepository,
  ) {}

  async getExploreData(categoryId?: string, offset = 0, limit = EXPLORE_PAGE_SIZE) {
    const [openCategories, rows] = await Promise.all([
      this.categoryRepository.getOpenCategories(),
      this.readRepository.getPicks({
        categoryId,
        statuses: ['active'],
        offset,
        limit: limit + 1,
      }),
    ]);

    const hasMore = rows.length > limit;
    const feed = rows.slice(0, limit);

    return {
      openCategories,
      selectedCategoryId: categoryId ?? null,
      feed,
      nextOffset: hasMore ? offset + limit : null,
    };
  }
}
