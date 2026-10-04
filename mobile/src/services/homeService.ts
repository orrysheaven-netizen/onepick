import type { HomeFeedPick, PickChannel, ReadCursor, ReadRepository } from '@/repositories/interfaces/readRepository';

export class HomeService {
  constructor(private readonly readRepository: ReadRepository) {}

  // Home context changes much less often than feed pages. Keep it outside the
  // infinite query so pagination/refetching never repeats these broad reads.
  async getHomeContext(userId?: string, _channel: PickChannel | null = null, _rootSlug: string | null = null) {
    const currentPicks = userId
      ? await this.readRepository.getPicks({
          userId,
          statuses: ['active', 'needs_review'],
          orderBy: 'updated_at',
          limit: 100,
        })
      : [];

    return { currentPicks };
  }

  // Home is people-first: each card is one person's current Pick with their
  // reason (docs/people-first-home.md). The server excludes the viewer's own
  // Picks and applies block/suspension rules; no minimum pick count applies.
  async getHomePicks(cursor: ReadCursor | null = null, channel: PickChannel | null = null, rootSlug: string | null = null, categoryId: string | null = null) {
    const feed = await this.readRepository.getHomePicks(cursor, channel, rootSlug, categoryId);
    return {
      picks: feed.items,
      nextCursor: feed.nextCursor,
    };
  }

  getRecentItemRanking(channel: PickChannel | null = null, limit = 20) {
    return this.readRepository.getFoodItemRecentRanking(channel, limit);
  }

  getRecentMenuRanking(groupCategoryId: string | null = null, channel: PickChannel | null = null, limit = 4) {
    return this.readRepository.getFoodMenuRecentRanking(groupCategoryId, channel, limit);
  }

  // The feed leaves the viewer out, so a dish page reads the viewer's own current
  // Picks for that dish separately (one per channel) and shows them first.
  async getMyDishPicks(userId: string, categoryId: string): Promise<HomeFeedPick[]> {
    const rows = await this.readRepository.getPicks({ userId, categoryId, statuses: ['active'], limit: 10 });
    return rows.flatMap(({ pick, profile, item, category }) => profile && item ? [{
      pickId: pick.id, userId: pick.userId, username: profile.username,
      profileImageUrl: profile.profileImageUrl,
      itemId: item.id, name: item.name,
      categoryId: pick.categoryId, categoryName: category?.name ?? '',
      oneLineReview: pick.oneLineReview,
      thumbnailUrl: item.thumbnailUrl ?? item.imageUrl ?? item.imageSourceUrl,
      startedAt: pick.startedAt,
      channels: pick.channel ? [pick.channel] : item.channels ?? [],
    }] : []);
  }
}
