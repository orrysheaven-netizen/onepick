import type { Database } from '@/lib/supabase/database.types';
import type { Comment } from '@/types/domain/comment';

type CommentRow = Database['public']['Tables']['comments']['Row'];

export function mapCommentRow(row: CommentRow): Comment {
  const extended = row as CommentRow & { parent_comment_id?: string | null; deleted_at?: string | null };
  return {
    id: row.id,
    pickId: row.pick_id,
    userId: row.user_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    parentCommentId: extended.parent_comment_id ?? null,
    isDeleted: Boolean(extended.deleted_at),
  };
}
