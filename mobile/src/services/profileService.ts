import { AppError } from '@/errors/appError';
import type { ProfileRepository } from '@/repositories/interfaces/profileRepository';
import type { ReadCursor, ReadRepository } from '@/repositories/interfaces/readRepository';

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

function normalizeUsername(value: string) {
  const username = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) throw new AppError('USERNAME_INVALID');
  return username;
}

export class ProfileService {
  constructor(
    private readonly profileRepository: ProfileRepository,
    private readonly readRepository: ReadRepository,
  ) {}

  getById(userId: string) {
    return this.profileRepository.getById(userId);
  }

  async createProfile(usernameInput: string) {
    const username = normalizeUsername(usernameInput);
    const existing = await this.profileRepository.getByUsername(username);
    if (existing) throw new AppError('USERNAME_TAKEN');
    return this.profileRepository.create({ username });
  }

  async getMyProfile(userId: string) {
    const profile = await this.profileRepository.getById(userId);
    if (!profile) throw new AppError('PROFILE_NOT_FOUND');

    const currentPicks = await this.readRepository.getPicks({
      userId,
      statuses: ['active', 'needs_review'],
      orderBy: 'updated_at',
      limit: 100,
    });

    return { profile, currentPicks };
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

  async getMyProductRequests(userId: string, cursor: ReadCursor | null = null) {
    const rows = await this.readRepository.getProductRequestsByUser(userId, undefined, 21, cursor);
    const items = rows.slice(0, 20);
    const last = items[items.length - 1]?.product;
    return {
      items,
      nextCursor: rows.length > 20 && last ? { timestamp: last.createdAt, id: last.id } : null,
    };
  }

  async getProfileByUsername(username: string, currentUserId?: string) {
    const profile = await this.profileRepository.getByUsername(username);
    if (!profile) throw new AppError('PROFILE_NOT_FOUND');

    const currentPicks = await this.readRepository.getPicks({
      userId: profile.id,
      statuses: ['active'],
      orderBy: 'updated_at',
      limit: 100,
    });

    return {
      profile,
      currentPicks,
      isMine: currentUserId === profile.id,
    };
  }
}
