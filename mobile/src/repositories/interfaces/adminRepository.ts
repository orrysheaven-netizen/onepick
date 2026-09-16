import type { Brand } from '@/types/domain/brand';
import type { Category, CategoryStatus } from '@/types/domain/category';
import type { Product, ProductStatus } from '@/types/domain/product';

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

export interface AdminProductInput {
  categoryId: string;
  brandId?: string | null;
  name: string;
  modelCode?: string | null;
  officialUrl?: string | null;
  status?: ProductStatus;
}

export interface AdminProductUpdateInput extends Partial<AdminProductInput> {
  mergedIntoProductId?: string | null;
}

export interface AdminRepository {
  isAdmin(): Promise<boolean>;
  getCategories(): Promise<Category[]>;
  getBrands(): Promise<Brand[]>;
  getProducts(limit?: number): Promise<Product[]>;
  createCategory(input: AdminCategoryInput): Promise<Category>;
  updateCategory(categoryId: string, input: Partial<AdminCategoryInput>): Promise<Category>;
  createBrand(input: AdminBrandInput): Promise<Brand>;
  updateBrand(brandId: string, input: Partial<AdminBrandInput>): Promise<Brand>;
  createProduct(input: AdminProductInput & { normalizedName: string; createdBy?: string | null }): Promise<Product>;
  updateProduct(productId: string, input: AdminProductUpdateInput & { normalizedName?: string }): Promise<Product>;
}
