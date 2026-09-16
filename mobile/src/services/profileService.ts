import { AppError } from '@/errors/appError';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ProfileRepository } from '@/repositories/interfaces/profileRepository';

export class ProfileService {
  constructor(
    private readonly profileRepository: ProfileRepository,
    private readonly pickRepository: PickRepository,
  ) {}

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
