import { profileImagePublicUrl } from '@/lib/profile/profileImage';
import { supabase } from '@/lib/supabase/client';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { NotificationGroupRow } from '@/lib/supabase/database.overrides';

export type NotificationGroupKind = NotificationGroupRow['kind'];
export type AppNotificationGroup = NotificationGroupRow;
export type NotificationCursor = { activity: string; groupId: string };
export type NotificationPreferences = { followeePickChange: boolean };

function normalizeGroup(row: unknown): AppNotificationGroup | null {
  if (!row || typeof row !== 'object') return null;
  const value = row as Partial<AppNotificationGroup>;
  const kinds: NotificationGroupKind[] = ['pick_review', 'comment', 'reply', 'fix_needed', 'followee_pick'];
  if (!value.group_id || typeof value.group_id !== 'string'
    || !value.kind || !kinds.includes(value.kind)
    || typeof value.latest_at !== 'string' || !value.latest_at
    || typeof value.snapshot !== 'string' || !value.snapshot
    || typeof value.unread_count !== 'number'
    || typeof value.total_count !== 'number'
    || typeof value.actor_count !== 'number'
    || !value.target || typeof value.target !== 'object') return null;

  return {
    ...value,
    actor: value.actor && typeof value.actor.user_id === 'string' && typeof value.actor.username === 'string'
      ? {
          user_id: value.actor.user_id,
          username: value.actor.username,
          profile_image_url: profileImagePublicUrl(value.actor.profile_image_url),
        }
      : null,
    target: {
      item_id: typeof value.target.item_id === 'string' ? value.target.item_id : null,
      item_name: typeof value.target.item_name === 'string' ? value.target.item_name : null,
      category_id: typeof value.target.category_id === 'string' ? value.target.category_id : null,
      category_name: typeof value.target.category_name === 'string' ? value.target.category_name : null,
      channel: typeof value.target.channel === 'string' ? value.target.channel : null,
      pick_id: typeof value.target.pick_id === 'string' ? value.target.pick_id : null,
      comment_id: typeof value.target.comment_id === 'string' ? value.target.comment_id : null,
      root_comment_id: typeof value.target.root_comment_id === 'string' ? value.target.root_comment_id : null,
      user_id: typeof value.target.user_id === 'string' ? value.target.user_id : null,
    },
    reason: typeof value.reason === 'string' ? value.reason : null,
  } as AppNotificationGroup;
}

export class NotificationService {
  constructor(private readonly client: AppSupabaseClient) {}

  async unreadCount(_userId: string) {
    const { data, error } = await this.client.rpc('notification_unread_count');
    if (error) throw mapSupabaseError(error);
    return data ?? 0;
  }

  async page(_userId: string, cursor: NotificationCursor | null) {
    const { data, error } = await this.client.rpc('notification_group_page', {
      p_before_activity: cursor?.activity,
      p_before_group_id: cursor?.groupId,
      p_limit: 21,
    });
    if (error) throw mapSupabaseError(error);

    const rawRows = (data ?? []) as unknown[];
    const rows = rawRows.slice(0, 20).map(normalizeGroup)
      .filter((row): row is AppNotificationGroup => Boolean(row));
    const last = rows.at(-1);
    return {
      items: rows,
      nextCursor: rawRows.length > 20 && last ? { activity: last.latest_at, groupId: last.group_id } : null,
    };
  }

  async markGroupRead(_userId: string, groupId: string, snapshot: string) {
    const { data, error } = await this.client.rpc('mark_notification_group_read', {
      p_group_id: groupId,
      p_until: snapshot,
    });
    if (error) throw mapSupabaseError(error);
    return data ?? 0;
  }

  async preferences(userId: string): Promise<NotificationPreferences> {
    const { data, error } = await this.client
      .from('notification_preferences')
      .select('followee_pick_change')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw mapSupabaseError(error);
    return { followeePickChange: data?.followee_pick_change ?? true };
  }

  async setFolloweePickChange(userId: string, enabled: boolean) {
    const { error } = await this.client
      .from('notification_preferences')
      .upsert({ user_id: userId, followee_pick_change: enabled, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw mapSupabaseError(error);
  }
}
export const notificationService = new NotificationService(supabase);
