import { AppError } from '@/errors/appError';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ProductRepository } from '@/repositories/interfaces/productRepository';
import type { ProfileRepository } from '@/repositories/interfaces/profileRepository';

export type MyProductPickStatus =
  | { type: 'not_selected' }
  | { type: 'selected_this'; pickId: string; oneLineReview: string }
  | {
      type: 'selected_other';
      currentPickId: string;
      currentProductId: string;
    };

export class ProductService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly pickRepository: PickRepository,
    private readonly profileRepository: ProfileRepository,
    private readonly categoryRepository: CategoryRepository,
  ) {}

  async getProductDetail(productId: string, userId?: string) {
    const product = await this.productRepository.getById(productId);

    if (!product) {
      throw new AppError('PRODUCT_NOT_FOUND');
    }

    const [category, currentPick, recentPicks] = await Promise.all([
      this.categoryRepository.getById(product.categoryId),
      userId
        ? this.pickRepository.getCurrentPick(userId, product.categoryId)
        : Promise.resolve(null),
      this.pickRepository.getRecentPicks({ productId, limit: 20 }),
    ]);

    let myPickStatus: MyProductPickStatus = { type: 'not_selected' };

    if (currentPick?.productId === product.id) {
      myPickStatus = { type: 'selected_this', pickId: currentPick.id, oneLineReview: currentPick.oneLineReview };
    } else if (currentPick) {
      myPickStatus = {
        type: 'selected_other',
        currentPickId: currentPick.id,
        currentProductId: currentPick.productId,
      };
    }

    const picks = await Promise.all(
      recentPicks.map(async (pick) => ({
        pick,
        profile: await this.profileRepository.getById(pick.userId),
      })),
    );

    const canChoose = Boolean(
      category?.status === 'open' && category.isVisible && category.isPickable &&
      (product.status === 'active' || product.status === 'discontinued'),
    );

    return {
      product,
      category,
      myPickStatus,
      picks,
      canChoose,
    };
  }

  async search(query: string, categoryId?: string) {
    const products = await this.productRepository.search({
      query,
      categoryId,
      limit: 20,
    });

    const eligible = await Promise.all(
      products.map(async (product) => {
        const category = await this.categoryRepository.getById(product.categoryId);
        return Boolean(category?.status === 'open' && category.isVisible && category.isPickable);
      }),
    );

    return products.filter((_, index) => eligible[index]);
  }
}