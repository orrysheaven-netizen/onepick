export interface Comment {
  id: string;
  pickId: string;
  userId: string | null;
  body: string | null;
  createdAt: string;
  updatedAt: string | null;
  parentCommentId?: string | null;
  isDeleted?: boolean;
  authorCurrentPickMatchesItem?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
}

export interface CommentThreadItem {
  comment: Comment;
  author: import('@/types/domain/profile').Profile | null;
  replies: CommentThreadItem[];
  replyCount: number;
}
