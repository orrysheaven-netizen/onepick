export interface Comment {
  id: string;
  pickId: string;
  userId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
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
