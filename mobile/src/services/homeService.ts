import { channelScopeList, readChannelScopePage, type PickChannelScope } from '@/lib/home/channelFeedMerge';
import type { HomeFeedPick, PickChannel, PickReadItem, ReadCursor, ReadRepository } from '@/repositories/interfaces/readRepository';

const PARTICIPANT_PAGE_SIZE = 100;
/** Early-MVP scale guard: 10 pages = 1,000 current Picks. Beyond that a server aggregate is needed. */
const PARTICIPANT_MAX_PAGES = 10;

export class HomeService {
  constructor(private readonly readRepository: ReadRepository) {}

  // Home context changes much less often than feed pages. Keep it outside the
  // infinite query so pagination/refetching never repeats these broad reads.
  async getHomeContext(userId?: string, _channel: PickChannelScope = null, _rootSlug: string | null = null) {
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
  // A multi-channel scope (오프라인 식당 + 온라인 음식, #762) is read per channel and merged
  // in server order; see channelFeedMerge for the cursor rules.
  async getHomePicks(cursor: ReadCursor | null = null, channel: PickChannelScope = null, rootSlug: string | null = null, categoryId: string | null = null) {
    const feed = await readChannelScopePage(channel, (one) => this.readRepository.getHomePicks(cursor, one, rootSlug, categoryId));
    return {
      picks: feed.items,
      nextCursor: feed.nextCursor,
    };
  }

  /**
   * Current Pick count per food menu across a channel scope. Each channel is a separate
   * public aggregate; a Pick has one channel there, so the sums never double count.
   */
  async getFoodMenuPickCounts(channel: PickChannelScope = null) {
    const maps = await Promise.all(channelScopeList(channel).map((one) => this.readRepository.getFoodMenuPickCounts(one)));
    if (maps.length === 1) return maps[0];
    const total = new Map<string, number>();
    for (const map of maps) for (const [categoryId, count] of map) total.set(categoryId, (total.get(categoryId) ?? 0) + count);
    return total;
  }

  /** Date-seeded random food menu chosen by the DB each Korean calendar day. */
  getDailyQuestionCategoryId() {
    return this.readRepository.getDailyQuestionCategoryId();
  }

  /**
   * Every current public Pick, newest first, for Home's "함께하는 사람들". The read goes through
   * the viewer's RLS (suspended and blocked members are already excluded). `complete` is false
   * when the scale guard stopped paging, so the caller can avoid showing partial counts.
   */
  async getParticipantPicks(): Promise<{ rows: PickReadItem[]; complete: boolean }> {
    const rows: PickReadItem[] = [];
    let cursor: ReadCursor | null = null;
    for (let page = 0; page < PARTICIPANT_MAX_PAGES; page += 1) {
      const batch = await this.readRepository.getPicks({
        statuses: ['active'], orderBy: 'started_at', limit: PARTICIPANT_PAGE_SIZE, cursor,
      });
      rows.push(...batch);
      if (batch.length < PARTICIPANT_PAGE_SIZE) return { rows, complete: true };
      const last = batch[batch.length - 1].pick;
      cursor = { timestamp: last.startedAt, id: last.id };
    }
    return { rows, complete: false };
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

