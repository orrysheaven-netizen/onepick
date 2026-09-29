import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type {
  CommentRepository,
  CreateCommentInput,
  UpdateCommentInput,
} from '@/repositories/interfaces/commentRepository';
import { mapCommentRow } from '@/repositories/mappers/commentMapper';

type CommentRow = Database['public']['Tables']['comments']['Row'];
type CommentUpdate = Database['public']['Tables']['comments']['Update'];

export class SupabaseCommentRepository implements CommentRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async getByPickId(pickId: string) {
    const { data, error } = await this.client
      .from('comments')
      .select('*')
      .eq('pick_id', pickId)
      .order('created_at', { ascending: true });

    if (error) {
      throw mapSupabaseError(error);
    }

    return data.map(mapCommentRow);
  }

  async create(input: CreateCommentInput) {
    // The generated base type predates parent_comment_id. Keep the app write
    // contract narrow while the server/RLS validates root-parent eligibility.
    const values = {
      pick_id: input.pickId,
      user_id: input.userId,
      body: input.body,
      parent_comment_id: input.parentCommentId ?? null,
    };

    const { data, error } = await (this.client as any)
      .from('comments')
      .insert(values)
      .select('*')
      .single();

    if (error) {
      throw mapSupabaseError(error);
    }

    return mapCommentRow(data as CommentRow);
  }

  async update(input: UpdateCommentInput) {
    const values: CommentUpdate = {
      body: input.body,
    };

    const { data, error } = await this.client
      .from('comments')
      .update(values)
      .eq('id', input.commentId)
      .select('*')
      .maybeSingle();

    if (error) {
      throw mapSupabaseError(error);
    }

    if (!data) {
      throw new AppError('FORBIDDEN');
    }

    return mapCommentRow(data);
  }

  async remove(commentId: string) {
    // Server decides whether this is a hard delete or a tombstone so replies
    // never disappear when their parent is removed.
    const { error } = await (this.client as any).rpc('delete_comment', {
      p_comment_id: commentId,
    });

    if (error) {
      throw mapSupabaseError(error);
    }
  }
}
