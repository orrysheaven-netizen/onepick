import { AppError } from '@/errors/appError';
import { selectableCategories } from '@/lib/categories/categoryTree';
import type { Category } from '@/types/domain/category';
import { canonicalProductName } from '@/lib/products/productIdentity';
import type {
  AdminBrandInput,
  AdminCategoryInput,
  AdminProductInput,
  AdminRepository,
} from '@/repositories/interfaces/adminRepository';
import type { ProfileRepository } from '@/repositories/interfaces/profileRepository';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

    const submitters = await Promise.all(
      pending.map(async (product) => ({
        product,
        submitter: product.createdBy ? await this.profileRepository.getById(product.createdBy) : null,
      })),
    );

    return {
      categories,
      brands,
      products,
      aliases,
      pending: submitters,
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
    await this.assertAdmin();
    return this.adminRepository.updateProduct(productId, { status: 'hidden', mergedIntoProductId: null });
  }

  private async assertAdmin() {
    if (!(await this.adminRepository.isAdmin())) throw new AppError('FORBIDDEN');
  }
}
