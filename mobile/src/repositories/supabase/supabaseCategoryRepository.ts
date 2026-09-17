import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { selectableCategories } from '@/lib/categories/categoryTree';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import { mapCategoryRow } from '@/repositories/mappers/categoryMapper';

export class SupabaseCategoryRepository implements CategoryRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async getOpenCategories() {
    return selectableCategories(await this.getBrowseCategories());
  }

  async getBrowseCategories() {
    const { data, error } = await this.client
      .from('categories')
      .select('*')
      .eq('is_visible', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      throw mapSupabaseError(error);
    }

    return data.map(mapCategoryRow);
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
