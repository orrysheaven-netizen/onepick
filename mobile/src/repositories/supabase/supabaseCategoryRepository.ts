import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { categoryLabel, categoryRootSlug, selectableCategories } from '@/lib/categories/categoryTree';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import { mapCategoryRow } from '@/repositories/mappers/categoryMapper';

export class SupabaseCategoryRepository implements CategoryRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async getOpenCategories() {
    const categories = await this.getBrowseCategories();
    return selectableCategories(categories).map((category) => ({
      ...category,
      label: categoryLabel(category, categories),
      rootSlug: categoryRootSlug(category, categories),
    }));
  }

  async getBrowseCategories() {
    const { data, error } = await this.client
      .from('categories')
      .select('*, category_taste_dimensions(dimension_code, is_primary)')
      .eq('is_visible', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      throw mapSupabaseError(error);
    }

    return data.map(({ category_taste_dimensions: themes, ...row }) => ({
      ...mapCategoryRow(row),
      themeCode: (themes ?? []).find((theme) => theme.is_primary)?.dimension_code ?? null,
    }));
  }

  async getById(categoryId: string) {
    const { data, error } = await this.client
      .from('categories')
      .select('*')
      .eq('id', categoryId)
      .maybeSingle();

    if (error) {
      throw mapSupabaseError(error);
    }

    return data ? mapCategoryRow(data) : null;
  }

  async getBySlug(slug: string) {
    const { data, error } = await this.client
      .from('categories')
      .select('*')
      .eq('slug', slug.trim().toLowerCase())
      .maybeSingle();

    if (error) {
      throw mapSupabaseError(error);
    }

    return data ? mapCategoryRow(data) : null;
  }
}
