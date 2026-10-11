import { AppError } from '@/errors/appError';
import { itemHasVisiblePhoto } from '@/lib/profile/profilePickGroups';
import type { ItemRepository } from '@/repositories/interfaces/itemRepository';
import type { ProfileRepository } from '@/repositories/interfaces/profileRepository';
import type { PickReadItem, ReadCursor, ReadRepository, RootCategoryScope } from '@/repositories/interfaces/readRepository';
import type { Item } from '@/types/domain/item';

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
// At most one current Pick per category and channel (see getAllCurrentPicks for the pending
// bucket); 20 pages × 100 is a safety cap, not a product limit.
const CURRENT_PICK_PAGE_SIZE = 100;
const CURRENT_PICK_PAGE_CAP = 20;

function normalizeUsername(value: string) {
  const username = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) throw new AppError('USERNAME_INVALID');
  return username;
}

// Same photo rule as `isPublicProfilePick`, which the owner screen uses to count what
// visitors see (one shared helper, #826 review).
function visibleCurrentPicks<T extends { item: Item | null }>(rows: T[]) {
  return rows.filter((row) => itemHasVisiblePhoto(row.item));
}

export class ProfileService {
  constructor(
    private readonly profileRepository: ProfileRepository,
    private readonly readRepository: ReadRepository,
    private readonly itemRepository?: Pick<ItemRepository, 'getMyPendingPhotos'>,
  ) {}

  getById(userId: string) {
    return this.profileRepository.getById(userId);
  }

  async createProfile(usernameInput: string, expectedUserId?: string) {
    const username = normalizeUsername(usernameInput);
    // The first save may have committed before its response was lost. Onboarding
    // resumes an existing own profile; it never renames it or claims another name.
    if (expectedUserId) {
      const own = await this.profileRepository.getById(expectedUserId);
      if (own) return own;
    }
    const existing = await this.profileRepository.getByUsername(username);
    if (existing) {
      if (expectedUserId && existing.id === expectedUserId) return existing;
      throw new AppError('USERNAME_TAKEN');
    }
    return this.profileRepository.create({ username, ...(expectedUserId ? { expectedUserId } : {}) });
  }

  async getMyProfile(userId: string) {
    const profile = await this.profileRepository.getById(userId);
    if (!profile) throw new AppError('PROFILE_NOT_FOUND');

    const { rows: currentPicks, complete } = await this.getAllCurrentPicks(userId, ['active', 'needs_review']);

    const withPendingPhotos = await this.withMyPendingPhotos(userId, currentPicks);
    // Keep my own legacy photo-less current Picks reachable so I can manage or replace them.
    // Public profiles filter them below.
    return { profile, currentPicks: withPendingPhotos, currentPicksComplete: complete };
  }

  /**
   * Every current Pick, not just the first page: the profile's 원픽 N is the full count
   * of the shown scope (#757 A). Pages of 100 by (updated_at, id); `complete` is false
   * only when a row exists past the safety cap, so the count can say so instead of
   * passing as exact. Exactly cap × page rows is still complete.
   *
   * Cost: reads are serial (keyset cursor) and number ceil((N + 1) / 100) for N current
   * Picks, so a profile under 100 makes the same single read as before #757. N is bounded
   * by DB uniqueness, not by this loop: picks_one_current_per_category_channel allows one
   * active/needs_review Pick per (user, category, channel), except the pending-product
   * bucket, which picks_one_current_per_item bounds per item
   * (20260927130500_add_pick_channel, 20261008052019_register_unclassified_menu_pick).
   * The cap is only the guard for that unbounded pending bucket.
   */
  private async getAllCurrentPicks(userId: string, statuses: ('active' | 'needs_review')[]) {
    const rows: PickReadItem[] = [];
    let cursor: ReadCursor | null = null;
    for (let page = 0; page < CURRENT_PICK_PAGE_CAP; page += 1) {
      const batch = await this.readRepository.getPicks({
        userId,
        statuses,
        orderBy: 'updated_at',
        cursor,
        limit: CURRENT_PICK_PAGE_SIZE,
      });
      rows.push(...batch);
      const last = batch[batch.length - 1]?.pick;
      if (batch.length < CURRENT_PICK_PAGE_SIZE || !last) return { rows, complete: true };
      cursor = { timestamp: last.updatedAt, id: last.id };
    }
    // The last page was full: look one row past the cap before calling the list incomplete.
    const beyond = await this.readRepository.getPicks({ userId, statuses, orderBy: 'updated_at', cursor, limit: 1 });
    return { rows, complete: beyond.length === 0 };
  }

  /**
   * L4: a Pick waiting for its photo review shows my own candidate photo on my
   * profile only. Others never get this overlay (the candidate rows are mine by RLS).
   * A failed read keeps the profile usable without the overlay.
   */
  private async withMyPendingPhotos<T extends { item: Item | null }>(userId: string, rows: T[]) {
    const itemIds = rows
      .map((row) => row.item)
      .filter((item): item is Item => Boolean(item && !itemHasVisiblePhoto(item)))
      .map((item) => item.id);
    if (!this.itemRepository || itemIds.length === 0) return rows;
    const photos = await this.itemRepository.getMyPendingPhotos(userId, itemIds).catch(() => null);
    if (!photos?.size) return rows;
    return rows.map((row) => {
      const photo = row.item ? photos.get(row.item.id) : undefined;
      if (!row.item || !photo) return row;
      return {
        ...row,
        item: { ...row.item, imageUrl: photo.imageUrl, thumbnailUrl: photo.thumbnailUrl, photoPendingReview: true },
      };
    });
  }

  async getMyPickHistory(userId: string, cursor: ReadCursor | null = null) {
    const rows = await this.readRepository.getPicks({
      userId,
      statuses: ['replaced', 'removed', 'hidden'],
      cursor,
      limit: 21,
    });
    const items = rows.slice(0, 20);
    const last = items[items.length - 1]?.pick;
    return {
      items,
      nextCursor: rows.length > 20 && last ? { timestamp: last.startedAt, id: last.id } : null,
    };
  }

  async getMyComments(userId: string, cursor: ReadCursor | null = null, scope: RootCategoryScope | null = null) {
    const rows = await this.readRepository.getCommentsByUser(userId, 21, cursor, scope);
    const items = rows.slice(0, 20);
    const last = items[items.length - 1]?.comment;
    return {
      items,
      nextCursor: rows.length > 20 && last ? { timestamp: last.createdAt, id: last.id } : null,
    };
  }

  async getMyItemRequests(userId: string, cursor: ReadCursor | null = null) {
    const rows = await this.readRepository.getItemRequestsByUser(userId, undefined, 21, cursor);
    const items = rows.slice(0, 20);
    const last = items[items.length - 1]?.item;
    return {
      items,
      nextCursor: rows.length > 20 && last ? { timestamp: last.createdAt, id: last.id } : null,
    };
  }

  async getProfileByUsername(username: string, currentUserId?: string) {
    const profile = await this.profileRepository.getByUsername(username);
    if (!profile) throw new AppError('PROFILE_NOT_FOUND');

    const { rows: currentPicks, complete } = await this.getAllCurrentPicks(profile.id, ['active']);

    return {
      profile,
      currentPicks: visibleCurrentPicks(currentPicks),
      currentPicksComplete: complete,
      isMine: currentUserId === profile.id,
    };
  }
}
