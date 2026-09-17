import type { Item } from '@/types/domain/item';

export interface ItemSearchInput {
  query: string;
  categoryId?: string;
  categoryIds?: string[];
  limit?: number;
}

export interface ItemRepository {
  submitItem(input: SubmitItemInput): Promise<Item>;
  getSubmissionsByUser(userId: string, limit?: number): Promise<Item[]>;
  getById(itemId: string): Promise<Item | null>;
  getByCategory(categoryId: string): Promise<Item[]>;
  search(input: ItemSearchInput): Promise<Item[]>;
}

export interface SubmitItemInput {
  categoryId: string;
  itemName: string;
  imagePath?: string;
  thumbnailPath?: string;
  imageSourceUrl?: string;
}
