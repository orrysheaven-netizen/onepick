import type { PickChannel } from '@/lib/items/pickChannel';
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
  itemId: string;
  oneLineReview: string;
  /** Food Picks only. Omitted, the server uses the item's own channel. */
  channel?: PickChannel;
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
  channel?: PickChannel;
}

export interface RegisterItemPickInput {
  categoryId: string;
  channel: PickChannel;
  oneLineReview: string;
  itemId?: string | null;
  catalogId?: string | null;
  providerId?: string | null;
  linkUrl?: string | null;
  imagePath?: string | null;
  thumbnailPath?: string | null;
  imageSourceUrl?: string | null;
  expectedPreviousPickId: string | null;
  requestId: string;
}

export interface RegisterItemPickResult {
  itemId: string;
  pickId: string;
  published: boolean;
  replacedPickId: string | null;
  retried: boolean;
}

export interface RegisterUnclassifiedPickInput {
  menuName: string;
  oneLineReview: string;
  requestId: string;
  catalogId?: string | null;
  placeName?: string;
  mapUrl?: string;
  imagePath: string;
  thumbnailPath: string;
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
  /** Every current Pick in the category: one per channel for food, at most one elsewhere. */
  getCurrentPicksInCategory(userId: string, categoryId: string): Promise<Pick[]>;
  getCurrentPicksByUser(userId: string): Promise<Pick[]>;
  getActivePicksByUser(userId: string): Promise<Pick[]>;
  getHistoryByUser(userId: string, limit?: number): Promise<Pick[]>;
  getRecentPicks(input: RecentPicksInput): Promise<Pick[]>;
  changePick(input: ChangePickInput): Promise<Pick>;
  registerPick(input: RegisterPickRecordInput): Promise<Pick>;
  registerItemPick(input: RegisterItemPickInput): Promise<RegisterItemPickResult>;
  registerUnclassifiedPick(input: RegisterUnclassifiedPickInput): Promise<RegisterItemPickResult>;
  updateReview(input: UpdatePickReviewInput): Promise<Pick>;
  removePick(categoryId: string, channel?: PickChannel | null, pickId?: string): Promise<void>;
  deleteReview(pickId: string): Promise<void>;
}

