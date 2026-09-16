import { AppError } from '@/errors/appError';
import { canonicalProductName, REGISTRATION_CATEGORY_SLUGS } from '@/lib/products/productIdentity';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { PhotoRepository } from '@/repositories/interfaces/photoRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ProductRepository } from '@/repositories/interfaces/productRepository';
import type { PickPhotoDraft } from '@/types/domain/photo';

export interface RegisterPickInput {
  userId: string;
  categoryId: string;
  productId?: string;
  productName: string;
  variant: string;
  oneLineReview: string;
  photo?: PickPhotoDraft | null;
}
export function formatProductName(name: string, variant: string) {
  return [name, variant].map((part) => part.trim().replace(/\s+/g, ' ')).filter(Boolean).join(' ');
}
export class RegistrationService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly pickRepository: PickRepository,
    private readonly productRepository: ProductRepository,
    private readonly photoRepository: PhotoRepository,
    private readonly devicePhotoRepository: {
      choosePhoto(): Promise<PickPhotoDraft | null>;
      preparePhoto(uri: string, sourceUrl?: string): Promise<PickPhotoDraft>;
    },
  ) {}

  async getCategories() {
    return (await this.categoryRepository.getOpenCategories()).filter((category) =>
      category.isVisible && category.isPickable && REGISTRATION_CATEGORY_SLUGS.some((slug) => slug === category.slug));
  }
  choosePhoto() { return this.devicePhotoRepository.choosePhoto(); }
  async importPhoto(url: string) {
    let parsed: URL;
    try { parsed = new URL(url.trim()); } catch { throw new AppError('IMAGE_SOURCE_UNSUPPORTED'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new AppError('IMAGE_SOURCE_UNSUPPORTED');
    const image = await this.photoRepository.importFromUrl(parsed.href);
    return this.devicePhotoRepository.preparePhoto(image.dataUri, image.sourceUrl);
  }

  async register(input: RegisterPickInput) {
    if (!input.userId) throw new AppError('AUTH_REQUIRED');
    const review = input.oneLineReview.trim();
    if (!review || review.length > 100) throw new AppError('REVIEW_INVALID');
    const category = await this.categoryRepository.getById(input.categoryId);
    if (!category?.isVisible || !category.isPickable || category.status !== 'open' ||
      !REGISTRATION_CATEGORY_SLUGS.some((slug) => slug === category.slug)) throw new AppError('CATEGORY_NOT_PICKABLE');
    const name = canonicalProductName(formatProductName(input.productName, input.variant), category.slug);
    if (!name || name.length > 100) throw new AppError('PRODUCT_NAME_INVALID');
    const product = input.productId ? await this.productRepository.getById(input.productId) : null;
    if (input.productId && !product) throw new AppError('PRODUCT_NOT_FOUND');
    if (product && product.categoryId !== category.id) throw new AppError('PRODUCT_CATEGORY_MISMATCH');
    if (product && product.status !== 'active' && product.status !== 'discontinued') throw new AppError('PRODUCT_NOT_ELIGIBLE');
    let uploaded: { imagePath: string; thumbnailPath: string } | undefined;
    if (input.photo && !product?.imagePath) {
      await this.photoRepository.cleanupUnused(input.userId).catch(() => {});
      uploaded = await this.photoRepository.upload(input.userId, input.photo);
    }
    // No required image: a failed import must not prevent the user's product registration.
    const result = await this.pickRepository.registerPick({
      categoryId: category.id, productId: product?.id, productName: product?.name ?? name,
      oneLineReview: review, ...uploaded, imageSourceUrl: uploaded ? input.photo?.sourceUrl : undefined,
    });
    // Concurrent registrations may have supplied the first shared image. Delete only unreferenced files.
    if (uploaded) await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
    return result;
  }
}
