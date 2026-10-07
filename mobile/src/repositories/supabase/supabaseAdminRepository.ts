import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { AppError } from '@/errors/appError';
import type { ItemStatus } from '@/types/domain/item';
import type { ItemAlias } from '@/types/domain/itemAlias';
import type { AdminAuditLog, AdminOperationsSnapshot, ClientErrorEvent } from '@/types/domain/operations';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type {
  AdminBrandInput,
  AdminCategoryInput,
  AdminItemInput,
  AdminItemUpdateInput,
  AdminRepository,
} from '@/repositories/interfaces/adminRepository';
import { mapBrandRow } from '@/repositories/mappers/brandMapper';
import { mapCategoryRow } from '@/repositories/mappers/categoryMapper';
import { mapItemRow } from '@/repositories/mappers/itemMapper';

type ItemAliasRow = Database['public']['Tables']['item_aliases']['Row'];

function mapItemAlias(row: ItemAliasRow): ItemAlias {
  return {
    id: row.id,
    itemId: row.item_id,
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

  async getHomeDailyQuestionCategoryId() {
    const { data, error } = await this.client.from('home_settings')
      .select('daily_question_category_id').eq('id', true).single();
    if (error) throw mapSupabaseError(error);
    return data.daily_question_category_id;
  }

  async setHomeDailyQuestionCategoryId(categoryId: string | null) {
    const { data, error } = await this.client.from('home_settings')
      .update({ daily_question_category_id: categoryId }).eq('id', true)
      .select('daily_question_category_id').single();
    if (error) throw mapSupabaseError(error);
    return data.daily_question_category_id;
  }

  async getHomeMinimumPickCount() {
    const { data, error } = await this.client.from('home_settings').select('minimum_pick_count').eq('id', true).single();
    if (error) throw mapSupabaseError(error);
    return data.minimum_pick_count;
  }

  async setHomeMinimumPickCount(count: number) {
    const { data, error } = await this.client.from('home_settings').update({ minimum_pick_count: count })
      .eq('id', true).select('minimum_pick_count').single();
    if (error) throw mapSupabaseError(error);
    return data.minimum_pick_count;
  }

  private operationsTable(name: 'admin_audit_logs' | 'client_error_events') {
    return (this.client.from as unknown as (table: string) => any)(name);
  }

  async isAdmin() {
    const { data, error } = await this.client.rpc('current_user_is_admin');
    if (error) throw mapSupabaseError(error);
    return data === true;
  }

  async getOperationsSnapshot(days = 7): Promise<AdminOperationsSnapshot> {
    const rpc = this.client.rpc as unknown as (name: string, params?: Record<string, unknown>) => Promise<{ data: any; error: any }>;
    const { data, error } = await rpc('admin_operations_snapshot', { p_days: days });
    if (error) throw mapSupabaseError(error);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError('INTERNAL_ERROR');

    const metrics = data.metrics ?? {};
    const funnel = data.funnel ?? {};
    return {
      metrics: {
        profiles: Number(metrics.profiles ?? 0),
        activePicks: Number(metrics.active_picks ?? 0),
        comments: Number(metrics.comments ?? 0),
        activeItems: Number(metrics.active_items ?? 0),
        pendingItems: Number(metrics.pending_items ?? 0),
        openReports: Number(metrics.open_reports ?? 0),
      },
      funnel: {
        days: Number(funnel.days ?? days),
        pickCreated: Number(funnel.pick_created ?? 0),
        pickShareClicked: Number(funnel.pick_share_clicked ?? 0),
        pickLinkOpened: Number(funnel.pick_link_opened ?? 0),
        itemDetailViewed: Number(funnel.item_detail_viewed ?? 0),
        authStarted: Number(funnel.auth_started ?? 0),
        authCompleted: Number(funnel.auth_completed ?? 0),
      },
      generatedAt: typeof data.generated_at === 'string' ? data.generated_at : new Date(0).toISOString(),
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

  async getItems(limit = 300) {
    const safeLimit = Math.min(Math.max(limit, 1), 1000);
    const { data, error } = await this.client
      .from('items')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(safeLimit);
    if (error) throw mapSupabaseError(error);
    return data.map((row) => mapItemRow(row,
      row.image_path ? this.client.storage.from('item-photos').getPublicUrl(row.image_path).data.publicUrl : null,
      row.thumbnail_path ? this.client.storage.from('item-photos').getPublicUrl(row.thumbnail_path).data.publicUrl : null));
  }

  async getPendingItems() {
    const { data, error } = await this.client.from('items').select('*')
      .eq('status', 'pending').order('created_at', { ascending: true }).limit(500);
    if (error) throw mapSupabaseError(error);
    return data.map((row) => mapItemRow(row,
      row.image_path ? this.client.storage.from('item-photos').getPublicUrl(row.image_path).data.publicUrl : null,
      row.thumbnail_path ? this.client.storage.from('item-photos').getPublicUrl(row.thumbnail_path).data.publicUrl : null));
  }

  async getItemById(itemId: string) {
    const { data, error } = await this.client.from('items').select('*').eq('id', itemId).maybeSingle();
    if (error) throw mapSupabaseError(error);
    return data ? mapItemRow(data) : null;
  }

  async getItemAliases(limit = 1000) {
    const safeLimit = Math.min(Math.max(limit, 1), 2000);
    const { data, error } = await this.client
      .from('item_aliases')
      .select('*')
      .order('alias', { ascending: true })
      .limit(safeLimit);
    if (error) throw mapSupabaseError(error);
    return data.map(mapItemAlias);
  }

  async createItemAlias(itemId: string, alias: string) {
    const { data, error } = await this.client
      .from('item_aliases')
      .insert({ item_id: itemId, alias, normalized_alias: alias.toLowerCase().replace(/\s+/g, '') })
      .select('*')
      .single();
    if (error) throw mapSupabaseError(error);
    return mapItemAlias(data);
  }

  async removeItemAlias(aliasId: string) {
    const { error } = await this.client.from('item_aliases').delete().eq('id', aliasId);
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

  async createItem(input: AdminItemInput & { normalizedName: string; createdBy?: string | null }) {
    const { data: authData } = await this.client.auth.getUser();
    const { data, error } = await this.client
      .from('items')
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
    return mapItemRow(data);
  }

  async updateItem(itemId: string, input: AdminItemUpdateInput & { normalizedName?: string }, expectedStatus?: ItemStatus) {
    const patch: Database['public']['Tables']['items']['Update'] = {};
    if (input.categoryId !== undefined) patch.category_id = input.categoryId;
    if (input.brandId !== undefined) patch.brand_id = input.brandId;
    if (input.name !== undefined) patch.name = input.name;
    if (input.normalizedName !== undefined) patch.normalized_name = input.normalizedName;
    if (input.modelCode !== undefined) patch.model_code = input.modelCode;
    if (input.officialUrl !== undefined) patch.official_url = input.officialUrl;
    if (input.status !== undefined) patch.status = input.status;
    if (input.mergedIntoItemId !== undefined) patch.merged_into_item_id = input.mergedIntoItemId;

    let query = this.client.from('items').update(patch).eq('id', itemId);
    if (expectedStatus) query = query.eq('status', expectedStatus);
    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('PICK_CONFLICT');
    return mapItemRow(data);
  }
}

