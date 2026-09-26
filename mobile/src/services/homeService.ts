import type { PickChannel, ReadCursor, ReadRepository } from '@/repositories/interfaces/readRepository';

export class HomeService {
  constructor(private readonly readRepository: ReadRepository) {}

  // Home context changes much less often than feed pages. Keep it outside the
  // infinite query so pagination/refetching never repeats these broad reads.
  async getHomeContext(userId?: string) {
    const [currentPicks, editorialItems] = await Promise.all([
      userId
        ? this.readRepository.getPicks({
            userId,
            statuses: ['active', 'needs_review'],
            orderBy: 'updated_at',
            limit: 100,
          })
        : Promise.resolve([]),
      this.readRepository.getEditorialHomeItems(6),
    ]);

    return { currentPicks, editorialItems };
  }

  // Home is people-first: each card is one person's current Pick with their
  // reason (docs/people-first-home.md). The server excludes the viewer's own
  // Picks and applies block/suspension rules; no minimum pick count applies.
  async getHomePicks(cursor: ReadCursor | null = null, channel: PickChannel | null = null, rootSlug: string | null = null) {
    const feed = await this.readRepository.getHomePicks(cursor, channel, rootSlug);
    return {
      picks: feed.items,
      nextCursor: feed.nextCursor,
    };
  }
}
