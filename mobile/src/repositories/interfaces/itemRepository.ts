import type { Item } from '@/types/domain/item';

export interface ItemSearchInput {
  query: string;
  categoryId?: string;
  categoryIds?: string[];
  limit?: number;
  signal?: AbortSignal;
}

/** L4: my own photo waiting for admin review (only I can read it). */
export interface PendingItemPhoto {
  itemId: string;
  imageUrl: string;
  thumbnailUrl: string;
}

export interface ItemReadOptions {
  /** #757 pick detail store link. Off by default so write paths keep one round trip. */
  includeProvider?: boolean;
}

export interface ItemRepository {
  /** Saves the photo as my candidate; the item keeps no photo until an admin approves it. */
  attachPhoto(input: AttachItemPhotoInput): Promise<Item>;
  /** My pending photo candidates, keyed by item id. RLS returns only my own rows. */
  getMyPendingPhotos(userId: string, itemIds?: string[]): Promise<Map<string, PendingItemPhoto>>;
  submitItem(input: SubmitItemInput): Promise<Item>;
  submitUnclassifiedItem(input: SubmitUnclassifiedItemInput): Promise<Item>;
  stageUserPlaceItem(input: StageUserPlaceItemInput): Promise<Item>;
  stageBrandItem(input: StageBrandItemInput): Promise<Item>;
  reviseItemRequest(input: ReviseItemRequestInput): Promise<Item>;
  /** Writes or clears the requester's free-text category hint on their own pending request. */
  setPendingCategoryHint(itemId: string, label: string | null): Promise<Item>;
  getSubmissionsByUser(userId: string, limit?: number): Promise<Item[]>;
  /** Plain item read. `includeProvider` adds the item_providers lookup (providerId,
   * null when the item has no store); without it providerId is left unset. */
  getById(itemId: string, options?: ItemReadOptions): Promise<Item | null>;
  getByCategory(categoryId: string): Promise<Item[]>;
  /** Public active/discontinued items in currently selectable leaf categories.
   * The data source enforces category/parent visibility BEFORE ranking/limit.
   * Callers need no separate category preflight. Preserve caller RLS and aliases.
   */
  search(input: ItemSearchInput): Promise<Item[]>;
}

export interface AttachItemPhotoInput {
  itemId: string;
  imagePath: string;
  thumbnailPath: string;
  imageSourceUrl?: string;
}

export interface SubmitItemInput {
  categoryId: string;
  itemName: string;
  imagePath?: string;
  thumbnailPath?: string;
  imageSourceUrl?: string;
}

export interface SubmitUnclassifiedItemInput {
  itemName: string;
  imagePath?: string;
  thumbnailPath?: string;
  imageSourceUrl?: string;
}

export interface StageUserPlaceItemInput {
  categoryId: string;
  name: string;
  mapUrl: string;
  branchName?: string | null;
}

export interface ReviseItemRequestInput {
  itemId: string;
  linkUrl?: string | null;
  imagePath?: string | null;
  thumbnailPath?: string | null;
  imageSourceUrl?: string | null;
  removePhoto?: boolean;
}

export interface StageBrandItemInput {
  categoryId: string;
  brandId: string;
}
