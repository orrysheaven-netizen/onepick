import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { categoryLabel, selectableCategories } from '@/lib/categories/categoryTree';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import { mapCategoryRow } from '@/repositories/mappers/categoryMapper';

function isMissingRpc(error: { code?: string | null } | null) {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

export class SupabaseCategoryRepository implements CategoryRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  private async getVisibleCategories() {
    const { data, error } = await this.client
      .from('categories')
      .select('*')
      .eq('is_visible', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw mapSupabaseError(error);
    return data.map(mapCategoryRow);
  }

  async getOpenCategories() {
    // Registration/search must keep every open leaf available, even when a
    // sparse category is intentionally hidden from broad discovery.
    const categories = await this.getVisibleCategories();
    return selectableCategories(categories).map((category) => ({
      ...category,
      label: categoryLabel(category, categories),
    }));
  }

  async getBrowseCategories() {
    const { data, error } = await this.client.rpc('browse_categories');
    if (error) {
      // App and database deployments can overlap briefly. During that window,
      // preserve the old browse behavior instead of blanking Explore.
      if (isMissingRpc(error)) return this.getVisibleCategories();
      throw mapSupabaseError(error);
    }
    return (data ?? []).map(mapCategoryRow);
  }

  async getSeasonalRecommendations(limit = 8) {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 20);
    const { data, error } = await this.client.rpc('seasonal_category_recommendations', {
      p_limit: safeLimit,
    });
    if (error) {
      if (isMissingRpc(error)) return [];
      throw mapSupabaseError(error);
    }
    return (data ?? []).map((row) => ({
      categoryId: row.category_id,
      categoryName: row.category_name,
      categorySlug: row.category_slug,
      seasonLabel: row.season_label,
      itemCount: Number(row.item_count) || 0,
      activePickCount: Number(row.active_pick_count) || 0,
    }));
  }

  async getById(categoryId: string) {
    const { data, error } = await this.client
      .from('categories')
      .select('*')
      .eq('id', categoryId)
      .maybeSingle();

    if (error) throw mapSupabaseError(error);
    return data ? mapCategoryRow(data) : null;
  }

  async getBySlug(slug: string) {
    const { data, error } = await this.client
      .from('categories')
      .select('*')
      .eq('slug', slug.trim().toLowerCase())
      .maybeSingle();

    if (error) throw mapSupabaseError(error);
    return data ? mapCategoryRow(data) : null;
  }
}
