import type { Product } from '@/types/domain/product';

export interface ProductSearchInput {
  query: string;
  categoryId?: string;
  limit?: number;
}

export interface ProductRepository {
  getById(productId: string): Promise<Product | null>;
  getByCategory(categoryId: string): Promise<Product[]>;
  search(input: ProductSearchInput): Promise<Product[]>;
}
