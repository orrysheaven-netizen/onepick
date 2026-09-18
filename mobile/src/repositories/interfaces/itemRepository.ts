import type { Item } from '@/types/domain/item';

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
