export type PickStatus = 'active' | 'replaced' | 'removed' | 'needs_review' | 'hidden';

export interface Pick {
  id: string;
  userId: string;
  categoryId: string;
  productId: string;
  oneLineReview: string;
  status: PickStatus;
  startedAt: string;
  endedAt: string | null;
  replacedByPickId: string | null;
  createdAt: string;
  updatedAt: string;
}
