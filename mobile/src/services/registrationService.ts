import { AppError } from '@/errors/appError';
import { canonicalItemName } from '@/lib/items/itemIdentity';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { PhotoRepository } from '@/repositories/interfaces/photoRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ItemRepository } from '@/repositories/interfaces/itemRepository';
import type { Pick } from '@/types/domain/pick';
import type { PickPhotoDraft } from '@/types/domain/photo';
import type { Item } from '@/types/domain/item';

export interface RegisterPickInput {
  userId: string;
  categoryId?: string;
  itemId?: string;
  itemName: string;
  variant: string;
  oneLineReview: string;
  photo?: PickPhotoDraft | null;
}

export interface AttachItemPhotoInput {
  userId: string;
  itemId: string;
  photo: PickPhotoDraft;
}

export type RegistrationResult =
  | { type: 'pick'; pick: Pick }
  | { type: 'pending_item'; item: Item }
  | { type: 'existing_item'; item: Item };

export const CATEGORY_HINT_MAX_LENGTH = 60;

export function formatItemName(name: string, variant: string) {
  return [name, variant].map((part) => part.trim().replace(/\s+/g, ' ')).filter(Boolean).join(' ');
}

function hasPhoto(item: Item) {
  return Boolean(item.imagePath || item.imageUrl || item.thumbnailUrl || item.imageSourceUrl);
}

export class RegistrationService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly pickRepository: PickRepository,
    private readonly itemRepository: ItemRepository,
    private readonly photoRepository: PhotoRepository,
    private readonly devicePhotoRepository: {
      choosePhoto(): Promise<PickPhotoDraft | null>;
      preparePhoto(uri: string, sourceUrl?: string): Promise<PickPhotoDraft>;
    },
  ) {}

  async getCategories() {
    return (await this.categoryRepository.getOpenCategories()).filter((category) =>
      category.isVisible && category.isPickable && category.status === 'open');
  }

  choosePhoto() { return this.devicePhotoRepository.choosePhoto(); }

  async importPhoto(url: string) {
    let parsed: URL;
    try { parsed = new URL(url.trim()); } catch { throw new AppError('IMAGE_SOURCE_UNSUPPORTED'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new AppError('IMAGE_SOURCE_UNSUPPORTED');
    const image = await this.photoRepository.importFromUrl(parsed.href);
    return this.devicePhotoRepository.preparePhoto(image.dataUri, image.sourceUrl);
  }

  async attachItemPhoto(input: AttachItemPhotoInput) {
    if (!input.userId) throw new AppError('AUTH_REQUIRED');

    const current = await this.itemRepository.getById(input.itemId);
    if (!current) throw new AppError('ITEM_NOT_FOUND');
    if (current.status !== 'active' && current.status !== 'discontinued') {
      throw new AppError('ITEM_NOT_ELIGIBLE');
    }
    // A catalog poster is an existing image, not an empty upload slot.
    if (hasPhoto(current)) return current;

    await this.photoRepository.cleanupUnused(input.userId).catch(() => {});
    const uploaded = await this.photoRepository.upload(input.userId, input.photo);

    try {
      const item = await this.itemRepository.attachPhoto({
        itemId: current.id,
        ...uploaded,
        imageSourceUrl: input.photo.sourceUrl,
      });
      if (item.imagePath !== uploaded.imagePath) {
        await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
      }
      return item;
    } catch (error) {
      await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
      throw error;
    }
  }

  /** Describe a missing category without creating taxonomy data directly. */
  async setCategoryHint(input: { userId: string; itemId: string; label: string }) {
    if (!input.userId) throw new AppError('AUTH_REQUIRED');
    const label = input.label.trim().replace(/\s+/g, ' ');
    if (!label || label.length > CATEGORY_HINT_MAX_LENGTH) throw new AppError('CATEGORY_LABEL_INVALID');
    return this.itemRepository.setPendingCategoryHint(input.itemId, label);
  }

  async register(input: RegisterPickInput): Promise<RegistrationResult> {
    if (!input.userId) throw new AppError('AUTH_REQUIRED');

    const categories = await this.getCategories();
    const item = input.itemId ? await this.itemRepository.getById(input.itemId) : null;
    if (input.itemId && !item) throw new AppError('ITEM_NOT_FOUND');

    const requestedCategoryId = input.categoryId ?? item?.categoryId;
    const category = requestedCategoryId ? categories.find((entry) => entry.id === requestedCategoryId) : undefined;
    if (requestedCategoryId && (!category?.isVisible || !category.isPickable || category.status !== 'open')) {
      throw new AppError('CATEGORY_NOT_PICKABLE');
    }
    if (item && input.categoryId && item.categoryId !== input.categoryId) throw new AppError('ITEM_CATEGORY_MISMATCH');
    if (item && !category) throw new AppError('CATEGORY_NOT_PICKABLE');

    const name = canonicalItemName(formatItemName(input.itemName, input.variant), category?.slug ?? '');
    if (!name || name.length > 100) throw new AppError('ITEM_NAME_INVALID');
    if (item && item.status !== 'active' && item.status !== 'discontinued') throw new AppError('ITEM_NOT_ELIGIBLE');

    if (item) {
      const review = input.oneLineReview.trim();
      if (!review || review.length > 100) throw new AppError('REVIEW_INVALID');

      let uploaded: { imagePath: string; thumbnailPath: string } | undefined;
      if (input.photo && !hasPhoto(item)) {
        await this.photoRepository.cleanupUnused(input.userId).catch(() => {});
        uploaded = await this.photoRepository.upload(input.userId, input.photo);
      }

      const pick = await this.pickRepository.registerPick({
        categoryId: category!.id,
        itemId: item.id,
        itemName: item.name,
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

    const submitted = category
      ? await this.itemRepository.submitItem({
          categoryId: category.id,
          itemName: name,
          ...uploaded,
          imageSourceUrl: uploaded ? input.photo?.sourceUrl : undefined,
        })
      : await this.itemRepository.submitUnclassifiedItem({
          itemName: name,
          ...uploaded,
          imageSourceUrl: uploaded ? input.photo?.sourceUrl : undefined,
        });

    if (submitted.status === 'pending') {
      if (uploaded && submitted.imagePath !== uploaded.imagePath) {
        await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
      }
      return { type: 'pending_item', item: submitted };
    }

    if (submitted.status === 'active' || submitted.status === 'discontinued') {
      if (uploaded) await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
      return { type: 'existing_item', item: submitted };
    }

    if (uploaded) await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
    throw new AppError('ITEM_NOT_ELIGIBLE');
  }
}
