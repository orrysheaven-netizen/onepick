import { AppError } from '@/errors/appError';
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

export class AdminService {
  constructor(
    private readonly adminRepository: AdminRepository,
    private readonly profileRepository: ProfileRepository,
  ) {}

  async getDashboard() {
    await this.assertAdmin();
    const [categories, brands, products] = await Promise.all([
      this.adminRepository.getCategories(),
      this.adminRepository.getBrands(),
      this.adminRepository.getProducts(500),
    ]);

    const pending = products.filter((product) => product.status === 'pending');
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
      pending: submitters,
    };
  }

  async createCategory(input: AdminCategoryInput) {
    await this.assertAdmin();
    const name = cleanName(input.name, 60);
    const slug = input.slug.trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) throw new AppError('INTERNAL_ERROR', 'CATEGORY_SLUG_INVALID');

    return this.adminRepository.createCategory({
      ...input,
      name,
      slug,
    });
  }

  async updateCategory(categoryId: string, input: Partial<AdminCategoryInput>) {
    await this.assertAdmin();
    const patch = { ...input };
    if (input.name !== undefined) patch.name = cleanName(input.name, 60);
    if (input.slug !== undefined) {
      const slug = input.slug.trim().toLowerCase();
      if (!SLUG_PATTERN.test(slug)) throw new AppError('INTERNAL_ERROR', 'CATEGORY_SLUG_INVALID');
      patch.slug = slug;
    }
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
    const category = categories.find((item) => item.id === input.categoryId);
    if (!category) throw new AppError('CATEGORY_NOT_FOUND');
    const name = canonicalProductName(cleanName(input.name), category.slug);

    return this.adminRepository.createProduct({
      ...input,
      name,
      normalizedName: normalizeProductName(name),
      status: input.status ?? 'active',
    });
  }

  async approveProduct(productId: string, edits?: Partial<AdminProductInput>) {
    await this.assertAdmin();
    const products = await this.adminRepository.getProducts(1000);
    const product = products.find((item) => item.id === productId);
    if (!product) throw new AppError('PRODUCT_NOT_FOUND');

    const categories = await this.adminRepository.getCategories();
    const categoryId = edits?.categoryId ?? product.categoryId;
    const category = categories.find((item) => item.id === categoryId);
    if (!category) throw new AppError('CATEGORY_NOT_FOUND');
    const name = canonicalProductName(cleanName(edits?.name ?? product.name), category.slug);

    return this.adminRepository.updateProduct(productId, {
      ...edits,
      categoryId,
      name,
      normalizedName: normalizeProductName(name),
      mergedIntoProductId: null,
      status: 'active',
    });
  }

  async rejectProduct(productId: string) {
    await this.assertAdmin();
    return this.adminRepository.updateProduct(productId, {
      status: 'rejected',
      mergedIntoProductId: null,
    });
  }

  async mergeProduct(productId: string, targetProductId: string) {
    await this.assertAdmin();
    if (productId === targetProductId) throw new AppError('PICK_CONFLICT', 'PRODUCT_MERGE_SELF');
    const products = await this.adminRepository.getProducts(1000);
    const target = products.find((item) => item.id === targetProductId);
    if (!target || !['active', 'discontinued'].includes(target.status)) throw new AppError('PRODUCT_NOT_ELIGIBLE');

    return this.adminRepository.updateProduct(productId, {
      status: 'merged',
      mergedIntoProductId: target.id,
    });
  }

  async hideProduct(productId: string) {
    await this.assertAdmin();
    return this.adminRepository.updateProduct(productId, { status: 'hidden', mergedIntoProductId: null });
  }

  private async assertAdmin() {
    if (!(await this.adminRepository.isAdmin())) throw new AppError('FORBIDDEN');
  }
}
