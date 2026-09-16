import { AppError } from '@/errors/appError';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ProfileRepository } from '@/repositories/interfaces/profileRepository';

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

function normalizeUsername(value: string) {
  const username = value.trim().toLowerCase();

  if (!USERNAME_PATTERN.test(username)) {
    throw new AppError('USERNAME_INVALID');
  }

  return username;
}

export class ProfileService {
  constructor(
    private readonly profileRepository: ProfileRepository,
    private readonly pickRepository: PickRepository,
  ) {}

  getById(userId: string) {
    return this.profileRepository.getById(userId);
  }

  async createProfile(usernameInput: string) {
    const username = normalizeUsername(usernameInput);
    const existing = await this.profileRepository.getByUsername(username);

    if (existing) {
      throw new AppError('USERNAME_TAKEN');
    }

    return this.profileRepository.create({ username });
  }

  async getProfileByUsername(username: string, currentUserId?: string) {
    const profile = await this.profileRepository.getByUsername(username);

    if (!profile) {
      throw new AppError('PROFILE_NOT_FOUND');
    }

    const activePicks = await this.pickRepository.getActivePicksByUser(profile.id);

    return {
      profile,
      activePicks,
      isMine: currentUserId === profile.id,
    };
  }
}
