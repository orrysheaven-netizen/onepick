import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { AppError } from '@/errors/appError';
import type { ProductStatus } from '@/types/domain/product';
import type { ProductAlias } from '@/types/domain/productAlias';
import type { AdminAuditLog, ClientErrorEvent } from '@/types/domain/operations';
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

type ProductAliasRow = Database['public']['Tables']['product_aliases']['Row'];

function mapProductAlias(row: ProductAliasRow): ProductAlias {
  return {
    id: row.id,
    productId: row.product_id,
    alias: row.alias,
    normalizedAlias: row.normalized_alias,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAuditLog(row: any): AdminAuditLog {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    summary: row.summary && typeof row.summary === 'object' && !Array.isArray(row.summary) ? row.summary : {},
    createdAt: row.created_at,
  };
}

function mapClientErrorEvent(row: any): ClientErrorEvent {
  return {
    id: row.id,
    userId: row.user_id,
    context: row.context,
    errorCode: row.error_code,
    platform: row.platform,
    appVersion: row.app_version,
    createdAt: row.created_at,
  };
}

export class SupabaseAdminRepository implements AdminRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  private operationsTable(name: 'admin_audit_logs' | 'client_error_events') {
    return (this.client.from as unknown as (table: string) => any)(name);
  }

  async isAdmin() {
    const { data, error } = await this.client.rpc('current_user_is_admin');
    if (error) throw mapSupabaseError(error);
    return data === true;
  }

  async getOperationsMetrics() {
    const results = await Promise.all([
      this.client.from('profiles').select('id', { count: 'exact', head: true }),
      this.client.from('picks').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      this.client.from('comments').select('id', { count: 'exact', head: true }),
      this.client.from('products').select('id', { count: 'exact', head: true }).in('status', ['active', 'discontinued']),
      this.client.from('products').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      this.client.from('content_reports').select('id', { count: 'exact', head: true }).in('status', ['open', 'reviewing']),
    ]);

    for (const result of results) {
      if (result.error) throw mapSupabaseError(result.error);
    }

    return {
      profiles: results[0].count ?? 0,
      activePicks: results[1].count ?? 0,
      comments: results[2].count ?? 0,
      activeProducts: results[3].count ?? 0,
      pendingProducts: results[4].count ?? 0,
      openReports: results[5].count ?? 0,
    };
  }

  async getAuditLogs(limit = 80) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const { data, error } = await this.operationsTable('admin_audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(safeLimit);
    if (error) throw mapSupabaseError(error);
    return (data ?? []).map(mapAuditLog);
  }

  async getClientErrorEvents(limit = 80) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const { data, error } = await this.operationsTable('client_error_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(safeLimit);
    if (error) throw mapSupabaseError(error);
    return (data ?? []).map(mapClientErrorEvent);
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
    return data.map((row) => mapProductRow(row,
      row.image_path ? this.client.storage.from('product-photos').getPublicUrl(row.image_path).data.publicUrl : null,
      row.thumbnail_path ? this.client.storage.from('product-photos').getPublicUrl(row.thumbnail_path).data.publicUrl : null));
  }

  async getPendingProducts() {
    const { data, error } = await this.client.from('products').select('*')
      .eq('status', 'pending').order('created_at', { ascending: true }).limit(500);
    if (error) throw mapSupabaseError(error);
    return data.map((row) => mapProductRow(row,
      row.image_path ? this.client.storage.from('product-photos').getPublicUrl(row.image_path).data.publicUrl : null,
      row.thumbnail_path ? this.client.storage.from('product-photos').getPublicUrl(row.thumbnail_path).data.publicUrl : null));
  }

  async getProductById(productId: string) {
    const { data, error } = await this.client.from('products').select('*').eq('id', productId).maybeSingle();
    if (error) throw mapSupabaseError(error);
    return data ? mapProductRow(data) : null;
  }

  async getProductAliases(limit = 1000) {
    const safeLimit = Math.min(Math.max(limit, 1), 2000);
    const { data, error } = await this.client
      .from('product_aliases')
      .select('*')
      .order('alias', { ascending: true })
      .limit(safeLimit);
    if (error) throw mapSupabaseError(error);
    return data.map(mapProductAlias);
  }

  async createProductAlias(productId: string, alias: string) {
    const { data, error } = await this.client
      .from('product_aliases')
      .insert({ product_id: productId, alias, normalized_alias: alias.toLowerCase().replace(/\s+/g, '') })
      .select('*')
      .single();
    if (error) throw mapSupabaseError(error);
    return mapProductAlias(data);
  }

  async removeProductAlias(aliasId: string) {
    const { error } = await this.client.from('product_aliases').delete().eq('id', aliasId);
    if (error) throw mapSupabaseError(error);
  }

  async createCategory(input: AdminCategoryInput) {
    const { data, error } = await this.client
      .from('categories')
      .insert({
        name: input.name, slug: input.slug, parent_id: input.parentId ?? null,
        status: input.status ?? 'draft', is_visible: input.isVisible ?? false,
        is_pickable: input.isPickable ?? false, sort_order: input.sortOrder ?? 0,
        ranking_min_sample: input.rankingMinSample ?? 20,
      }).select('*').single();
    if (error) throw mapSupabaseError(error);
    return mapCategoryRow(data);
  }

  async updateCategory(categoryId: string, input: Partial<AdminCategoryInput>) {
    const patch: Database['public']['Tables']['categories']['Update'] = {};
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
    const patch: Database['public']['Tables']['brands']['Update'] = {};
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

  async updateProduct(productId: string, input: AdminProductUpdateInput & { normalizedName?: string }, expectedStatus?: ProductStatus) {
    const patch: Database['public']['Tables']['products']['Update'] = {};
    if (input.categoryId !== undefined) patch.category_id = input.categoryId;
    if (input.brandId !== undefined) patch.brand_id = input.brandId;
    if (input.name !== undefined) patch.name = input.name;
    if (input.normalizedName !== undefined) patch.normalized_name = input.normalizedName;
    if (input.modelCode !== undefined) patch.model_code = input.modelCode;
    if (input.officialUrl !== undefined) patch.official_url = input.officialUrl;
    if (input.status !== undefined) patch.status = input.status;
    if (input.mergedIntoProductId !== undefined) patch.merged_into_product_id = input.mergedIntoProductId;

    let query = this.client.from('products').update(patch).eq('id', productId);
    if (expectedStatus) query = query.eq('status', expectedStatus);
    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('PICK_CONFLICT');
    return mapProductRow(data);
  }
}
