import type { PickChannel } from '@/lib/items/pickChannel';

export type PickStatus = 'active' | 'replaced' | 'removed' | 'needs_review' | 'hidden';

export interface Pick {
  id: string;
  userId: string;
  categoryId: string;
  itemId: string;
  /** 오프라인 / 온라인 / 레시피 for food Picks (one current Pick per menu and channel); null elsewhere. */
  channel: PickChannel | null;
  oneLineReview: string;
  // Where this person bought it, and the buying advice that makes the pick a
  // 쇼핑꿀팁. There is no theme field: the badge derives from purchaseTip.
  purchaseUrl: string | null;
  purchaseTip: string | null;
  status: PickStatus;
  startedAt: string;
  endedAt: string | null;
  replacedByPickId: string | null;
  createdAt: string;
  updatedAt: string;
}
