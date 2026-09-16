import { AppError } from '@/errors/appError';
import { canonicalProductName } from '@/lib/products/productIdentity';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { PhotoRepository } from '@/repositories/interfaces/photoRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ProductRepository } from '@/repositories/interfaces/productRepository';
import type { Pick } from '@/types/domain/pick';
import type { PickPhotoDraft } from '@/types/domain/photo';
import type { Product } from '@/types/domain/product';

export interface RegisterPickInput {
  userId: string;
  categoryId: string;
  productId?: string;
  productName: string;
  variant: string;
  oneLineReview: string;
  photo?: PickPhotoDraft | null;
}

export type RegistrationResult =
  | { type: 'pick'; pick: Pick }
  | { type: 'pending_product'; product: Product }
  | { type: 'existing_product'; product: Product };

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
      category.isVisible && category.isPickable);
  }

  choosePhoto() { return this.devicePhotoRepository.choosePhoto(); }

  async importPhoto(url: string) {
    let parsed: URL;
    try { parsed = new URL(url.trim()); } catch { throw new AppError('IMAGE_SOURCE_UNSUPPORTED'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new AppError('IMAGE_SOURCE_UNSUPPORTED');
    const image = await this.photoRepository.importFromUrl(parsed.href);
    return this.devicePhotoRepository.preparePhoto(image.dataUri, image.sourceUrl);
  }

  async register(input: RegisterPickInput): Promise<RegistrationResult> {
    if (!input.userId) throw new AppError('AUTH_REQUIRED');

    const category = await this.categoryRepository.getById(input.categoryId);
    if (!category?.isVisible || !category.isPickable || category.status !== 'open') {
      throw new AppError('CATEGORY_NOT_PICKABLE');
    }

    const name = canonicalProductName(formatProductName(input.productName, input.variant), category.slug);
    if (!name || name.length > 100) throw new AppError('PRODUCT_NAME_INVALID');

    const product = input.productId ? await this.productRepository.getById(input.productId) : null;
    if (input.productId && !product) throw new AppError('PRODUCT_NOT_FOUND');
    if (product && product.categoryId !== category.id) throw new AppError('PRODUCT_CATEGORY_MISMATCH');
    if (product && product.status !== 'active' && product.status !== 'discontinued') throw new AppError('PRODUCT_NOT_ELIGIBLE');

    if (product) {
      const review = input.oneLineReview.trim();
      if (!review || review.length > 100) throw new AppError('REVIEW_INVALID');

      let uploaded: { imagePath: string; thumbnailPath: string } | undefined;
      if (input.photo && !product.imagePath) {
        await this.photoRepository.cleanupUnused(input.userId).catch(() => {});
        uploaded = await this.photoRepository.upload(input.userId, input.photo);
      }

      const pick = await this.pickRepository.registerPick({
        categoryId: category.id,
        productId: product.id,
        productName: product.name,
        oneLineReview: review,
        ...uploaded,
        imageSourceUrl: uploaded ? input.photo?.sourceUrl : undefined,
      });
      if (uploaded) await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
      return { type: 'pick', pick };
    }

    let uploaded: { imagePath: string; thumbnailPath: string } | undefined;
    if (input.photo) {
      await this.photoRepository.cleanupUnused(input.userId).catch(() => {});
      uploaded = await this.photoRepository.upload(input.userId, input.photo);
    }

    const submitted = await this.productRepository.submitProduct({
      categoryId: category.id,
      productName: name,
      ...uploaded,
      imageSourceUrl: uploaded ? input.photo?.sourceUrl : undefined,
    });

    if (submitted.status === 'pending') {
      if (uploaded && submitted.imagePath !== uploaded.imagePath) {
        await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
      }
      return { type: 'pending_product', product: submitted };
    }

    if (submitted.status === 'active' || submitted.status === 'discontinued') {
      if (uploaded) await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
      return { type: 'existing_product', product: submitted };
    }

    if (uploaded) await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
    throw new AppError('PRODUCT_NOT_ELIGIBLE');
  }
}