import type { ProfileAiReview } from '@/types/domain/profileAiReview';

export interface ProfileAiReviewRepository {
  getByProfileId(profileId: string): Promise<ProfileAiReview | null>;
  generate(): Promise<ProfileAiReview>;
  setVisibility(profileId: string, isVisible: boolean): Promise<ProfileAiReview>;
}
