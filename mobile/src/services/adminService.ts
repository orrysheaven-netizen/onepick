import { AppError } from '@/errors/appError';
import { categoryRootSlug, selectableCategories } from '@/lib/categories/categoryTree';
import type { Category } from '@/types/domain/category';
import type { ItemStatus } from '@/types/domain/item';
import { canonicalItemName } from '@/lib/items/itemIdentity';
import type {
  AdminBrandInput,
  AdminCategoryInput,
  AdminItemInput,
  AdminRepository,
} from '@/repositories/interfaces/adminRepository';
import type { ProfileRepository } from '@/repositories/interfaces/profileRepository';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MANAGED_ITEM_STATUSES = new Set<ItemStatus>(['active', 'discontinued', 'hidden']);

function cleanName(value: string, max = 100) {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > max) throw new AppError('ITEM_NAME_INVALID');
  return name;
}

function normalizeItemName(value: string) {
  return value.toLowerCase().replace(/\s+/g, '');
}

function cleanAlias(value: string) {
  const alias = value.trim().replace(/\s+/g, ' ');
  if (!alias || alias.length > 100) throw new AppError('ITEM_ALIAS_INVALID');
  return alias;
}

export class AdminService {
  constructor(
    private readonly adminRepository: AdminRepository,
    private readonly profileRepository: ProfileRepository,
  ) {}

  isAdmin() { return this.adminRepository.isAdmin(); }

  async getHomeDailyQuestionSettings() {
    await this.assertAdmin();
    const [categoryId, categories] = await Promise.all([
      this.adminRepository.getHomeDailyQuestionCategoryId(),
      this.adminRepository.getCategories(),
    ]);
    return { categoryId, categories };
  }

  async setHomeDailyQuestionCategoryId(categoryId: string | null) {
    await this.assertAdmin();
    if (categoryId !== null) {
      const categories = await this.adminRepository.getCategories();
      const category = selectableCategories(categories).find((item) => item.id === categoryId);
      if (!category || categoryRootSlug(category, categories) !== 'food') {
        throw new RangeError('HOME_DAILY_QUESTION_CATEGORY_INVALID');
      }
    }
    // The existing database trigger and admin AAL2 RLS remain authoritative.
    return this.adminRepository.setHomeDailyQuestionCategoryId(categoryId);
  }

  async getHomeMinimumPickCount() {
    await this.assertAdmin();
    return this.adminRepository.getHomeMinimumPickCount();
  }

  async setHomeMinimumPickCount(count: number) {
    await this.assertAdmin();
    if (!Number.isInteger(count) || count < 1 || count > 100000) throw new RangeError('HOME_THRESHOLD_INVALID');
    return this.adminRepository.setHomeMinimumPickCount(count);
  }

  private validateCategory(input: AdminCategoryInput, categories: Category[], id?: string) {
    const invalid = () => { throw new AppError('CATEGORY_INVALID'); };
    if (!input.name.trim() || input.name.trim().length > 60 || !SLUG_PATTERN.test(input.slug) || input.slug.length > 80) invalid();
    if (input.sortOrder !== undefined && (!Number.isInteger(input.sortOrder) || Math.abs(input.sortOrder) > 100000)) invalid();
    if (input.rankingMinSample !== undefined && (!Number.isInteger(input.rankingMinSample) || input.rankingMinSample < 1)) invalid();

    const childrenByParent = new Map<string, Category[]>();
    for (const category of categories) {
      if (!category.parentId) continue;
      const siblings = childrenByParent.get(category.parentId) ?? [];
      siblings.push(category);
      childrenByParent.set(category.parentId, siblings);
    }
    const children = id ? childrenByParent.get(id) ?? [] : [];
    if (input.isPickable && children.length) invalid();

    let parentDepth = 0;
    if (input.parentId) {
      const byId = new Map(categories.map((category) => [category.id, category]));
      let parent = byId.get(input.parentId);
      const seen = new Set<string>();
      while (parent) {
        if (parent.id === id || seen.has(parent.id) || parent.isPickable) invalid();
        seen.add(parent.id);
        parentDepth += 1;
        if (parentDepth >= 3) invalid();
        if (!parent.parentId) break;
        parent = byId.get(parent.parentId);
        if (!parent) invalid();
      }
      if (!parent) invalid();
    }

    if (id && children.length) {
      let descendantSpan = 0;
      const queue = children.map((child) => ({ child, depth: 1 }));
      const seen = new Set<string>();
      while (queue.length) {
        const current = queue.shift()!;
        if (seen.has(current.child.id)) invalid();
        seen.add(current.child.id);
        descendantSpan = Math.max(descendantSpan, current.depth);
        for (const child of childrenByParent.get(current.child.id) ?? []) {
          queue.push({ child, depth: current.depth + 1 });
        }
      }
      if (parentDepth + 1 + descendantSpan > 3) invalid();
    }
  }

  async getDashboard() {
    await this.assertAdmin();
    const [categories, brands, items, pending, aliases] = await Promise.all([
      this.adminRepository.getCategories(),
      this.adminRepository.getBrands(),
      this.adminRepository.getItems(500),
      this.adminRepository.getPendingItems(),
      this.adminRepository.getItemAliases(2000),
    ]);

    const profiles = await this.profileRepository.getByIds(
      pending.flatMap((item) => item.createdBy ? [item.createdBy] : []),
    );
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    const submitters = pending.map((item) => ({
      item,
      submitter: item.createdBy ? profilesById.get(item.createdBy) ?? null : null,
    }));

    return { categories, brands, items, aliases, pending: submitters };
  }

  async getOperationsOverview() {
    await this.assertAdmin();
    const [snapshot, auditLogs, errorEvents] = await Promise.all([
      this.adminRepository.getOperationsSnapshot(7),
      this.adminRepository.getAuditLogs(80),
      this.adminRepository.getClientErrorEvents(80),
    ]);

    const errorCounts = new Map<string, number>();
    for (const event of errorEvents) {
      errorCounts.set(event.errorCode, (errorCounts.get(event.errorCode) ?? 0) + 1);
    }

    return {
      metrics: snapshot.metrics,
      funnel: snapshot.funnel,
      generatedAt: snapshot.generatedAt,
      auditLogs,
      errorEvents,
      errorSummary: [...errorCounts.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    };
  }

  async createCategory(input: AdminCategoryInput) {
    await this.assertAdmin();
    const name = cleanName(input.name, 60);
    const slug = input.slug.trim().toLowerCase();
    this.validateCategory({ ...input, name, slug }, await this.adminRepository.getCategories());
    return this.adminRepository.createCategory({ ...input, name, slug });
  }

  async updateCategory(categoryId: string, input: Partial<AdminCategoryInput>) {
    await this.assertAdmin();
    const patch = { ...input };
    if (input.name !== undefined) patch.name = cleanName(input.name, 60);
    if (input.slug !== undefined) patch.slug = input.slug.trim().toLowerCase();
    const categories = await this.adminRepository.getCategories();
    const current = categories.find((item) => item.id === categoryId);
    if (!current) throw new AppError('CATEGORY_NOT_FOUND');
    if (patch.slug !== undefined && patch.slug !== current.slug) throw new AppError('CATEGORY_INVALID');
    this.validateCategory({ ...current, ...patch }, categories, categoryId);
    return this.adminRepository.updateCategory(categoryId, patch);
  }

  async createBrand(input: AdminBrandInput) {
    await this.assertAdmin();
    return this.adminRepository.createBrand({
      ...input,
      name: cleanName(input.name, 80),
      slug: input.slug?.trim().toLowerCase() || null,
    });
  }

  async updateBrand(brandId: string, input: Partial<AdminBrandInput>) {
    await this.assertAdmin();
    return this.adminRepository.updateBrand(brandId, {
      ...input,
      ...(input.name !== undefined ? { name: cleanName(input.name, 80) } : {}),
      ...(input.slug !== undefined ? { slug: input.slug?.trim().toLowerCase() || null } : {}),
    });
  }

  async createItem(input: AdminItemInput) {
    await this.assertAdmin();
    const categories = await this.adminRepository.getCategories();
    const category = selectableCategories(categories).find((item) => item.id === input.categoryId);
    if (!category) throw new AppError('CATEGORY_NOT_FOUND');
    const name = canonicalItemName(cleanName(input.name), category.slug);

    return this.adminRepository.createItem({
      ...input,
      name,
      normalizedName: normalizeItemName(name),
      status: input.status ?? 'active',
    });
  }

  async updateItem(itemId: string, input: Partial<AdminItemInput>) {
    await this.assertAdmin();
    const [item, categories] = await Promise.all([
      this.adminRepository.getItemById(itemId),
      this.adminRepository.getCategories(),
    ]);
    if (!item) throw new AppError('ITEM_NOT_FOUND');
    if (!MANAGED_ITEM_STATUSES.has(item.status)) throw new AppError('PICK_CONFLICT');
    if (input.categoryId !== undefined && input.categoryId !== item.categoryId) {
      throw new AppError('ITEM_CATEGORY_MISMATCH');
    }

    const status = input.status ?? item.status;
    if (!MANAGED_ITEM_STATUSES.has(status)) throw new AppError('ITEM_NOT_ELIGIBLE');
    const category = categories.find((category) => category.id === item.categoryId);
    if (!category) throw new AppError('CATEGORY_NOT_FOUND');
    if (status !== 'hidden' && !selectableCategories(categories).some((category) => category.id === item.categoryId)) {
      throw new AppError('CATEGORY_NOT_PICKABLE');
    }

    const name = canonicalItemName(cleanName(input.name ?? item.name), category.slug);
    return this.adminRepository.updateItem(itemId, {
      ...input,
      categoryId: item.categoryId,
      name,
      normalizedName: normalizeItemName(name),
      status,
      mergedIntoItemId: null,
    }, item.status);
  }

  async addItemAlias(itemId: string, value: string) {
    await this.assertAdmin();
    const alias = cleanAlias(value);
    const item = await this.adminRepository.getItemById(itemId);
    if (!item) throw new AppError('ITEM_NOT_FOUND');
    if (!['active', 'discontinued'].includes(item.status)) throw new AppError('ITEM_NOT_ELIGIBLE');
    if (normalizeItemName(alias) === item.normalizedName) throw new AppError('ITEM_ALIAS_REDUNDANT');
    return this.adminRepository.createItemAlias(itemId, alias);
  }

  async removeItemAlias(aliasId: string) {
    await this.assertAdmin();
    return this.adminRepository.removeItemAlias(aliasId);
  }

  async approveItem(itemId: string, edits?: Partial<AdminItemInput>) {
    await this.assertAdmin();
    const item = await this.adminRepository.getItemById(itemId);
    if (!item) throw new AppError('ITEM_NOT_FOUND');
    if (item.status !== 'pending') throw new AppError('PICK_CONFLICT');

    const categories = await this.adminRepository.getCategories();
    const categoryId = edits?.categoryId ?? item.categoryId;
    const category = selectableCategories(categories).find((item) => item.id === categoryId);
    if (!category) throw new AppError('CATEGORY_NOT_FOUND');
    const name = canonicalItemName(cleanName(edits?.name ?? item.name), category.slug);

    return this.adminRepository.updateItem(itemId, {
      ...edits,
      categoryId,
      name,
      normalizedName: normalizeItemName(name),
      mergedIntoItemId: null,
      status: 'active',
    }, 'pending');
  }

  async rejectItem(itemId: string) {
    await this.assertAdmin();
    return this.adminRepository.updateItem(itemId, {
      status: 'rejected',
      mergedIntoItemId: null,
    }, 'pending');
  }

  async mergeItem(itemId: string, targetItemId: string) {
    await this.assertAdmin();
    if (itemId === targetItemId) throw new AppError('PICK_CONFLICT', 'ITEM_MERGE_SELF');
    const [item, target] = await Promise.all([
      this.adminRepository.getItemById(itemId), this.adminRepository.getItemById(targetItemId),
    ]);
    if (!item || item.status !== 'pending') throw new AppError('PICK_CONFLICT');
    if (!target || target.categoryId !== item.categoryId || !['active', 'discontinued'].includes(target.status)) throw new AppError('ITEM_NOT_ELIGIBLE');

    return this.adminRepository.updateItem(itemId, {
      status: 'merged',
      mergedIntoItemId: target.id,
    }, 'pending');
  }

  async hideItem(itemId: string) {
    return this.updateItem(itemId, { status: 'hidden' });
  }

  private async assertAdmin() {
    if (!(await this.adminRepository.isAdmin())) throw new AppError('FORBIDDEN');
  }
}

