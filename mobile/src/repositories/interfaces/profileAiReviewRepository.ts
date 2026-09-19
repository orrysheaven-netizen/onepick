import type { ProfileAiReviewVersion } from '@/lib/profileAiPublication';
import type { ProfileAiVisibilityReceipt } from '@/lib/profileAiVisibility';
import type { ProfileAiReview } from '@/types/domain/profileAiReview';

export interface ProfileAiReviewRepository {
  getByProfileId(profileId: string): Promise<ProfileAiReview | null>;
  /** Bind the request to the originating profile before contacting the server. */
  generate(expectedProfileId: string): Promise<ProfileAiReview>;
  /** Publishing requires the displayed version; hiding deliberately does not. */
  setVisibility(profileId: string, isVisible: boolean, expectedReview?: ProfileAiReviewVersion): Promise<ProfileAiVisibilityReceipt>;
}
