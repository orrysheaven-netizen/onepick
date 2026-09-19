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
  status: ItemStatus;
  mergedIntoItemId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
