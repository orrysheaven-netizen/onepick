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
    const openCategories = await this.categoryRepository.getOpenCategories();
    const [currentPicks, feed, editorialItems] = await Promise.all([
      userId
        ? this.readRepository.getPicks({
            userId,
            statuses: ['active', 'needs_review'],
            orderBy: 'updated_at',
            limit: 100,
          })
        : Promise.resolve([]),
      this.readRepository.getHomePicks(cursor),
      cursor ? Promise.resolve([]) : this.readRepository.getEditorialHomeItems(6),
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
