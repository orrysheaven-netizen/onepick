import { AppError } from '@/errors/appError';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type {
  ChangePickInput,
  PickRepository,
  UpdatePickReviewInput,
} from '@/repositories/interfaces/pickRepository';
import type { ItemRepository } from '@/repositories/interfaces/itemRepository';
import type { ReadRepository } from '@/repositories/interfaces/readRepository';

const PICKABLE_ITEM_STATUSES = new Set(['active', 'discontinued']);

function normalizeReview(value: string) {
  const review = value.trim();
  if (review.length < 1 || review.length > 100) throw new AppError('REVIEW_INVALID');
  return review;
}

export class PickService {
  constructor(
    private readonly pickRepository: PickRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly itemRepository: ItemRepository,
    private readonly readRepository: ReadRepository,
  ) {}

  async getPickDetail(pickId: string, currentUserId?: string) {
    const item = await this.readRepository.getPickById(pickId);
    if (!item) throw new AppError('PICK_NOT_FOUND');
    if (!item.category) throw new AppError('CATEGORY_NOT_FOUND');
    if (!item.item) throw new AppError('ITEM_NOT_FOUND');
    if (!item.profile) throw new AppError('PROFILE_NOT_FOUND');

    return {
      pick: item.pick,
      category: item.category,
      item: item.item,
      profile: item.profile,
      isMine: currentUserId === item.pick.userId,
      isCurrent: item.pick.status === 'active' || item.pick.status === 'needs_review',
    };
  }

  async choosePick(input: ChangePickInput) {
    const review = normalizeReview(input.oneLineReview);
    const [category, item] = await Promise.all([
      this.categoryRepository.getById(input.categoryId),
      this.itemRepository.getById(input.itemId),
    ]);

    if (!category) throw new AppError('CATEGORY_NOT_FOUND');
    if (category.status !== 'open' || !category.isPickable) throw new AppError('CATEGORY_NOT_PICKABLE');
    if (!item) throw new AppError('ITEM_NOT_FOUND');
    if (item.categoryId !== category.id) throw new AppError('ITEM_CATEGORY_MISMATCH');
    if (!PICKABLE_ITEM_STATUSES.has(item.status)) throw new AppError('ITEM_NOT_ELIGIBLE');

    return this.pickRepository.changePick({ ...input, oneLineReview: review });
  }

  updateReview(input: UpdatePickReviewInput) {
    return this.pickRepository.updateReview({ ...input, oneLineReview: normalizeReview(input.oneLineReview) });
  }

  removePick(categoryId: string) {
    return this.pickRepository.removePick(categoryId);
  }
}
