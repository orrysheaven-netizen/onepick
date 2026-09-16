import { AppError } from '@/errors/appError';
import type { CategoryRepository } from '@/repositories/interfaces/categoryRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ProductRepository } from '@/repositories/interfaces/productRepository';
import type { ProfileRepository } from '@/repositories/interfaces/profileRepository';
import type { Pick } from '@/types/domain/pick';

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
    private readonly categoryRepository: CategoryRepository,
    private readonly productRepository: ProductRepository,
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

  async getMyProfile(userId: string) {
    const profile = await this.profileRepository.getById(userId);

    if (!profile) {
      throw new AppError('PROFILE_NOT_FOUND');
    }

    const [activePicks, history] = await Promise.all([
      this.pickRepository.getActivePicksByUser(userId),
      this.pickRepository.getHistoryByUser(userId),
    ]);

    const [current, previous] = await Promise.all([
      this.hydratePicks(activePicks),
      this.hydratePicks(history),
    ]);

    return {
      profile,
      currentPicks: current,
      history: previous,
    };
  }

  async getProfileByUsername(username: string, currentUserId?: string) {
    const profile = await this.profileRepository.getByUsername(username);

    if (!profile) {
      throw new AppError('PROFILE_NOT_FOUND');
    }

    const activePicks = await this.pickRepository.getActivePicksByUser(profile.id);

    return {
      profile,
      currentPicks: await this.hydratePicks(activePicks),
      isMine: currentUserId === profile.id,
    };
  }

  private async hydratePicks(picks: Pick[]) {
    return Promise.all(
      picks.map(async (pick) => {
        const [category, product] = await Promise.all([
          this.categoryRepository.getById(pick.categoryId),
          this.productRepository.getById(pick.productId),
        ]);

        return {
          pick,
          category,
          product,
        };
      }),
    );
  }
}
