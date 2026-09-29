import type { Item } from '@/types/domain/item';
import type { PickChannel } from '@/lib/items/pickChannel';

export interface ItemSearchInput {
  query: string;
  categoryId?: string;
  categoryIds?: string[];
  limit?: number;
  signal?: AbortSignal;
}

export interface ItemRepository {
  attachPhoto(input: AttachItemPhotoInput): Promise<Item>;
  submitItem(input: SubmitItemInput): Promise<Item>;
  submitUnclassifiedItem(input: SubmitUnclassifiedItemInput): Promise<Item>;
  stageUserPlaceItem(input: StageUserPlaceItemInput): Promise<Item>;
  reviseItemRequest(input: ReviseItemRequestInput): Promise<Item>;
  /** Writes or clears the requester's free-text category hint on their own pending request. */
  setPendingCategoryHint(itemId: string, label: string | null): Promise<Item>;
  /** Saves the one-line review that becomes the requester's pick when their pending request is approved. */
  setPendingPickReview(itemId: string, review: string, channel?: PickChannel): Promise<void>;
  getSubmissionsByUser(userId: string, limit?: number): Promise<Item[]>;
  getById(itemId: string): Promise<Item | null>;
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
  roadAddress: string;
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
