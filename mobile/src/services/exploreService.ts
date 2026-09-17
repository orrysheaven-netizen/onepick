import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { ReadCursor, ReadRepository } from '@/repositories/interfaces/readRepository';

export const EXPLORE_PAGE_SIZE = 20;

export class ExploreService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly readRepository: ReadRepository,
  ) {}

  getCategories() { return this.categoryRepository.getBrowseCategories(); }

  async getExploreData(categoryId?: string, cursor: ReadCursor | null = null, limit = EXPLORE_PAGE_SIZE) {
    const pageSize = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 99) : EXPLORE_PAGE_SIZE;
    const [openCategories, rows] = await Promise.all([
      this.categoryRepository.getOpenCategories(),
      this.readRepository.getPicks({
        categoryId,
        statuses: ['active'],
        cursor,
        limit: pageSize + 1,
      }),
    ]);

    const hasMore = rows.length > pageSize;
    const feed = rows.slice(0, pageSize);
    const last = feed[feed.length - 1]?.pick;

    return {
      openCategories,
      selectedCategoryId: categoryId ?? null,
      feed,
      nextCursor: hasMore && last ? { timestamp: last.startedAt, id: last.id } : null,
    };
  }
}
