import { supabase } from '@/lib/supabase/client';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { Database } from '@/lib/supabase/database.types';

export type CommentNotification = Database['public']['Functions']['comment_notification_page']['Returns'][number];
export type NotificationCursor = { timestamp: string; id: string };

export class NotificationService {
  constructor(private readonly client: AppSupabaseClient) {}

  async unreadCount(userId: string) {
    const { data, error } = await this.client.rpc('comment_notification_count', { p_recipient_id: userId });
    if (error) throw mapSupabaseError(error);
    return data ?? 0;
  }

  async page(userId: string, cursor: NotificationCursor | null) {
    const { data, error } = await this.client.rpc('comment_notification_page', {
      p_recipient_id: userId,
      p_before_time: cursor?.timestamp,
      p_before_id: cursor?.id,
    });
    if (error) throw mapSupabaseError(error);
    const rows = data ?? [];
    const last = rows[19];
    return {
      items: rows.slice(0, 20),
      nextCursor: rows.length > 20 && last ? { timestamp: last.created_at, id: last.comment_id } : null,
    };
  }

  async markRead(userId: string, commentId: string) {
    const { error } = await this.client.from('comment_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', userId).eq('comment_id', commentId).is('read_at', null);
    if (error) throw mapSupabaseError(error);
  }
}
export const notificationService = new NotificationService(supabase);
