export type CategoryStatus = 'draft' | 'open' | 'paused' | 'closed';

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  /** Full visible path for selectable leaves, e.g. 먹을것 › 쇼핑몰 › 김치. */
  label?: string;
  /** Top-level group slug for selectable leaves (e.g. 'food'), set by getOpenCategories. */
  rootSlug?: string | null;
  slug: string;
  status: CategoryStatus;
  isVisible: boolean;
  isPickable: boolean;
  rankingMinSample: number;
  sortOrder: number;
  imageUrl: string | null;
  /** Own primary taste theme (food, culture, …); children without one inherit the nearest ancestor's. */
  themeCode?: string | null;
  createdAt: string;
  updatedAt: string;
}
