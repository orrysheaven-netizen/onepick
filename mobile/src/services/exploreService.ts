import type { PickChannel } from '@/lib/items/pickChannel';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { ReadCursor, ReadRepository } from '@/repositories/interfaces/readRepository';

export const EXPLORE_PAGE_SIZE = 20;

export class ExploreService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly readRepository: ReadRepository,
  ) {}

  getCategories() { return this.categoryRepository.getBrowseCategories(); }

  getFoodMenuPickCounts(channel: PickChannel | null = null) {
    return this.readRepository.getFoodMenuPickCounts(channel);
  }

  getCategoryTopItems(categoryId: string, channel: PickChannel | null = null) {
    return this.readRepository.getCategoryTopItems(categoryId, channel);
  }

  /** Public ranking page data; optional filters keep the future full model intact. */
  getCategoryRanking(slug: string, limit?: number, channel: PickChannel | null = null, rootSlug: string | null = null) {
    return this.readRepository.getCategoryRanking(slug, limit, channel, rootSlug);
  }

  getRankingCategories(rootSlug: string | null = null) {
    return this.readRepository.getRankingCategories(rootSlug);
  }

  getCategoryBySlug(slug: string) {
    return this.categoryRepository.getBySlug(slug);
  }

  getRecentItems(categoryIds: string[] | null, cursor: ReadCursor | null = null, storesOnly = false) {
    // An empty scope means nothing is browsable yet, not "every category".
    if (categoryIds && !categoryIds.length) return Promise.resolve({ items: [], nextCursor: null });
    return this.readRepository.getRecentPickedItems(categoryIds, cursor, storesOnly);
  }

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
