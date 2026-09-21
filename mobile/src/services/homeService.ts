import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { ItemRepository } from '@/repositories/interfaces/itemRepository';
import type { ReadCursor, ReadRepository } from '@/repositories/interfaces/readRepository';

export class HomeService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    _itemRepository: ItemRepository,
    private readonly readRepository: ReadRepository,
  ) {}

  // Home is people-first: each card is one person's current Pick with their
  // reason (docs/people-first-home.md). The server excludes the viewer's own
  // Picks and applies block/suspension rules; no minimum pick count applies.
  async getHomeData(userId?: string, cursor: ReadCursor | null = null) {
    // Everything here is independent, so it goes out in one round trip rather
    // than waiting for the category list first: on the first screen people see,
    // a sequential read added a full request to time-to-content.
    // Only the first page's categories, collection and editorial list are read;
    // later pages contribute feed rows only, and the Home query keeps the first
    // page's values for the rest.
    const firstPage = cursor === null;
    const [openCategories, currentPicks, feed, editorialItems] = await Promise.all([
      firstPage
        ? this.categoryRepository.getOpenCategories()
        : Promise.resolve([] as Awaited<ReturnType<CategoryRepository['getOpenCategories']>>),
      firstPage && userId
        ? this.readRepository.getPicks({
            userId,
            statuses: ['active', 'needs_review'],
            orderBy: 'updated_at',
            limit: 100,
          })
        : Promise.resolve([] as Awaited<ReturnType<ReadRepository['getPicks']>>),
      this.readRepository.getHomePicks(cursor),
      firstPage
        ? this.readRepository.getEditorialHomeItems(6)
        : Promise.resolve([] as Awaited<ReturnType<ReadRepository['getEditorialHomeItems']>>),
    ]);

    return {
      openCategories,
      currentPicks,
      editorialItems,
      picks: feed.items,
      nextCursor: feed.nextCursor,
    };
  }
}
