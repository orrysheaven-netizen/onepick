import type { PickChannel } from '@/lib/items/pickChannel';

export type ItemStatus =
  | 'pending'
  | 'active'
  | 'discontinued'
  | 'hidden'
  | 'merged'
  | 'rejected';

export interface Item {
  id: string;
  categoryId: string;
  brandId: string | null;
  name: string;
  normalizedName: string;
  modelCode: string | null;
  officialUrl: string | null;
  imagePath: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  imageSourceUrl: string | null;
  externalSource: string | null;
  externalId: string | null;
  originalName: string | null;
  releaseYear: number | null;
  creatorName?: string | null;
  collectionName?: string | null;
  /** Free-text category hint on a pending registration request. */
  requestedCategoryLabel?: string | null;
  /** Sales channels (store / online / recipe) for food items; empty or absent otherwise. */
  channels?: PickChannel[];
  /** Public provider profile for store/online items. Legacy/catalog items may not have one. */
  providerId?: string | null;
  /** L4: the photo shown is my own, still waiting for admin review (visible only to me). */
  photoPendingReview?: boolean;
  status: ItemStatus;
  mergedIntoItemId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
