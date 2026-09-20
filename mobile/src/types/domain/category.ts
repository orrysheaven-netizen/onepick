export type CategoryStatus = 'draft' | 'open' | 'paused' | 'closed';

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  /** Full visible path for selectable leaves, e.g. 먹을것 › 쇼핑몰 › 김치. */
  label?: string;
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
