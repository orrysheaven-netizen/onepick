import type { Category } from '@/types/domain/category';

export interface CategoryRepository {
  getOpenCategories(): Promise<Category[]>;
  getBrowseCategories(): Promise<Category[]>;
  getById(categoryId: string): Promise<Category | null>;
  getBySlug(slug: string): Promise<Category | null>;
}
