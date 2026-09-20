import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { FollowRepository } from '@/repositories/interfaces/followRepository';

export class SupabaseFollowRepository implements FollowRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  private async assertUser(userId: string) {
    const { data, error } = await this.client.auth.getUser();
    if (error) throw mapSupabaseError(error);
    if (!data.user) throw new AppError('AUTH_REQUIRED');
    if (data.user.id !== userId) throw new AppError('FORBIDDEN');
  }

  async isFollowing(followerUserId: string, followeeUserId: string) {
    await this.assertUser(followerUserId);
    const { count, error } = await this.client
      .from('user_follows')
      .select('followee_id', { count: 'exact', head: true })
      .eq('follower_id', followerUserId)
      .eq('followee_id', followeeUserId);
    if (error) throw mapSupabaseError(error);
    return (count ?? 0) > 0;
  }

  async follow(followerUserId: string, followeeUserId: string) {
    await this.assertUser(followerUserId);
    const { error } = await this.client
      .from('user_follows')
      .insert({ follower_id: followerUserId, followee_id: followeeUserId });
    // Already following is the requested end state, not a failure.
    if (error && error.code !== '23505') throw mapSupabaseError(error);
  }

  async unfollow(followerUserId: string, followeeUserId: string) {
    await this.assertUser(followerUserId);
    const { error } = await this.client
      .from('user_follows')
      .delete()
      .eq('follower_id', followerUserId)
      .eq('followee_id', followeeUserId);
    if (error) throw mapSupabaseError(error);
  }

  async getCounts(userId: string) {
    await this.assertUser(userId);
    const { data, error } = await this.client.rpc('follow_counts');
    if (error) throw mapSupabaseError(error);
    const row = data?.[0];
    return { followingCount: row?.following_count ?? 0, followerCount: row?.follower_count ?? 0 };
  }
}
