export type PickStatus = 'active' | 'replaced' | 'removed' | 'needs_review' | 'hidden';

export interface Pick {
  id: string;
  userId: string;
  categoryId: string;
  itemId: string;
  oneLineReview: string;
  // Where this person bought it, and the buying advice that makes the pick a
  // 쇼핑꿀팁. There is no theme field: the badge derives from purchaseTip.
  purchaseUrl: string | null;
  purchaseTip: string | null;
  /** Order among the owner's current picks in the category; 1 is the representative. */
  position: number;
  status: PickStatus;
  startedAt: string;
  endedAt: string | null;
  replacedByPickId: string | null;
  createdAt: string;
  updatedAt: string;
}
