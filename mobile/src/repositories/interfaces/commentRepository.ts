import type { Comment } from '@/types/domain/comment';

export interface CreateCommentInput {
  pickId: string;
  userId: string;
  body: string;
  parentCommentId?: string | null;
}

export interface UpdateCommentInput {
  commentId: string;
  body: string;
}

export interface CommentRepository {
  getByPickId(pickId: string): Promise<Comment[]>;
  create(input: CreateCommentInput): Promise<Comment>;
  update(input: UpdateCommentInput): Promise<Comment>;
  remove(commentId: string): Promise<void>;
}
