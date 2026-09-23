import type { Category } from '@/types/domain/category';

export interface SeasonalCategoryRecommendation {
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  seasonLabel: string;
  itemCount: number;
  activePickCount: number;
}

export interface CategoryRepository {
  getOpenCategories(): Promise<Category[]>;
  getBrowseCategories(): Promise<Category[]>;
  getSeasonalRecommendations(limit?: number): Promise<SeasonalCategoryRecommendation[]>;
  getById(categoryId: string): Promise<Category | null>;
  getBySlug(slug: string): Promise<Category | null>;
}
