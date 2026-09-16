import type { Pick } from '@/types/domain/pick';

export interface ChangePickInput {
  categoryId: string;
  productId: string;
  oneLineReview: string;
}

export interface UpdatePickReviewInput {
  pickId: string;
  oneLineReview: string;
}

export interface RegisterPickRecordInput {
  categoryId: string;
  productId: string;
  productName: string;
  oneLineReview: string;
  imagePath?: string;
  thumbnailPath?: string;
  imageSourceUrl?: string;
}

export interface RecentPicksInput {
  excludeUserId?: string;
  categoryId?: string;
  productId?: string;
  limit: number;
}

export interface PickRepository {
  getById(pickId: string): Promise<Pick | null>;
  getCurrentPick(userId: string, categoryId: string): Promise<Pick | null>;
  getCurrentPicksByUser(userId: string): Promise<Pick[]>;
  getActivePicksByUser(userId: string): Promise<Pick[]>;
  getHistoryByUser(userId: string, limit?: number): Promise<Pick[]>;
  getRecentPicks(input: RecentPicksInput): Promise<Pick[]>;
  changePick(input: ChangePickInput): Promise<Pick>;
  registerPick(input: RegisterPickRecordInput): Promise<Pick>;
  updateReview(input: UpdatePickReviewInput): Promise<Pick>;
  removePick(categoryId: string): Promise<void>;
}
