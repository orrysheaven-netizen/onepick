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
  categoryId: string;
  itemId?: string;
  itemName: string;
  variant: string;
  oneLineReview: string;
  photo?: PickPhotoDraft | null;
}

export type RegistrationResult =
  | { type: 'pick'; pick: Pick }
  | { type: 'pending_item'; item: Item }
  | { type: 'existing_item'; item: Item };

export function formatItemName(name: string, variant: string) {
  return [name, variant].map((part) => part.trim().replace(/\s+/g, ' ')).filter(Boolean).join(' ');
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
    const categories = (await this.categoryRepository.getOpenCategories()).filter((category) =>
      category.isVisible && category.isPickable && category.status === 'open');

    return Promise.all(categories.map(async (category) => {
      const parent = category.parentId ? await this.categoryRepository.getById(category.parentId) : null;
      return {
        ...category,
        label: parent ? `${parent.name} › ${category.name}` : category.name,
      };
    }));
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

    const category = (await this.getCategories()).find((item) => item.id === input.categoryId);
    if (!category?.isVisible || !category.isPickable || category.status !== 'open') {
      throw new AppError('CATEGORY_NOT_PICKABLE');
    }

    const name = canonicalItemName(formatItemName(input.itemName, input.variant), category.slug);
    if (!name || name.length > 100) throw new AppError('ITEM_NAME_INVALID');

    const item = input.itemId ? await this.itemRepository.getById(input.itemId) : null;
    if (input.itemId && !item) throw new AppError('ITEM_NOT_FOUND');
    if (item && item.categoryId !== category.id) throw new AppError('ITEM_CATEGORY_MISMATCH');
    if (item && item.status !== 'active' && item.status !== 'discontinued') throw new AppError('ITEM_NOT_ELIGIBLE');

    if (item) {
      const review = input.oneLineReview.trim();
      if (!review || review.length > 100) throw new AppError('REVIEW_INVALID');

      let uploaded: { imagePath: string; thumbnailPath: string } | undefined;
      if (input.photo && !item.imagePath) {
        await this.photoRepository.cleanupUnused(input.userId).catch(() => {});
        uploaded = await this.photoRepository.upload(input.userId, input.photo);
      }

      const pick = await this.pickRepository.registerPick({
        categoryId: category.id,
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

    const submitted = await this.itemRepository.submitItem({
      categoryId: category.id,
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
