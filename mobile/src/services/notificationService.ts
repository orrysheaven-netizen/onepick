import { supabase } from '@/lib/supabase/client';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppDatabase } from '@/lib/supabase/database.overrides';

export type NotificationKind = 'comment' | 'pick_change';
export type AppNotification = AppDatabase['public']['Functions']['notification_page']['Returns'][number];
export type NotificationCursor = { timestamp: string; id: string };
export type NotificationPreferences = { followeePickChange: boolean };

function missingUnifiedRpc(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === 'PGRST202'
    || /notification_(count|page)/i.test(error.message ?? '');
}

export class NotificationService {
  constructor(private readonly client: AppSupabaseClient) {}

  async unreadCount(userId: string) {
    const unified = await this.client.rpc('notification_count');
    if (!unified.error) return unified.data ?? 0;
    if (!missingUnifiedRpc(unified.error)) throw mapSupabaseError(unified.error);

    // Compatibility path for a client deployed ahead of the follow-notification
    // migration. Existing comment notifications must keep working.
    const legacy = await this.client.rpc('comment_notification_count', { p_recipient_id: userId });
    if (legacy.error) throw mapSupabaseError(legacy.error);
    return legacy.data ?? 0;
  }

  async page(userId: string, cursor: NotificationCursor | null) {
    const unified = await this.client.rpc('notification_page', {
      p_before_time: cursor?.timestamp,
      p_before_id: cursor?.id,
    });

    if (!unified.error) {
      const rows = unified.data ?? [];
      const last = rows[19];
      return {
        items: rows.slice(0, 20),
        nextCursor: rows.length > 20 && last ? { timestamp: last.created_at, id: last.id } : null,
      };
    }
    if (!missingUnifiedRpc(unified.error)) throw mapSupabaseError(unified.error);

    const legacy = await this.client.rpc('comment_notification_page', {
      p_recipient_id: userId,
      p_before_time: cursor?.timestamp,
      p_before_id: cursor?.id,
    });
    if (legacy.error) throw mapSupabaseError(legacy.error);

    const rows: AppNotification[] = (legacy.data ?? []).map((row) => ({
      kind: 'comment',
      id: row.comment_id,
      pick_id: row.pick_id,
      username: row.username,
      body: row.body,
      item_name: row.item_name,
      created_at: row.created_at,
      read_at: row.read_at ?? null,
    }));
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
