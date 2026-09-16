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

export interface RecentPicksInput {
  categoryId?: string;
  productId?: string;
  limit: number;
}

export interface PickRepository {
  getById(pickId: string): Promise<Pick | null>;
  getCurrentPick(userId: string, categoryId: string): Promise<Pick | null>;
  getActivePicksByUser(userId: string): Promise<Pick[]>;
  getRecentPicks(input: RecentPicksInput): Promise<Pick[]>;
  changePick(input: ChangePickInput): Promise<Pick>;
  updateReview(input: UpdatePickReviewInput): Promise<Pick>;
  removePick(categoryId: string): Promise<void>;
}
