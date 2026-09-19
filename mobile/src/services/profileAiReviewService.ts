import { AppError } from '@/errors/appError';
import type { ProfileAiReviewVersion } from '@/lib/profileAiPublication';
import { requireProfileAiTone, type ProfileAiTone } from '@/lib/profileAiTone';
import type { ProfileAiReviewRepository } from '@/repositories/interfaces/profileAiReviewRepository';

export const MIN_PROFILE_AI_PICKS = 10;

export class ProfileAiReviewService {
  constructor(private readonly repository: ProfileAiReviewRepository) {}

  get(profileId: string) { return this.repository.getByProfileId(profileId); }

  async generate(expectedProfileId: string, pickCount: number, tone: ProfileAiTone = 'direct') {
    const selectedTone = requireProfileAiTone(tone);
    if (!Number.isSafeInteger(pickCount) || pickCount < MIN_PROFILE_AI_PICKS) {
      throw new AppError('AI_NOT_ENOUGH_PICKS');
    }
    if (!expectedProfileId) throw new AppError('AUTH_REQUIRED');
    const review = await this.repository.generate(expectedProfileId, selectedTone);
    if (review.profileId !== expectedProfileId) throw new AppError('FORBIDDEN');
    return review;
  }

  setVisibility(profileId: string, isVisible: boolean, expectedReview?: ProfileAiReviewVersion) {
    return this.repository.setVisibility(profileId, isVisible, expectedReview);
  }
}
