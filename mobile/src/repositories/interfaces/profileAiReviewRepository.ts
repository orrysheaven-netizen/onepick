import type { ProfileAiReviewVersion } from '@/lib/profileAiPublication';
import type { ProfileAiTone } from '@/lib/profileAiTone';
import type { ProfileAiVisibilityReceipt } from '@/lib/profileAiVisibility';
import type { ProfileAiReview } from '@/types/domain/profileAiReview';

export interface ProfileAiReviewRepository {
  getByProfileId(profileId: string): Promise<ProfileAiReview | null>;
  generate(expectedProfileId: string, tone?: ProfileAiTone): Promise<ProfileAiReview>;
  setVisibility(profileId: string, isVisible: boolean, expectedReview?: ProfileAiReviewVersion): Promise<ProfileAiVisibilityReceipt>;
}
