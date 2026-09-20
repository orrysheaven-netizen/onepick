import type { FollowCounts } from '@/types/domain/safety';

export interface FollowRepository {
  /** Whether the session user follows this profile. Never lists followers. */
  isFollowing(followerUserId: string, followeeUserId: string): Promise<boolean>;
  follow(followerUserId: string, followeeUserId: string): Promise<void>;
  unfollow(followerUserId: string, followeeUserId: string): Promise<void>;
  /** Own counts only; the server ignores any other user. */
  getCounts(userId: string): Promise<FollowCounts>;
}
