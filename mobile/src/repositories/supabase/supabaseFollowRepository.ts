import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { FollowRepository } from '@/repositories/interfaces/followRepository';
import type { FollowConnectionCursor, FollowDirection } from '@/types/domain/safety';

// Same as repositories/mappers/profileMapper (kept local: no extra import). The database keeps only the owner's `<id>/<uuid>.jpg` path in the
// public `profile-images` bucket (DB CHECK), so the URL is always our own storage.
const PROFILE_IMAGE_PATH = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.jpg$/;
function profileImagePublicUrl(path: string | null | undefined): string | null {
  if (!path || !PROFILE_IMAGE_PATH.test(path)) return null;
  // Static dot notation: Expo only inlines public env vars accessed this way.
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '');
  return base ? `${base}/storage/v1/object/public/profile-images/${path}` : null;
}

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

  async getPublicCounts(profileId: string) {
    const { data, error } = await this.client.rpc('profile_follow_counts', { p_profile_id: profileId });
    if (error) throw mapSupabaseError(error);
    const row = data?.[0];
    if (!row) return null;
    return { followingCount: row.following_count, followerCount: row.follower_count };
  }

  async getConnections(
    profileId: string,
    direction: FollowDirection,
    cursor: FollowConnectionCursor | null = null,
    limit = 20,
  ) {
    const { data, error } = await this.client.rpc('profile_follow_connections_page', {
      p_profile_id: profileId,
      p_direction: direction,
      p_after_username: cursor?.username ?? null,
      p_after_user_id: cursor?.userId ?? null,
      p_limit: limit,
    });
    if (error) throw mapSupabaseError(error);
    const rows = data ?? [];
    const hasNextPage = rows.length > limit;
    const visible = rows.slice(0, limit);
    const items = visible.map((row) => ({
      userId: row.user_id,
      username: row.username,
      profileImageUrl: profileImagePublicUrl(row.profile_image_url),
      bio: row.bio,
      viewerIsFollowing: row.viewer_is_following,
    }));
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasNextPage && last ? { username: last.username, userId: last.userId } : null,
    };
  }
}
