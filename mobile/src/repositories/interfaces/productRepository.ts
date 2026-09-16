import type { Product } from '@/types/domain/product';

export interface ProductSearchInput {
  query: string;
  categoryId?: string;
  categoryIds?: string[];
  limit?: number;
}

export interface ProductRepository {
  submitProduct(input: SubmitProductInput): Promise<Product>;
  getSubmissionsByUser(userId: string, limit?: number): Promise<Product[]>;
  getById(productId: string): Promise<Product | null>;
  getByCategory(categoryId: string): Promise<Product[]>;
  search(input: ProductSearchInput): Promise<Product[]>;
}

export interface SubmitProductInput {
  categoryId: string;
  productName: string;
  imagePath?: string;
  thumbnailPath?: string;
  imageSourceUrl?: string;
}
