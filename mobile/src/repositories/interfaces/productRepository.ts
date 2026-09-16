import type { Product } from '@/types/domain/product';

export interface ProductSearchInput {
  query: string;
  categoryId?: string;
  limit?: number;
}

export interface SubmitProductInput {
  categoryId: string;
  productName: string;
  imagePath?: string;
  thumbnailPath?: string;
  imageSourceUrl?: string;
}

export interface ProductRepository {
  getById(productId: string): Promise<Product | null>;
  getByCategory(categoryId: string): Promise<Product[]>;
  getSubmissionsByUser(userId: string, limit?: number): Promise<Product[]>;
  search(input: ProductSearchInput): Promise<Product[]>;
  submitProduct(input: SubmitProductInput): Promise<Product>;
}