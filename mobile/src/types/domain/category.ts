export type CategoryStatus = 'draft' | 'open' | 'paused' | 'closed';

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  status: CategoryStatus;
  isVisible: boolean;
  isPickable: boolean;
  rankingMinSample: number;
  sortOrder: number;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
