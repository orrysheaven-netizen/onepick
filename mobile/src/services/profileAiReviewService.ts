import { AppError } from '@/errors/appError';
import type { ProfileAiReviewRepository } from '@/repositories/interfaces/profileAiReviewRepository';

export const MIN_PROFILE_AI_PICKS = 3;

export class ProfileAiReviewService {
  constructor(private readonly repository: ProfileAiReviewRepository) {}

  get(profileId: string) {
    return this.repository.getByProfileId(profileId);
  }

  async generate(expectedProfileId: string, pickCount: number) {
    if (!Number.isSafeInteger(pickCount) || pickCount < MIN_PROFILE_AI_PICKS) {
      throw new AppError('AI_NOT_ENOUGH_PICKS');
    }
    if (!expectedProfileId) throw new AppError('AUTH_REQUIRED');
    const review = await this.repository.generate(expectedProfileId);
    if (review.profileId !== expectedProfileId) throw new AppError('FORBIDDEN');
    return review;
  }

  setVisibility(profileId: string, isVisible: boolean) {
    return this.repository.setVisibility(profileId, isVisible);
  }
}
