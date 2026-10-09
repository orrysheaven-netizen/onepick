import { AppError } from '@/errors/appError';
import { canonicalItemName } from '@/lib/items/itemIdentity';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { PhotoRepository } from '@/repositories/interfaces/photoRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ItemRepository } from '@/repositories/interfaces/itemRepository';
import type { Pick } from '@/types/domain/pick';
import type { PickPhotoDraft } from '@/types/domain/photo';
import type { Item } from '@/types/domain/item';
import type { PickChannel } from '@/lib/items/pickChannel';

export interface RegisterPickInput {
  userId: string;
  categoryId?: string;
  itemId?: string;
  itemName: string;
  variant: string;
  oneLineReview?: string;
  photo?: PickPhotoDraft | null;
  /** Food only: the channel used when selecting an existing item directly. */
  channel?: PickChannel;
}

export interface AttachItemPhotoInput {
  userId: string;
  itemId: string;
  photo: PickPhotoDraft;
}

export interface ImmediatePickRegistrationInput {
  userId: string;
  categoryId: string | null;
  /** Original dish name when automatic classification did not resolve a category. */
  menuName?: string;
  channel: PickChannel;
  oneLineReview: string;
  requestId: string;
  /** Current Pick ID the registration UI showed for this category/channel; null means the slot was empty. */
  expectedPreviousPickId: string | null;
  itemId?: string | null;
  catalogId?: string | null;
  providerId?: string | null;
  brandId?: string | null;
  linkUrl?: string | null;
  newPlace?: {
    name: string;
    mapUrl: string;
    branchName?: string | null;
  };
  photo?: PickPhotoDraft | null;
}

export interface RevisePendingItemInput {
  userId: string;
  itemId: string;
  linkUrl?: string | null;
  photo?: PickPhotoDraft | null;
  removePhoto?: boolean;
}

export interface ImmediatePickRegistrationResult {
  itemId: string;
  pickId: string;
  published: boolean;
  replacedPickId: string | null;
  retried: boolean;
}

export type RegistrationResult =
  | { type: 'pick'; pick: Pick }
  | { type: 'pending_item'; item: Item }
  | { type: 'available_item'; item: Item }


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
      // L4: a photo-less answer means my upload is now a candidate waiting for
      // admin review; keep its files. Only an item that already had a photo
      // (someone else's, approved earlier) leaves my upload unused.
      if (hasPhoto(item) && item.imagePath !== uploaded.imagePath) {
        await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
      }
      return item;
    } catch (error) {
      await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
      throw error;
    }
  }

  /** L4: my own photo for this item that is still waiting for admin review. */
  async getMyPendingItemPhoto(userId: string, itemId: string) {
    if (!userId || !itemId) return null;
    return (await this.itemRepository.getMyPendingPhotos(userId, [itemId])).get(itemId) ?? null;
  }

  async getCurrentPickSlot(userId: string, categoryId: string, channel: PickChannel): Promise<Pick | null> {
    if (!userId) throw new AppError('AUTH_REQUIRED');
    if (!categoryId) throw new AppError('CATEGORY_NOT_PICKABLE');
    return (await this.pickRepository.getCurrentPicksInCategory(userId, categoryId))
      .find((pick) => pick.channel === channel) ?? null;
  }

  async registerImmediatePick(input: ImmediatePickRegistrationInput): Promise<ImmediatePickRegistrationResult> {
    if (!input.userId) throw new AppError('AUTH_REQUIRED');
    const review = input.oneLineReview.trim();
    if (!review || review.length > 100) throw new AppError('REVIEW_INVALID');
    if (!input.requestId) throw new AppError('INTERNAL_ERROR');

    if (!input.categoryId) {
      const menuName = input.menuName?.trim().replace(/\s+/g, ' ') ?? '';
      if (!menuName || menuName.length > 40) throw new AppError('CATEGORY_NOT_PICKABLE');
      if (input.channel !== 'offline' || input.brandId || input.providerId || input.itemId
        || (!input.catalogId && !input.newPlace)) throw new AppError('ITEM_SELECTION_REQUIRED');
      if (!input.photo) throw new AppError('PHOTO_REQUIRED');
      await this.photoRepository.cleanupUnused(input.userId).catch(() => {});
      const uploaded = await this.photoRepository.upload(input.userId, input.photo);
      try {
        return await this.pickRepository.registerUnclassifiedPick({
          menuName, oneLineReview: review, requestId: input.requestId,
          catalogId: input.catalogId, placeName: input.newPlace?.name,
          mapUrl: input.newPlace?.mapUrl, ...uploaded, imageSourceUrl: input.photo.sourceUrl,
        });
      } finally {
        // Attached files are protected by Storage RLS, including a lost RPC response.
        await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
      }
    }

    // A store missing from the provider catalog must retain place identity.
    // stage_user_place_item creates the hidden place/catalog/provider-linked item;
    // register_item_pick remains the operation that creates/replaces the Pick.
    let itemId = input.itemId ?? null;
    if (!itemId && input.brandId) {
      if (input.channel !== 'offline') throw new AppError('PICK_CHANNEL_MISMATCH');
      const staged = await this.itemRepository.stageBrandItem({
        categoryId: input.categoryId,
        brandId: input.brandId,
      });
      itemId = staged.id;
    } else if (!itemId && !input.catalogId && !input.providerId) {
      if (input.channel !== 'offline' || !input.newPlace) throw new AppError('ITEM_SELECTION_REQUIRED');
      const staged = await this.itemRepository.stageUserPlaceItem({
        categoryId: input.categoryId,
        name: input.newPlace.name,
        mapUrl: input.newPlace.mapUrl,
        branchName: input.newPlace.branchName,
      });
      itemId = staged.id;
    }

    let uploaded: { imagePath: string; thumbnailPath: string } | undefined;
    if (input.photo) {
      await this.photoRepository.cleanupUnused(input.userId).catch(() => {});
      uploaded = await this.photoRepository.upload(input.userId, input.photo);
    }

    try {
      // The UI snapshots the visible current-Pick slot before the person confirms.
      // Never replace that snapshot with a last-moment read here: doing so would
      // silently absorb a change made on another device instead of raising
      // PICK_CHANGED_ELSEWHERE. Only an explicit reconfirmation may refresh it.
      return await this.pickRepository.registerItemPick({
        categoryId: input.categoryId,
        channel: input.channel,
        oneLineReview: review,
        itemId,
        catalogId: input.catalogId,
        providerId: input.providerId,
        linkUrl: input.linkUrl,
        imagePath: uploaded?.imagePath,
        thumbnailPath: uploaded?.thumbnailPath,
        imageSourceUrl: uploaded ? input.photo?.sourceUrl : undefined,
        expectedPreviousPickId: input.expectedPreviousPickId,
        requestId: input.requestId,
      });
    } finally {
      // Storage RLS prevents deleting paths that register_item_pick attached.
      // If the RPC failed before attaching, this removes the unused upload.
      if (uploaded) {
        await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
      }
    }
  }

  async revisePendingItem(input: RevisePendingItemInput) {
    if (!input.userId) throw new AppError('AUTH_REQUIRED');
    if (!input.itemId) throw new AppError('ITEM_NOT_FOUND');

    let uploaded: { imagePath: string; thumbnailPath: string } | undefined;
    if (input.photo) {
      await this.photoRepository.cleanupUnused(input.userId).catch(() => {});
      uploaded = await this.photoRepository.upload(input.userId, input.photo);
    }

    try {
      const item = await this.itemRepository.reviseItemRequest({
        itemId: input.itemId,
        linkUrl: input.linkUrl,
        imagePath: uploaded?.imagePath,
        thumbnailPath: uploaded?.thumbnailPath,
        imageSourceUrl: uploaded ? input.photo?.sourceUrl : undefined,
        removePhoto: input.removePhoto,
      });
      return item;
    } finally {
      if (uploaded) {
        await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
      }
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
      const review = (input.oneLineReview ?? '').trim();
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
        ...(input.channel ? { channel: input.channel } : {}),
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
      // A registration request is not a Pick intent. Approval never creates a
      // Pick automatically; the member chooses the approved item explicitly.
      return { type: 'pending_item', item: submitted };
    }

    if (submitted.status === 'active' || submitted.status === 'discontinued') {
      if (uploaded) await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
      // The request resolved to an already-available item while submitting.
      // Do not pretend a request was created and do not auto-select it.
      return { type: 'available_item', item: submitted };
    }

    if (uploaded) await this.photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
    throw new AppError('ITEM_NOT_ELIGIBLE');
  }
}

