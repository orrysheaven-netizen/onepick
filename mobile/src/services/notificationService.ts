import { supabase } from '@/lib/supabase/client';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppDatabase } from '@/lib/supabase/database.overrides';

export type NotificationKind = 'comment' | 'pick_change';
export type AppNotification = AppDatabase['public']['Functions']['notification_page']['Returns'][number];
export type NotificationCursor = { timestamp: string; id: string };
export type NotificationPreferences = { followeePickChange: boolean };

export class NotificationService {
  constructor(private readonly client: AppSupabaseClient) {}

  async unreadCount(_userId: string) {
    // The server counts for auth.uid(); the argument only documents the caller.
    const { data, error } = await this.client.rpc('notification_count');
    if (error) throw mapSupabaseError(error);
    return data ?? 0;
  }

  async page(_userId: string, cursor: NotificationCursor | null) {
    const { data, error } = await this.client.rpc('notification_page', {
      p_before_time: cursor?.timestamp,
      p_before_id: cursor?.id,
    });
    if (error) throw mapSupabaseError(error);
    const rows = data ?? [];
    const last = rows[19];
    return {
      items: rows.slice(0, 20),
      nextCursor: rows.length > 20 && last ? { timestamp: last.created_at, id: last.id } : null,
    };
  }

  async markRead(userId: string, kind: NotificationKind, id: string) {
    const readAt = new Date().toISOString();
    const query = kind === 'comment'
      ? this.client.from('comment_notifications').update({ read_at: readAt }).eq('recipient_id', userId).eq('comment_id', id)
      : this.client.from('pick_change_notifications').update({ read_at: readAt }).eq('recipient_id', userId).eq('pick_id', id);
    const { error } = await query.is('read_at', null);
    if (error) throw mapSupabaseError(error);
  }

  async preferences(userId: string): Promise<NotificationPreferences> {
    const { data, error } = await this.client
      .from('notification_preferences')
      .select('followee_pick_change')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw mapSupabaseError(error);
    // No row means the default: on.
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
