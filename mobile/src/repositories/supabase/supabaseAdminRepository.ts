import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type {
  AdminBrandInput,
  AdminCategoryInput,
  AdminProductInput,
  AdminProductUpdateInput,
  AdminRepository,
} from '@/repositories/interfaces/adminRepository';
import { mapBrandRow } from '@/repositories/mappers/brandMapper';
import { mapCategoryRow } from '@/repositories/mappers/categoryMapper';
import { mapProductRow } from '@/repositories/mappers/productMapper';

type RpcResult<T> = Promise<{ data: T | null; error: { code?: string; message?: string; details?: string; hint?: string } | null }>;
type CategoryUpdate = Database['public']['Tables']['categories']['Update'];
type BrandUpdate = Database['public']['Tables']['brands']['Update'];
type ProductUpdate = Database['public']['Tables']['products']['Update'];

export class SupabaseAdminRepository implements AdminRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async isAdmin() {
    const rpc = this.client.rpc as unknown as (fn: string) => RpcResult<boolean>;
    const { data, error } = await rpc('current_user_is_admin');
    if (error) throw mapSupabaseError(error);
    return data === true;
  }

  async getCategories() {
    const { data, error } = await this.client
      .from('categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw mapSupabaseError(error);
    return data.map(mapCategoryRow);
  }

  async getBrands() {
    const { data, error } = await this.client
      .from('brands')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw mapSupabaseError(error);
    return data.map(mapBrandRow);
  }

  async getProducts(limit = 300) {
    const safeLimit = Math.min(Math.max(limit, 1), 1000);
    const { data, error } = await this.client
      .from('products')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(safeLimit);
    if (error) throw mapSupabaseError(error);
    return data.map((row) => mapProductRow(row));
  }

  async createCategory(input: AdminCategoryInput) {
    const { data, error } = await this.client
      .from('categories')
      .insert({
        name: input.name,
        slug: input.slug,
        parent_id: input.parentId ?? null,
        status: input.status ?? 'draft',
        is_visible: input.isVisible ?? false,
        is_pickable: input.isPickable ?? false,
        sort_order: input.sortOrder ?? 0,
        ranking_min_sample: input.rankingMinSample ?? 20,
      })
      .select('*')
      .single();
    if (error) throw mapSupabaseError(error);
    return mapCategoryRow(data);
  }

  async updateCategory(categoryId: string, input: Partial<AdminCategoryInput>) {
    const patch: CategoryUpdate = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.parentId !== undefined) patch.parent_id = input.parentId;
    if (input.status !== undefined) patch.status = input.status;
    if (input.isVisible !== undefined) patch.is_visible = input.isVisible;
    if (input.isPickable !== undefined) patch.is_pickable = input.isPickable;
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
    if (input.rankingMinSample !== undefined) patch.ranking_min_sample = input.rankingMinSample;

    const { data, error } = await this.client
      .from('categories')
      .update(patch)
      .eq('id', categoryId)
      .select('*')
      .single();
    if (error) throw mapSupabaseError(error);
    return mapCategoryRow(data);
  }

  async createBrand(input: AdminBrandInput) {
    const normalizedName = input.name.trim().toLowerCase().replace(/\s+/g, '');
    const { data, error } = await this.client
      .from('brands')
      .insert({
        name: input.name,
        normalized_name: normalizedName,
        slug: input.slug ?? null,
        logo_url: input.logoUrl ?? null,
        is_active: input.isActive ?? true,
      })
      .select('*')
      .single();
    if (error) throw mapSupabaseError(error);
    return mapBrandRow(data);
  }

  async updateBrand(brandId: string, input: Partial<AdminBrandInput>) {
    const patch: BrandUpdate = {};
    if (input.name !== undefined) {
      patch.name = input.name;
      patch.normalized_name = input.name.trim().toLowerCase().replace(/\s+/g, '');
    }
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.logoUrl !== undefined) patch.logo_url = input.logoUrl;
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    const { data, error } = await this.client
      .from('brands')
      .update(patch)
      .eq('id', brandId)
      .select('*')
      .single();
    if (error) throw mapSupabaseError(error);
    return mapBrandRow(data);
  }

  async createProduct(input: AdminProductInput & { normalizedName: string; createdBy?: string | null }) {
    const { data: authData } = await this.client.auth.getUser();
    const { data, error } = await this.client
      .from('products')
      .insert({
        category_id: input.categoryId,
        brand_id: input.brandId ?? null,
        name: input.name,
        normalized_name: input.normalizedName,
        model_code: input.modelCode ?? null,
        official_url: input.officialUrl ?? null,
        status: input.status ?? 'active',
        created_by: input.createdBy ?? authData.user?.id ?? null,
      })
      .select('*')
      .single();
    if (error) throw mapSupabaseError(error);
    return mapProductRow(data);
  }

  async updateProduct(productId: string, input: AdminProductUpdateInput & { normalizedName?: string }) {
    const patch: ProductUpdate = {};
    if (input.categoryId !== undefined) patch.category_id = input.categoryId;
    if (input.brandId !== undefined) patch.brand_id = input.brandId;
    if (input.name !== undefined) patch.name = input.name;
    if (input.normalizedName !== undefined) patch.normalized_name = input.normalizedName;
    if (input.modelCode !== undefined) patch.model_code = input.modelCode;
    if (input.officialUrl !== undefined) patch.official_url = input.officialUrl;
    if (input.status !== undefined) patch.status = input.status;
    if (input.mergedIntoProductId !== undefined) patch.merged_into_product_id = input.mergedIntoProductId;

    const { data, error } = await this.client
      .from('products')
      .update(patch)
      .eq('id', productId)
      .select('*')
      .single();
    if (error) throw mapSupabaseError(error);
    return mapProductRow(data);
  }
}
