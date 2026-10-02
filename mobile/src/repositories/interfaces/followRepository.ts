import type {
  FollowConnectionCursor,
  FollowConnectionPage,
  FollowCounts,
  FollowDirection,
} from '@/types/domain/safety';

export interface FollowRepository {
  /** Whether the session user follows this profile. Never lists followers. */
  isFollowing(followerUserId: string, followeeUserId: string): Promise<boolean>;
  follow(followerUserId: string, followeeUserId: string): Promise<void>;
  unfollow(followerUserId: string, followeeUserId: string): Promise<void>;
  /** Own counts only; the server ignores any other user. */
  getCounts(userId: string): Promise<FollowCounts>;
  /** Public sanitized counts for a visible profile; null when unavailable to this viewer. */
  getPublicCounts(profileId: string): Promise<FollowCounts | null>;
  /** Public sanitized followers/following page; never exposes follow timestamps. */
  getConnections(
    profileId: string,
    direction: FollowDirection,
    cursor?: FollowConnectionCursor | null,
    limit?: number,
  ): Promise<FollowConnectionPage>;
}
