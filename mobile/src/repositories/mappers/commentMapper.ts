import type { Database } from '@/lib/supabase/database.types';
import type { Comment } from '@/types/domain/comment';

type CommentRow = Database['public']['Tables']['comments']['Row'];

export function mapCommentRow(row: CommentRow): Comment {
  return {
    id: row.id,
    pickId: row.pick_id,
    userId: row.user_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
