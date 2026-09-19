import type { ProfileAiReview } from '@/types/domain/profileAiReview';

export interface ProfileAiReviewRepository {
  getByProfileId(profileId: string): Promise<ProfileAiReview | null>;
  /** Bind the request to the originating profile before contacting the server. */
  generate(expectedProfileId: string): Promise<ProfileAiReview>;
  setVisibility(profileId: string, isVisible: boolean): Promise<ProfileAiReview>;
}
