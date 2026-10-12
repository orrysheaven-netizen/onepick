import { AppError } from '@/errors/appError';
import type { FollowRepository } from '@/repositories/interfaces/followRepository';
import type { FollowConnectionCursor, FollowDirection } from '@/types/domain/safety';
import type { PickChannelScope } from '@/lib/home/channelFeedMerge';
import type { ReadCursor, ReadRepository } from '@/repositories/interfaces/readRepository';

export class FollowService {
  constructor(
    private readonly followRepository: FollowRepository,
    private readonly readRepository: ReadRepository,
  ) {}

  isFollowing(followerUserId: string, followeeUserId: string) {
    if (!followerUserId) throw new AppError('AUTH_REQUIRED');
    if (!followeeUserId) throw new AppError('PROFILE_NOT_FOUND');
    if (followerUserId === followeeUserId) return Promise.resolve(false);
    return this.followRepository.isFollowing(followerUserId, followeeUserId);
  }

  follow(followerUserId: string, followeeUserId: string) {
    if (!followerUserId) throw new AppError('AUTH_REQUIRED');
    if (!followeeUserId) throw new AppError('PROFILE_NOT_FOUND');
    if (followerUserId === followeeUserId) throw new AppError('FOLLOW_SELF');
    return this.followRepository.follow(followerUserId, followeeUserId);
  }

  unfollow(followerUserId: string, followeeUserId: string) {
    if (!followerUserId) throw new AppError('AUTH_REQUIRED');
    if (!followeeUserId) throw new AppError('PROFILE_NOT_FOUND');
    return this.followRepository.unfollow(followerUserId, followeeUserId);
  }

  getCounts(userId: string) {
    if (!userId) throw new AppError('AUTH_REQUIRED');
    return this.followRepository.getCounts(userId);
  }

  getPublicCounts(profileId: string) {
    if (!profileId) throw new AppError('PROFILE_NOT_FOUND');
    return this.followRepository.getPublicCounts(profileId);
  }

  getConnections(
    profileId: string,
    direction: FollowDirection,
    cursor: FollowConnectionCursor | null = null,
    limit = 20,
  ) {
    if (!profileId) throw new AppError('PROFILE_NOT_FOUND');
    return this.followRepository.getConnections(profileId, direction, cursor, limit);
  }

  getFollowingFeed(
    userId: string,
    cursor: ReadCursor | null = null,
    channel: PickChannelScope = null,
    rootSlug: string | null = null,
  ) {
    if (!userId) throw new AppError('AUTH_REQUIRED');
    return this.readRepository.getFollowingPicks(cursor, channel, rootSlug);
  }
}
