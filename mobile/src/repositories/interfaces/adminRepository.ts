import type { Brand } from '@/types/domain/brand';
import type { Category, CategoryStatus } from '@/types/domain/category';
import type { AdminAuditLog, AdminOperationsSnapshot, ClientErrorEvent } from '@/types/domain/operations';
import type { Item, ItemStatus } from '@/types/domain/item';
import type { ItemAlias } from '@/types/domain/itemAlias';

export interface AdminCategoryInput {
  name: string;
  slug: string;
  parentId?: string | null;
  status?: CategoryStatus;
  isVisible?: boolean;
  isPickable?: boolean;
  sortOrder?: number;
  rankingMinSample?: number;
}

export interface AdminBrandInput {
  name: string;
  slug?: string | null;
  logoUrl?: string | null;
  isActive?: boolean;
}

export interface AdminItemInput {
  categoryId: string;
  brandId?: string | null;
  name: string;
  modelCode?: string | null;
  officialUrl?: string | null;
  status?: ItemStatus;
}

export interface AdminItemUpdateInput extends Partial<AdminItemInput> {
  mergedIntoItemId?: string | null;
}

export interface AdminRepository {
  getHomeMinimumPickCount(): Promise<number>;
  setHomeMinimumPickCount(count: number): Promise<number>;
  isAdmin(): Promise<boolean>;
  getOperationsSnapshot(days?: number): Promise<AdminOperationsSnapshot>;
  getAuditLogs(limit?: number): Promise<AdminAuditLog[]>;
  getClientErrorEvents(limit?: number): Promise<ClientErrorEvent[]>;
  getCategories(): Promise<Category[]>;
  getBrands(): Promise<Brand[]>;
  getItems(limit?: number): Promise<Item[]>;
  getPendingItems(): Promise<Item[]>;
  getItemById(itemId: string): Promise<Item | null>;
  getItemAliases(limit?: number): Promise<ItemAlias[]>;
  createItemAlias(itemId: string, alias: string): Promise<ItemAlias>;
  removeItemAlias(aliasId: string): Promise<void>;
  createCategory(input: AdminCategoryInput): Promise<Category>;
  updateCategory(categoryId: string, input: Partial<AdminCategoryInput>): Promise<Category>;
  createBrand(input: AdminBrandInput): Promise<Brand>;
  updateBrand(brandId: string, input: Partial<AdminBrandInput>): Promise<Brand>;
  createItem(input: AdminItemInput & { normalizedName: string; createdBy?: string | null }): Promise<Item>;
  updateItem(itemId: string, input: AdminItemUpdateInput & { normalizedName?: string }, expectedStatus?: ItemStatus): Promise<Item>;
}
