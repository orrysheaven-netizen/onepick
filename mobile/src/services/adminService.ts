import { AppError } from '@/errors/appError';
import { selectableCategories } from '@/lib/categories/categoryTree';
import type { Category } from '@/types/domain/category';
import type { ProductStatus } from '@/types/domain/product';
import { canonicalProductName } from '@/lib/products/productIdentity';
import type {
  AdminBrandInput,
  AdminCategoryInput,
  AdminProductInput,
  AdminRepository,
} from '@/repositories/interfaces/adminRepository';
import type { ProfileRepository } from '@/repositories/interfaces/profileRepository';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MANAGED_PRODUCT_STATUSES = new Set<ProductStatus>(['active', 'discontinued', 'hidden']);

function cleanName(value: string, max = 100) {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > max) throw new AppError('PRODUCT_NAME_INVALID');
  return name;
}

function normalizeProductName(value: string) {
  return value.toLowerCase().replace(/\s+/g, '');
}

function cleanAlias(value: string) {
  const alias = value.trim().replace(/\s+/g, ' ');
  if (!alias || alias.length > 100) throw new AppError('PRODUCT_ALIAS_INVALID');
  return alias;
}

export class AdminService {
  constructor(
    private readonly adminRepository: AdminRepository,
    private readonly profileRepository: ProfileRepository,
  ) {}

  isAdmin() { return this.adminRepository.isAdmin(); }

  private validateCategory(input: AdminCategoryInput, categories: Category[], id?: string) {
    const invalid = () => { throw new AppError('CATEGORY_INVALID'); };
    if (!input.name.trim() || input.name.trim().length > 60 || !SLUG_PATTERN.test(input.slug) || input.slug.length > 80) invalid();
    if (input.sortOrder !== undefined && (!Number.isInteger(input.sortOrder) || Math.abs(input.sortOrder) > 100000)) invalid();
    if (input.rankingMinSample !== undefined && (!Number.isInteger(input.rankingMinSample) || input.rankingMinSample < 1)) invalid();
    const children = id ? categories.filter((item) => item.parentId === id) : [];
    if (input.isPickable && children.length) invalid();
    if (input.parentId) {
      const parent = categories.find((item) => item.id === input.parentId);
      if (!parent || parent.id === id || parent.parentId || parent.isPickable || children.length) invalid();
    }
  }

  async getDashboard() {
    await this.assertAdmin();
    const [categories, brands, products, pending, aliases] = await Promise.all([
      this.adminRepository.getCategories(),
      this.adminRepository.getBrands(),
      this.adminRepository.getProducts(500),
      this.adminRepository.getPendingProducts(),
      this.adminRepository.getProductAliases(2000),
    ]);

    const profiles = await this.profileRepository.getByIds(
      pending.flatMap((product) => product.createdBy ? [product.createdBy] : []),
    );
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    const submitters = pending.map((product) => ({
      product,
      submitter: product.createdBy ? profilesById.get(product.createdBy) ?? null : null,
    }));

    return { categories, brands, products, aliases, pending: submitters };
  }

  async getOperationsOverview() {
    await this.assertAdmin();
    const [metrics, auditLogs, errorEvents] = await Promise.all([
      this.adminRepository.getOperationsMetrics(),
      this.adminRepository.getAuditLogs(80),
      this.adminRepository.getClientErrorEvents(80),
    ]);

    const errorCounts = new Map<string, number>();
    for (const event of errorEvents) {
      errorCounts.set(event.errorCode, (errorCounts.get(event.errorCode) ?? 0) + 1);
    }

    return {
      metrics,
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

  async createProduct(input: AdminProductInput) {
    await this.assertAdmin();
    const categories = await this.adminRepository.getCategories();
    const category = selectableCategories(categories).find((item) => item.id === input.categoryId);
    if (!category) throw new AppError('CATEGORY_NOT_FOUND');
    const name = canonicalProductName(cleanName(input.name), category.slug);

    return this.adminRepository.createProduct({
      ...input,
      name,
      normalizedName: normalizeProductName(name),
      status: input.status ?? 'active',
    });
  }

  async updateProduct(productId: string, input: Partial<AdminProductInput>) {
    await this.assertAdmin();
    const [product, categories] = await Promise.all([
      this.adminRepository.getProductById(productId),
      this.adminRepository.getCategories(),
    ]);
    if (!product) throw new AppError('PRODUCT_NOT_FOUND');
    if (!MANAGED_PRODUCT_STATUSES.has(product.status)) throw new AppError('PICK_CONFLICT');
    if (input.categoryId !== undefined && input.categoryId !== product.categoryId) {
      throw new AppError('PRODUCT_CATEGORY_MISMATCH');
    }

    const status = input.status ?? product.status;
    if (!MANAGED_PRODUCT_STATUSES.has(status)) throw new AppError('PRODUCT_NOT_ELIGIBLE');
    const category = categories.find((item) => item.id === product.categoryId);
    if (!category) throw new AppError('CATEGORY_NOT_FOUND');
    if (status !== 'hidden' && !selectableCategories(categories).some((item) => item.id === product.categoryId)) {
      throw new AppError('CATEGORY_NOT_PICKABLE');
    }

    const name = canonicalProductName(cleanName(input.name ?? product.name), category.slug);
    return this.adminRepository.updateProduct(productId, {
      ...input,
      categoryId: product.categoryId,
      name,
      normalizedName: normalizeProductName(name),
      status,
      mergedIntoProductId: null,
    }, product.status);
  }

  async addProductAlias(productId: string, value: string) {
    await this.assertAdmin();
    const alias = cleanAlias(value);
    const product = await this.adminRepository.getProductById(productId);
    if (!product) throw new AppError('PRODUCT_NOT_FOUND');
    if (!['active', 'discontinued'].includes(product.status)) throw new AppError('PRODUCT_NOT_ELIGIBLE');
    if (normalizeProductName(alias) === product.normalizedName) throw new AppError('PRODUCT_ALIAS_REDUNDANT');
    return this.adminRepository.createProductAlias(productId, alias);
  }

  async removeProductAlias(aliasId: string) {
    await this.assertAdmin();
    return this.adminRepository.removeProductAlias(aliasId);
  }

  async approveProduct(productId: string, edits?: Partial<AdminProductInput>) {
    await this.assertAdmin();
    const product = await this.adminRepository.getProductById(productId);
    if (!product) throw new AppError('PRODUCT_NOT_FOUND');
    if (product.status !== 'pending') throw new AppError('PICK_CONFLICT');

    const categories = await this.adminRepository.getCategories();
    const categoryId = edits?.categoryId ?? product.categoryId;
    const category = selectableCategories(categories).find((item) => item.id === categoryId);
    if (!category) throw new AppError('CATEGORY_NOT_FOUND');
    const name = canonicalProductName(cleanName(edits?.name ?? product.name), category.slug);

    return this.adminRepository.updateProduct(productId, {
      ...edits,
      categoryId,
      name,
      normalizedName: normalizeProductName(name),
      mergedIntoProductId: null,
      status: 'active',
    }, 'pending');
  }

  async rejectProduct(productId: string) {
    await this.assertAdmin();
    return this.adminRepository.updateProduct(productId, {
      status: 'rejected',
      mergedIntoProductId: null,
    }, 'pending');
  }

  async mergeProduct(productId: string, targetProductId: string) {
    await this.assertAdmin();
    if (productId === targetProductId) throw new AppError('PICK_CONFLICT', 'PRODUCT_MERGE_SELF');
    const [product, target] = await Promise.all([
      this.adminRepository.getProductById(productId), this.adminRepository.getProductById(targetProductId),
    ]);
    if (!product || product.status !== 'pending') throw new AppError('PICK_CONFLICT');
    if (!target || target.categoryId !== product.categoryId || !['active', 'discontinued'].includes(target.status)) throw new AppError('PRODUCT_NOT_ELIGIBLE');

    return this.adminRepository.updateProduct(productId, {
      status: 'merged',
      mergedIntoProductId: target.id,
    }, 'pending');
  }

  async hideProduct(productId: string) {
    return this.updateProduct(productId, { status: 'hidden' });
  }

  private async assertAdmin() {
    if (!(await this.adminRepository.isAdmin())) throw new AppError('FORBIDDEN');
  }
}
