import { AppError } from '@/errors/appError';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ProductRepository } from '@/repositories/interfaces/productRepository';
import type { ReadRepository } from '@/repositories/interfaces/readRepository';

export type MyProductPickStatus =
  | { type: 'not_selected' }
  | { type: 'selected_this'; pickId: string; oneLineReview: string }
  | { type: 'selected_other'; currentPickId: string; currentProductId: string };

export class ProductService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly pickRepository: PickRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly readRepository: ReadRepository,
  ) {}

  async getProductDetail(productId: string, userId?: string) {
    const product = await this.productRepository.getById(productId);
    if (!product) throw new AppError('PRODUCT_NOT_FOUND');

    const [category, currentPick, picks, openCategories] = await Promise.all([
      this.categoryRepository.getById(product.categoryId),
      userId ? this.pickRepository.getCurrentPick(userId, product.categoryId) : Promise.resolve(null),
      this.readRepository.getPicks({ productId, statuses: ['active'], limit: 20 }),
      this.categoryRepository.getOpenCategories(),
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

    const canChoose = Boolean(
      openCategories.some((item) => item.id === product.categoryId) &&
      (product.status === 'active' || product.status === 'discontinued'),
    );

    return {
      product,
      category,
      myPickStatus,
      picks: picks.map((item) => ({ pick: item.pick, profile: item.profile })),
      canChoose,
    };
  }

  async search(query: string, categoryId?: string) {
    const categories = await this.categoryRepository.getOpenCategories();
    const ids = categories.filter((item) => !categoryId || item.id === categoryId).map((item) => item.id);
    if (!ids.length || !query.trim()) return [];
    return this.productRepository.search({ query, categoryId, categoryIds: ids, limit: 20 });
  }
}
