import type { Pick } from '@/types/domain/pick';

// purchaseUrl / purchaseTip follow the RPC contract: undefined leaves the
// stored value alone, '' clears it. A caller that only edits the review must
// not wipe a link the person saved earlier.
export interface PurchaseLinkInput {
  purchaseUrl?: string;
  purchaseTip?: string;
}

export interface ChangePickInput extends PurchaseLinkInput {
  categoryId: string;
  channel?: 'offline' | 'online' | 'recipe';
  itemId: string;
  oneLineReview: string;
}

export interface UpdatePickReviewInput extends PurchaseLinkInput {
  pickId: string;
  oneLineReview: string;
}

export interface RegisterPickRecordInput {
  categoryId: string;
  itemId: string;
  itemName: string;
  oneLineReview: string;
  imagePath?: string;
  thumbnailPath?: string;
  imageSourceUrl?: string;
}

export interface RecentPicksInput {
  excludeUserId?: string;
  categoryId?: string;
  itemId?: string;
  limit: number;
}

export interface PickRepository {
  getById(pickId: string): Promise<Pick | null>;
  getCurrentPick(userId: string, categoryId: string, channel?: 'offline' | 'online' | 'recipe'): Promise<Pick | null>;
  getCurrentPicksByUser(userId: string): Promise<Pick[]>;
  getActivePicksByUser(userId: string): Promise<Pick[]>;
  getHistoryByUser(userId: string, limit?: number): Promise<Pick[]>;
  getRecentPicks(input: RecentPicksInput): Promise<Pick[]>;
  changePick(input: ChangePickInput): Promise<Pick>;
  registerPick(input: RegisterPickRecordInput): Promise<Pick>;
  updateReview(input: UpdatePickReviewInput): Promise<Pick>;
  removePick(categoryId: string, channel?: 'offline' | 'online' | 'recipe'): Promise<void>;
}
