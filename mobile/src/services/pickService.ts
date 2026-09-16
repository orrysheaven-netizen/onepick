import { AppError } from '@/errors/appError';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type {
  ChangePickInput,
  PickRepository,
  UpdatePickReviewInput,
} from '@/repositories/interfaces/pickRepository';
import type { ProductRepository } from '@/repositories/interfaces/productRepository';

const PICKABLE_PRODUCT_STATUSES = new Set(['active', 'discontinued']);

function normalizeReview(value: string) {
  const review = value.trim();

  if (review.length < 1 || review.length > 100) {
    throw new AppError('REVIEW_INVALID');
  }

  return review;
}

export class PickService {
  constructor(
    private readonly pickRepository: PickRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly productRepository: ProductRepository,
  ) {}

  async choosePick(input: ChangePickInput) {
    const review = normalizeReview(input.oneLineReview);
    const [category, product] = await Promise.all([
      this.categoryRepository.getById(input.categoryId),
      this.productRepository.getById(input.productId),
    ]);

    if (!category) {
      throw new AppError('CATEGORY_NOT_FOUND');
    }

    if (category.status !== 'open' || !category.isPickable) {
      throw new AppError('CATEGORY_NOT_PICKABLE');
    }

    if (!product) {
      throw new AppError('PRODUCT_NOT_FOUND');
    }

    if (product.categoryId !== category.id) {
      throw new AppError('PRODUCT_CATEGORY_MISMATCH');
    }

    if (!PICKABLE_PRODUCT_STATUSES.has(product.status)) {
      throw new AppError('PRODUCT_NOT_ELIGIBLE');
    }

    return this.pickRepository.changePick({
      ...input,
      oneLineReview: review,
    });
  }

  updateReview(input: UpdatePickReviewInput) {
    return this.pickRepository.updateReview({
      ...input,
      oneLineReview: normalizeReview(input.oneLineReview),
    });
  }

  removePick(categoryId: string) {
    return this.pickRepository.removePick(categoryId);
  }
}
